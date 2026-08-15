import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildProgram, isDirectInvocation } from '../../src/cli.js';

describe('buildProgram', () => {
  it('registers the expected top-level commands', () => {
    const program = buildProgram();

    expect(program.name()).toBe('dsh-lark-bot');
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(['setup', 'upgrade', 'doctor', 'guardian']));
  });

  it('keeps the internal run command hidden from help', () => {
    const program = buildProgram();
    const run = program.commands.find((command) => command.name() === 'run');
    expect((run as unknown as { _hidden: boolean })._hidden).toBe(true);
  });

  it('registers guardian subcommands', () => {
    const program = buildProgram();
    const guardian = program.commands.find((command) => command.name() === 'guardian');
    const subcommands = guardian?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(
      expect.arrayContaining(['run', 'install', 'uninstall', 'status']),
    );
  });
});

describe('isDirectInvocation', () => {
  it('matches when the entry is the module itself, otherwise false', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-lark-entry-'));
    const file = join(dir, 'cli.js');
    await writeFile(file, '');
    try {
      expect(isDirectInvocation(file, pathToFileURL(file).href)).toBe(true);
      expect(isDirectInvocation(join(dir, 'bin.js'), pathToFileURL(file).href)).toBe(false);
      expect(isDirectInvocation(undefined, pathToFileURL(file).href)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
