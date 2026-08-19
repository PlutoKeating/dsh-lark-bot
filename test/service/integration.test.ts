import { describe, expect, it, vi } from 'vitest';
import { restartInstalledProfileService } from '../../src/service/integration.js';
import type { ServiceManager } from '../../src/service/manager.js';

describe('restartInstalledProfileService', () => {
  it('honors a persisted intentional stop even after uninstall removed metadata', async () => {
    const restartManaged = vi.fn().mockResolvedValue({
      installed: false,
      suppressed: true,
    });
    const manager = {
      restartManaged,
    } as unknown as ServiceManager;
    const result = await restartInstalledProfileService('dsh-lark', { manager });
    expect(result).toMatchObject({ suppressed: true, restarted: false });
    expect(restartManaged).toHaveBeenCalledWith({});
  });

  it('allows an explicit upgrade restart to override stopped intent', async () => {
    const manager = {
      restartManaged: vi.fn().mockResolvedValue({
        installed: true,
        suppressed: false,
        status: { state: 'running', detail: 'active' },
      }),
    } as unknown as ServiceManager;
    const result = await restartInstalledProfileService('dsh-lark', {
      manager,
      respectIntent: false,
    });
    expect(result).toMatchObject({ restarted: true, installed: true });
    expect(manager.restartManaged).toHaveBeenCalledWith({ respectIntent: false });
  });
});
