import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('bridge update readiness ordering', () => {
  it('reconciles a successful update only after callbacks and heartbeat are ready', async () => {
    const source = await readFile(new URL('../../src/cli/commands/run.ts', import.meta.url), 'utf8');
    const reconcile = source.indexOf('await updateHandoff.reconcile(currentVersion())');
    const notify = source.indexOf('await notifyServer.start()');
    const heartbeat = source.indexOf('const heartbeat = startHeartbeat(');

    expect(reconcile).toBeGreaterThan(notify);
    expect(reconcile).toBeGreaterThan(heartbeat);
  });
});
