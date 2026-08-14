import { describe, expect, it } from 'vitest';
import {
  captureOutput,
  isProcessAlive,
  matchProfileProcess,
  spawnDetached,
} from '../../src/guardian/process.js';

describe('guardian process watch', () => {
  it('matches dsh profile processes without colliding with other profiles', () => {
    expect(matchProfileProcess('node /x/@deepseek-ai/dsh/lib/bin.js --profile dsh-lark', 'dsh-lark')).toBe(true);
    expect(matchProfileProcess('dsh --profile dsh-lark-safe run', 'dsh-lark')).toBe(false);
    expect(matchProfileProcess('dsh --profile=other', 'dsh-lark')).toBe(false);
    expect(matchProfileProcess('dsh --profile dsh-lark', 'dsh-lark')).toBe(true);
    expect(matchProfileProcess('node something.js --profile dsh-lark', 'dsh-lark')).toBe(false);
  });

  it('captures command output', async () => {
    const result = await captureOutput('node', ['-e', 'console.log("ok")'], 5_000);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ok');
  });

  it('checks process liveness for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_147_483_647)).toBe(false);
  });

  it('spawns detached processes', () => {
    const spawned = spawnDetached('node', ['-e', 'setTimeout(() => {}, 100)']);
    expect(typeof spawned.pid).toBe('number');
  });
});
