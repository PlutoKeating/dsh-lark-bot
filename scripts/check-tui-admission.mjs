import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'dsh-plugin.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const manifests = await findManifests(root);
assert(manifests.length === 1 && manifests[0] === 'dsh-plugin.json',
  `expected one root dsh-plugin.json, found: ${manifests.join(', ')}`);
assert(/^https?:\/\//u.test(manifest.$schema), '$schema must be an absolute HTTP(S) URI');
assert(manifest.manifestVersion === '0.15', 'manifestVersion must be 0.15');
assert(manifest.facets?.host?.entry === 'dist/plugin.js', 'host entry must be dist/plugin.js');
assert(manifest.facets?.host?.apiVersion === 'v1alpha1', 'host apiVersion must be v1alpha1');
assert(manifest.facets.client === undefined && manifest.facets.worker === undefined,
  'client/worker facets are forbidden by TUI Admission v0.15');
assert(Array.isArray(manifest.requires?.contracts), 'requires.contracts must be declared');
assert(manifest.requires?.services === undefined, 'requires.services is forbidden');
assert(manifest.provides === undefined, 'provides is forbidden');
for (const contract of manifest.requires.contracts) {
  assert(contract.optional !== true || typeof contract.fallback === 'string' && contract.fallback.trim(),
    `optional contract ${contract.apiVersion} ${contract.kind} requires fallback`);
}
assert(Array.isArray(manifest.permissions), 'permissions must be declared');
assert(Array.isArray(manifest.subscriptions), 'subscriptions must be declared');
assert(Array.isArray(manifest.contributes?.commands), 'contributes.commands must be declared');
assert(manifest.license === 'AGPL-3.0', 'project license must remain AGPL-3.0');
assert(manifest.source?.repository === 'https://github.com/PlutoKeating/dsh-lark-bot',
  'source repository must identify this project');

const artifact = manifest.artifact;
assert(artifact?.algorithm === 'sha256', 'verified artifact algorithm must be sha256');
assert(typeof artifact?.path === 'string', 'verified artifact path is required');
assert(/^sha256:[a-f0-9]{64}$/u.test(artifact?.digest ?? ''), 'verified artifact digest is invalid');
const artifactPath = resolve(root, artifact.path);
assert(relative(root, artifactPath) !== '' && !relative(root, artifactPath).startsWith('..'),
  'artifact path must stay inside the package');
const actualArtifactDigest = `sha256:${createHash('sha256').update(await readFile(artifactPath)).digest('hex')}`;
assert(actualArtifactDigest === artifact.digest,
  `artifact digest mismatch: manifest=${artifact.digest} actual=${actualArtifactDigest}`);

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = parseYaml(await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
const importer = lock?.importers?.['.'];
assert(importer && typeof importer === 'object', 'pnpm lockfile root importer is missing');
for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
  for (const name of Object.keys(packageJson[section] ?? {})) {
    assert(importer[section]?.[name] !== undefined, `lockfile misses ${section}.${name}`);
  }
}

for (const name of ['host-descriptor.local.json', 'host-descriptor.remote.json']) {
  const descriptor = JSON.parse(await readFile(resolve(root, 'docs/conformance', name), 'utf8'));
  assert(descriptor.$schema === 'urn:dsh-tui:host-descriptor:0.15', `${name}: wrong schema`);
  assert(descriptor.trustLevel === 'trusted-in-process', `${name}: wrong trust level`);
  assert(Array.isArray(descriptor.facetApiVersions) && descriptor.facetApiVersions.includes('v1alpha1'),
    `${name}: missing host facet`);
  assert(typeof descriptor.runtime?.generationId === 'string' && descriptor.runtime.generationId,
    `${name}: missing runtime generation`);
}

process.stdout.write(`[tui-admission] manifest, artifact, dependency closure and host descriptors verified (${actualArtifactDigest})\n`);

async function findManifests(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await findManifests(path, name));
    else if (entry.name === 'dsh-plugin.json') found.push(name);
  }
  return found;
}

function assert(condition, message) {
  if (!condition) throw new Error(`[tui-admission] ${message}`);
}
