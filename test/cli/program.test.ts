import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../src/cli.js';

describe('buildProgram', () => {
  it('registers the expected top-level commands', () => {
    const program = buildProgram();

    expect(program.name()).toBe('dsh-lark-bot');
    expect(program.commands.map((command) => command.name())).toContain('start');
    expect(program.commands.map((command) => command.name())).toContain('doctor');
  });
});
