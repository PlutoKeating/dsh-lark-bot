import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../src/cli.js';

describe('buildProgram', () => {
  it('registers the expected top-level commands', () => {
    const program = buildProgram();

    expect(program.name()).toBe('dsh-lark-bot');
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(
      expect.arrayContaining(['start', 'status', 'restart', 'stop', 'doctor']),
    );
  });

  it('keeps internal run/supervise commands hidden from help', () => {
    const program = buildProgram();
    const run = program.commands.find((command) => command.name() === 'run');
    const supervise = program.commands.find((command) => command.name() === 'supervise');
    expect((run as unknown as { _hidden: boolean })._hidden).toBe(true);
    expect((supervise as unknown as { _hidden: boolean })._hidden).toBe(true);
  });
});
