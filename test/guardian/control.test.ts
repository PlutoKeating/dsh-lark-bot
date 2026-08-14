import { describe, expect, it } from 'vitest';
import { parseGuardianCommand } from '../../src/guardian/control.js';

describe('parseGuardianCommand', () => {
  it('parses the safemode family of control signals', () => {
    expect(parseGuardianCommand('/safemode')?.kind).toBe('safemode');
    expect(parseGuardianCommand('/safemode start')?.kind).toBe('safemode');
    expect(parseGuardianCommand('/safemode status')?.kind).toBe('safemode-status');
    expect(parseGuardianCommand('/safemode plugins')?.kind).toBe('safemode-plugins');
    expect(parseGuardianCommand('/safemode list')?.kind).toBe('safemode-plugins');
    expect(parseGuardianCommand('/safemode exit')?.kind).toBe('safemode-exit');
    expect(parseGuardianCommand('/safemode help')?.kind).toBe('safemode-help');
    expect(parseGuardianCommand('  /SAFEMODE  STATUS  ')?.kind).toBe('safemode-status');
  });

  it('returns undefined for non-control messages', () => {
    expect(parseGuardianCommand('hello dsh')).toBeUndefined();
    expect(parseGuardianCommand('/status')).toBeUndefined();
    expect(parseGuardianCommand('')).toBeUndefined();
  });
});
