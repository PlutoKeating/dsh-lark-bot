#!/usr/bin/env node
// Real availability probe for the pinned DeepSeek Harness matrix.
//
// Boots a scratch DSH_HOME with the exact pinned `@deepseek-ai/dsh` +
// `@deepseek-ai/dsh-base`, seeds a minimal bot profile, then runs
// `dist/cli.js doctor` with DSH_LARK_ADAPTER=sdk. The doctor builds the real
// SDK adapter: it creates the JSON-RPC runtime profile, pnpm-installs
// `@deepseek-ai/dsh-sdk-jsonrpc-server` at the pinned version, discovers the
// harness binary and performs a real SDK initialize round-trip.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDshCompatibility, rootDir } from './dsh-compat.mjs';

const textResponse = (text) => [
  JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] }),
  JSON.stringify({ choices: [{ delta: { content: text }, index: 0, finish_reason: null }] }),
  JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
  '[DONE]',
];

async function startCompatServer() {
  const notifications = [];
  const questions = [];
  const plans = [];
  const approvals = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += String(chunk); });
    request.on('end', () => {
      if (request.url === '/notify') {
        notifications.push(JSON.parse(raw));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, chatId: 'compat-chat' }));
        return;
      }
      if (request.url === '/ask') {
        questions.push(JSON.parse(raw));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, answer: 'compat-answer' }));
        return;
      }
      if (request.url === '/plan') {
        plans.push(JSON.parse(raw));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, decision: 'approved', feedback: 'compat-approved' }));
        return;
      }
      if (request.url === '/approval') {
        const approval = JSON.parse(raw);
        approvals.push(approval);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          outcome: approval.toolInput?.command === 'printf must-not-run-approval'
            ? 'rejected'
            : 'allowed-once',
        }));
        return;
      }
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const modelInput = raw.length > 0 ? JSON.parse(raw) : {};
      const serializedInput = JSON.stringify(modelInput);
      const isResume = serializedInput.includes('Continue the same session.');
      const hasPersistedFirstTurn =
        serializedInput.includes('compat-call') &&
        serializedInput.includes('tool-ok') &&
        serializedInput.includes('Message sent to compat-chat');
      const isAsk = serializedInput.includes('Call lark_ask_user once.');
      const hasAskResult = serializedInput.includes('compat-ask-call') &&
        serializedInput.includes('compat-answer');
      const isPlan = serializedInput.includes('Call lark_request_plan_approval once.');
      const hasPlanResult = serializedInput.includes('compat-plan-call') &&
        serializedInput.includes('compat-approved');
      const isPlanGate = serializedInput.includes('Verify the enforced plan gate.');
      const isApprovalReject = serializedInput.includes('Verify rejected approval recovery.');
      const hasRejectPlan = serializedInput.includes('compat-reject-plan') &&
        serializedInput.includes('compat-approved');
      const hasApprovalReject = serializedInput.includes('compat-reject-bash') &&
        serializedInput.includes('user rejected this one-shot tool execution');
      const hasRecoveryNotify = serializedInput.includes('compat-recovery-notify') &&
        serializedInput.includes('Message sent to compat-chat');
      const hasGateDenial = serializedInput.includes('compat-gate-denied') &&
        serializedInput.includes('blocked until the current turn calls lark_request_plan_approval');
      const hasGateApproval = serializedInput.includes('compat-gate-plan') &&
        serializedInput.includes('compat-approved');
      const hasGateExecution = serializedInput.includes('compat-gate-bash') &&
        serializedInput.includes('compat-gate-ok');
      const hasNotifyResult = serializedInput.includes('Message sent to compat-chat');
      const events = isResume
        ? textResponse(hasPersistedFirstTurn ? 'resume-ok' : 'resume-history-missing')
        : isApprovalReject && hasRecoveryNotify
          ? textResponse('approval-reject-recovered')
          : isApprovalReject && hasApprovalReject
            ? [
              JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-recovery-notify', type: 'function', function: { name: 'lark_notify', arguments: '{"text":"approval rejected; continuing safely"}' } }] }, index: 0, finish_reason: null }] }),
              JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
              '[DONE]',
            ]
          : isApprovalReject && hasRejectPlan
            ? [
              JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-reject-bash', type: 'function', function: { name: 'bash', arguments: '{"command":"printf must-not-run-approval","description":"Verify rejection recovery"}' } }] }, index: 0, finish_reason: null }] }),
              JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
              '[DONE]',
            ]
          : isApprovalReject
            ? [
              JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-reject-plan', type: 'function', function: { name: 'lark_request_plan_approval', arguments: '{"plan":"1. request permission\n2. attempt the high-risk command\n3. continue safely if rejected"}' } }] }, index: 0, finish_reason: null }] }),
              JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
              '[DONE]',
            ]
        : isPlanGate && hasGateExecution
          ? textResponse('plan-gate-ok')
          : isPlanGate && hasGateApproval
            ? [
              JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-gate-bash', type: 'function', function: { name: 'bash', arguments: '{"command":"printf compat-gate-ok","description":"Print plan gate success marker"}' } }] }, index: 0, finish_reason: null }] }),
              JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
              '[DONE]',
            ]
          : isPlanGate && hasGateDenial
            ? [
              JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-gate-plan', type: 'function', function: { name: 'lark_request_plan_approval', arguments: '{"plan":"1. verify denial\\n2. run approved command"}' } }] }, index: 0, finish_reason: null }] }),
              JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
              '[DONE]',
            ]
          : isPlanGate
            ? [
              JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-gate-denied', type: 'function', function: { name: 'bash', arguments: '{"command":"printf must-not-run","description":"Attempt command before plan approval"}' } }] }, index: 0, finish_reason: null }] }),
              JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
              '[DONE]',
            ]
        : hasAskResult
          ? textResponse('ask-ok')
          : hasPlanResult
            ? textResponse('plan-ok')
            : isPlan
              ? [
                JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-plan-call', type: 'function', function: { name: 'lark_request_plan_approval', arguments: '{"plan":"1. inspect\\n2. execute"}' } }] }, index: 0, finish_reason: null }] }),
                JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
                '[DONE]',
              ]
          : isAsk
            ? [
              JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-ask-call', type: 'function', function: { name: 'lark_ask_user', arguments: '{"question":"compat question","kind":"text"}' } }] }, index: 0, finish_reason: null }] }),
              JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
              '[DONE]',
            ]
          : hasNotifyResult
          ? textResponse('tool-ok')
          : [
            JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'compat-call', type: 'function', function: { name: 'lark_notify', arguments: '{"text":"compat tool"}' } }] }, index: 0, finish_reason: null }] }),
            JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
            '[DONE]',
          ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of events) response.write(`data: ${event}\n\n`);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('compat server has no TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    notifications,
    questions,
    plans,
    approvals,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

async function main() {
  const compat = readDshCompatibility();
  const rootPackage = JSON.parse(
    readFileSync(join(rootDir(), 'package.json'), 'utf8'),
  );
  const root = await mkdtemp(join(tmpdir(), 'dsh-compat-probe-'));
  const dshHome = join(root, 'dsh');
  const larkHome = join(root, 'lark');
  const workspace = join(root, 'workspace');
  const compatServer = await startCompatServer();
  const env = {
    ...process.env,
    // The scratch profiles workspace grows a package.json dynamically (the
    // bot writes the runtime profile before its own pnpm install), so the
    // workspace lockfile is intentionally re-generated. CI forces
    // `frozen-lockfile` by default; opt out for the scratch workspace only.
    npm_config_frozen_lockfile: 'false',
    DSH_HOME: dshHome,
    DSH_LARK_HOME: larkHome,
    DSH_LARK_ADAPTER: 'sdk',
    DSH_LARK_PROVIDER: 'compat-local',
    DSH_LARK_MODEL: 'compat-model',
    DSH_LARK_WORKSPACE: workspace,
    DSH_LARK_NOTIFY_URL: `${compatServer.url}/notify`,
    DSH_LARK_ASK_URL: `${compatServer.url}/ask`,
    DSH_LARK_PLAN_URL: `${compatServer.url}/plan`,
    DSH_LARK_APPROVAL_URL: `${compatServer.url}/approval`,
    DSH_LARK_NOTIFY_TOKEN: 'compat-token',
    COMPAT_API_KEY: 'compat-local-key',
  };
  delete env.DSH_LARK_DSH_COMMAND;
  delete env.DSH_LARK_DSH_ARGS;

  try {
    // 1. Install the pinned harness + base bundle into the scratch dsh home.
    const profilesRoot = join(dshHome, 'profiles');
    await mkdir(profilesRoot, { recursive: true });
    await writeFile(
      join(profilesRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'dsh-compat-probe-profiles',
          private: true,
          // Pin the same pnpm the repo uses so corepack and CI behave alike.
          packageManager: rootPackage.packageManager,
          dependencies: {
            '@deepseek-ai/dsh': compat.harness,
            '@deepseek-ai/dsh-base': compat.harness,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    // pnpm 10 blocks dependency build scripts by default; the dsh harness
    // ships native modules (node-pty, koffi, protobufjs...), so the scratch
    // workspace opts into running them, exactly like a normal dsh install.
    await writeFile(
      join(profilesRoot, 'pnpm-workspace.yaml'),
      [
        'packages:',
        '  - "*"',
        'dangerouslyAllowAllBuilds: true',
        '',
      ].join('\n'),
      'utf8',
    );
    console.log(`[probe] installing dsh ${compat.harness} into ${dshHome}`);
    await run('pnpm', ['install'], { cwd: profilesRoot, env });

    // 2. Assert the installed harness version matches the matrix.
    const harnessBin = join(
      profilesRoot,
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'lib',
      'bin.js',
    );
    const versionCheck = spawn('node', [harnessBin, '--version'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const versionOutput = await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      versionCheck.stdout.on('data', (chunk) => {
        out += String(chunk);
      });
      versionCheck.stderr.on('data', (chunk) => {
        err += String(chunk);
      });
      versionCheck.once('error', reject);
      versionCheck.once('exit', (code) => resolve({ code, out, err }));
    });
    if (versionOutput.code !== 0) {
      throw new Error(`dsh --version failed: ${versionOutput.err || versionOutput.out}`);
    }
    const version = versionOutput.out.trim();
    if (!version.includes(compat.harness)) {
      throw new Error(`dsh version mismatch: got "${version}", expected ${compat.harness}`);
    }
    console.log(`[probe] harness version ok: ${version}`);

    // Configure a local OpenAI-compatible route. This makes the probe keyless
    // while still exercising a real rc.7 model loop, tool call and resume.
    await writeFile(
      join(dshHome, 'settings.yaml'),
      [
        'llm-pi-ai:',
        '  providers:',
        '    compat-local:',
        '      api: openai-completions',
        `      baseURL: ${compatServer.url}/v1`,
        '      apiKeyEnv: COMPAT_API_KEY',
        '      models:',
        '        - id: compat-model',
        '',
      ].join('\n'),
      'utf8',
    );

    // 3. Seed a minimal bot profile so `doctor` can run its real probe.
    await mkdir(larkHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(larkHome, 'config.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          activeProfile: 'default',
          profiles: {
            default: {
              schemaVersion: 1,
              agentKind: 'dsh',
              tenant: 'feishu',
              accounts: {
                appId: 'cli_compat_probe',
                appSecret: 'compat-probe-secret',
              },
              workspaces: { default: workspace },
              preferences: {
                model: 'deepseek-v4-flash',
                stopGraceMs: 5000,
                runTimeoutMs: 300000,
              },
              access: { allowedUsers: [], allowedChats: [], admins: [] },
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // 4. Real availability probes through both managed protocol adapters.
    for (const adapter of ['sdk', 'acp']) {
      console.log(`[probe] running \`doctor\` (${adapter.toUpperCase()} runtime bootstrap + initialize round-trip)`);
      const doctor = spawn('node', [join(rootDir(), 'dist', 'cli.js'), 'doctor'], {
        env: { ...env, DSH_LARK_ADAPTER: adapter },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      const doctorCode = await new Promise((resolve) => {
        doctor.once('exit', (code) => resolve(code ?? 1));
      });
      if (doctorCode !== 0) {
        throw new Error(`${adapter} doctor exited with code ${doctorCode}`);
      }
    }
    // 5. Run a complete SDK tool turn, then resume the same durable session.
    const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client');
    const harness = new DeepSeekHarness({
      launch: {
        command: 'node',
        args: [harnessBin, '--profile', 'dsh-lark-sdk'],
        cwd: workspace,
        env,
      },
      cwd: workspace,
      provider: 'compat-local',
      model: 'compat-model',
    });
    try {
      // pi-ai providers register asynchronously after the JSON-RPC server
      // starts. Poll initialize on the same subprocess (re-spawning would
      // restart the race), mirroring SdkDshAdapter's production workaround.
      const client = harness.client;
      client.start();
      let initialized = false;
      let initError;
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        try {
          await client.initialize({ cwd: workspace, provider: 'compat-local', model: 'compat-model' });
          initialized = true;
          break;
        } catch (error) {
          initError = error;
          if (!String(error).match(/no adapter registered/i)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
      if (!initialized) throw initError;
      harness.initialized = Promise.resolve();
      const first = await harness.run('Call lark_notify once.', { sessionId: 'compat-session' });
      if (first.finalResponse !== 'tool-ok') {
        throw new Error(`unexpected tool-turn response: ${JSON.stringify(first.finalResponse)}`);
      }
      if (compatServer.notifications.length !== 1) {
        throw new Error(`lark_notify execution count mismatch: ${compatServer.notifications.length}`);
      }
      console.log('[probe] sdk lark_notify turn ok');
      const resumed = await harness.run('Continue the same session.', { sessionId: 'compat-session' });
      if (resumed.finalResponse !== 'resume-ok') {
        throw new Error(`unexpected resumed response: ${JSON.stringify(resumed.finalResponse)}`);
      }
      console.log('[probe] sdk persisted-session resume ok');
      const asked = await harness.run('Call lark_ask_user once.', { sessionId: 'compat-ask-session' });
      if (asked.finalResponse !== 'ask-ok') {
        throw new Error(`unexpected ask-tool response: ${JSON.stringify(asked.finalResponse)}`);
      }
      if (compatServer.questions.length !== 1) {
        throw new Error(`lark_ask_user execution count mismatch: ${compatServer.questions.length}`);
      }
      const planned = await harness.run(
        'Verify the enforced plan gate.',
        { sessionId: 'compat-plan-session' },
      );
      if (planned.finalResponse !== 'plan-gate-ok') {
        throw new Error(`unexpected plan-gate response: ${JSON.stringify(planned.finalResponse)}`);
      }
      if (compatServer.plans.length !== 1) {
        throw new Error(`plan tool execution count mismatch: ${compatServer.plans.length}`);
      }
      if (compatServer.approvals.length !== 1) {
        throw new Error(`one-shot approval execution count mismatch: ${compatServer.approvals.length}`);
      }
      const approval = compatServer.approvals[0];
      if (
        approval.toolName !== 'bash' || !approval.reason ||
        approval.toolInput?.command !== 'printf compat-gate-ok'
      ) {
        throw new Error(`incomplete one-shot approval payload: ${JSON.stringify(approval)}`);
      }
      const rejected = await harness.run(
        'Verify rejected approval recovery.',
        { sessionId: 'compat-approval-reject-session' },
      );
      if (rejected.finalResponse !== 'approval-reject-recovered') {
        throw new Error(`approval rejection did not continue the turn: ${JSON.stringify(rejected.finalResponse)}`);
      }
      if (
        compatServer.plans.length !== 2 || compatServer.approvals.length !== 2 ||
        compatServer.notifications.length !== 2
      ) {
        throw new Error(
          `approval rejection recovery counts mismatch: plans=${compatServer.plans.length}, approvals=${compatServer.approvals.length}, notifications=${compatServer.notifications.length}`,
        );
      }
      console.log('[probe] sdk task/notify/ask/enforced-plan-gate/one-shot-approval/resume ok against local OpenAI-compatible fixture');
    } finally {
      await harness.close();
    }
    console.log(
      `[probe] ok: sdk-server ${compat.sdkServer} and acp ${compat.acp} initialize against dsh ${compat.harness}`,
    );
  } finally {
    await compatServer.close();
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
