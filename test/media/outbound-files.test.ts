import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareOutboundFile } from '../../src/media/outbound-files.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('prepareOutboundFile', () => {
  it('loads a regular file under an approved root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'outbound-file-'));
    roots.push(root);
    await writeFile(join(root, 'report.md'), 'hello');
    const file = await prepareOutboundFile({ path: 'report.md', baseDir: root, allowedRoots: [root] });
    expect(file.fileName).toBe('report.md');
    expect(file.content.toString()).toBe('hello');
    expect(file.size).toBe(5);
  });

  it('rejects oversized files, directories, unsafe names and symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'outbound-file-'));
    const outside = await mkdtemp(join(tmpdir(), 'outbound-file-outside-'));
    roots.push(root, outside);
    await writeFile(join(root, 'large.bin'), '12345');
    await mkdir(join(root, 'dir'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
    await expect(prepareOutboundFile({ path: 'large.bin', baseDir: root, allowedRoots: [root], maxBytes: 4 })).rejects.toThrow('too large');
    await expect(prepareOutboundFile({ path: 'dir', baseDir: root, allowedRoots: [root] })).rejects.toThrow('regular file');
    await expect(prepareOutboundFile({ path: 'large.bin', baseDir: root, allowedRoots: [root], fileName: '../bad' })).rejects.toThrow('plain file name');
    await expect(prepareOutboundFile({ path: 'large.bin', baseDir: root, allowedRoots: [root], fileName: '..\\bad' })).rejects.toThrow('plain file name');
    await expect(prepareOutboundFile({ path: 'escape.txt', baseDir: root, allowedRoots: [root] })).rejects.toThrow('outside');
  });
});
