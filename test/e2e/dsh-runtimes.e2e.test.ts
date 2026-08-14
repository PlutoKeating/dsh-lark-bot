import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import { SdkDshAdapter } from '../../src/adapters/dsh/sdk-adapter.js';
import { createSdkRun } from '../../src/adapters/dsh/sdk-translate.js';
import {
  ensureSdkProfile,
  resolveSdkLaunch,
} from '../../src/adapters/dsh/sdk-runtime.js';
import {
  ensureAcpProfile,
  resolveAcpLaunch,
} from '../../src/adapters/dsh/acp-runtime.js';

const enabled = process.env.DSH_LARK_E2E === '1';

describe.skipIf(!enabled)('real dsh runtimes (DSH_LARK_E2E=1)', () => {
  it('ensures and handshakes the SDK JSON-RPC runtime', async () => {
    const home = homedir();
    const ensure = await ensureSdkProfile({ home, env: process.env });
    expect(ensure.ok).toBe(true);
    const adapter = new SdkDshAdapter({
      launch: resolveSdkLaunch({ home, env: process.env }),
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      probeTimeoutMs: 20_000,
    });
    const availability = await adapter.checkAvailability();
    expect(availability.ok).toBe(true);
    expect(availability.version).toContain('deepseek-harness-sdk-runtime');
    await adapter.dispose();
  });

  it('ensures the ACP runtime and completes an initialize handshake', async () => {
    const home = homedir();
    const ensure = await ensureAcpProfile({
      home,
      env: process.env,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    });
    expect(ensure.ok).toBe(true);

    const launch = resolveAcpLaunch({ home, env: process.env });
    const child = spawn(launch.command, launch.args, {
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const conn = new ClientSideConnection(
      () => ({
        requestPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: () => Promise.resolve(),
      }),
      ndJsonStream(
        NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    try {
      const info = await conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      expect(info.agentInfo?.name).toBe('deepseek-harness-acp');
    } finally {
      child.stdin?.end();
      child.kill('SIGTERM');
    }
  });

  it('streams a real SDK turn with thinking and text events', async () => {
    const home = homedir();
    const launch = resolveSdkLaunch({ home, env: process.env });
    const adapter = new SdkDshAdapter({
      launch,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    });
    const run = adapter.run({
      runId: 'e2e-real-run',
      prompt: 'Say hello in one short sentence.',
      cwd: '/tmp',
      sessionId: `e2e-${Date.now()}`,
      model: undefined,
      images: undefined,
      stopGraceMs: undefined,
    });
    const types: string[] = [];
    let sawText = false;
    for await (const event of run.events) {
      types.push(event.type);
      if (event.type === 'text' && event.delta.trim()) sawText = true;
    }
    expect(types).toContain('system');
    expect(sawText).toBe(true);
    expect(types.at(-1)).toBe('done');
    await adapter.dispose();
  }, 120_000);
}, 60_000);
