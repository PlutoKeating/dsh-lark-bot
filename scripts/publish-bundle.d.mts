export interface PublishManifest {
  name?: string;
  version?: string;
  exports?: Record<string, unknown>;
  bin?: Record<string, string>;
  [key: string]: unknown;
}

export const PUBLISH_FILES: string[];

export function bundlePatchFor(name: string, packageName?: string): string;

export function copyDirRecursive(src: string, dest: string): Promise<void>;

export function collectRequiredDistFiles(pkg: PublishManifest): string[];

export function validateDistCompleteness(
  distDir: string,
  pkg: PublishManifest,
  options?: { label?: string },
): string[];

export function assemblePackage(options: {
  root: string;
  name: string;
  githubScope?: string;
  dir?: string;
}): Promise<string>;
