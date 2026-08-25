import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { downscaleImageIfNeeded } from '../../src/media/image-scale.js';

async function writePng(root: string, name: string, width: number, height: number): Promise<string> {
  const path = join(root, name);
  await sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 80, b: 200 } },
  })
    .png()
    .toFile(path);
  return path;
}

async function dims(path: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(path).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

describe('downscaleImageIfNeeded (proportional scaling)', () => {
  it('downscales an oversized handset screenshot proportionally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-scale-'));
    try {
      const path = await writePng(root, 'tall.png', 1080, 2344);
      const before = await dims(path);
      const out = await downscaleImageIfNeeded(path, 2000);
      const after = await dims(out);
      expect(out).toBe(path);
      expect(Math.max(after.width, after.height)).toBeLessThanOrEqual(2000);
      // The long side binds exactly at the limit.
      expect(Math.max(after.width, after.height)).toBe(2000);
      // Aspect ratio is preserved within luminance rounding.
      expect(after.width / after.height).toBeCloseTo(before.width / before.height, 2);
      expect(after.width).toBeLessThan(before.width);
      expect(after.height).toBeLessThan(before.height);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves an image already inside the bound untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-scale-'));
    try {
      const path = await writePng(root, 'small.png', 320, 240);
      const before = await dims(path);
      const out = await downscaleImageIfNeeded(path, 2000);
      const after = await dims(out);
      expect(after).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never scales when maxDimension is non-positive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-scale-'));
    try {
      const path = await writePng(root, 'tall.png', 1080, 2344);
      const before = await dims(path);
      const out = await downscaleImageIfNeeded(path, 0);
      const after = await dims(out);
      expect(out).toBe(path);
      expect(after).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
