import { writeFile } from 'node:fs/promises';

/**
 * Inbound image scaling.
 *
 * The upstream dsh attachment store (`dsh-attachment-local`) rejects any
 * image whose longer side exceeds its configured `maxImageDimension` (default
 * 2000px), failing the whole turn with `IMAGE_DIMENSION_TOO_LARGE`. Downscale
 * here keeps a tall screenshot inside that bound without touching the host
 * store's own limit; the deployed model route is also documented to reject a
 * side above 2000px once a request carries many images, so the same ceiling
 * applies. The bound is configurable via `DSH_LARK_IMAGE_MAX_DIMENSION`.
 */

/** Format name accepted by sharp, derived from the file extension. */
function formatFromExtension(path: string): 'png' | 'jpeg' | 'webp' | 'gif' | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpeg';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.gif')) return 'gif';
  return undefined;
}

/**
 * Proportionally downscale an image so its longer side is at most
 * `maxDimension`. Writes the result back to `path`, preserving the source
 * format (png/jpeg/webp/gif). Images already inside the bound are returned
 * untouched (no re-encode).
 *
 * `sharp` is an optional dependency and is loaded lazily: when it is missing
 * (or any step fails) the original path is returned unchanged, so the image
 * pipeline never breaks on a setup without image processing — the upstream
 * admission simply keeps its own limit semantics.
 *
 * @param path - image file to inspect / rewrite (extension drives output format).
 * @param maxDimension - target long-edge bound in px; non-positive disables scaling.
 * @returns the path actually holding the image (unchanged when nothing scaled).
 */
export async function downscaleImageIfNeeded(
  path: string,
  maxDimension: number,
): Promise<string> {
  if (typeof maxDimension !== 'number' || !Number.isFinite(maxDimension) || maxDimension <= 0) {
    return path;
  }
  const format = formatFromExtension(path);
  if (!format) return path;

  let sharp: typeof import('sharp')['default'] | undefined;
  try {
    const mod = (await import('sharp')) as unknown as { default: typeof import('sharp')['default'] };
    sharp = mod.default;
  } catch {
    // Optional dependency not installed in this runtime — fall through.
    return path;
  }
  if (!sharp) return path;

  try {
    const image = sharp(path, { failOn: 'error' });
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const longSide = Math.max(width, height);
    if (longSide <= maxDimension) return path;

    const data = await sharp(path, { failOn: 'error' })
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toFormat(format)
      .toBuffer();
    await writeFile(path, data);
    return path;
  } catch {
    // Decode / encode failure — keep the original file so admission sees the
    // real input and reports the actual limit instead of a masked error.
    return path;
  }
}
