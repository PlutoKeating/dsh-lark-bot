import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
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
    const resolved = importer[section]?.[name]
      ?? (section === 'peerDependencies' ? importer.dependencies?.[name] : undefined);
    assert(resolved !== undefined, `lockfile misses ${section}.${name}`);
  }
}
for (const [coordinate, snapshot] of Object.entries(lock.packages ?? {})) {
  assert(typeof snapshot?.resolution?.integrity === 'string' || typeof snapshot?.resolution?.tarball === 'string',
    `lockfile package ${coordinate} has no immutable resolution`);
}

for (const location of ['local', 'remote']) {
  const name = `host-descriptor.${location}.json`;
  const descriptorBytes = await readFile(resolve(root, 'docs/conformance', name));
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  assert(descriptor.$schema === 'urn:dsh-tui:host-descriptor:0.15', `${name}: wrong schema`);
  assert(descriptor.trustLevel === 'trusted-in-process', `${name}: wrong trust level`);
  assert(Array.isArray(descriptor.facetApiVersions) && descriptor.facetApiVersions.includes('v1alpha1'),
    `${name}: missing host facet`);
  assert(typeof descriptor.runtime?.generationId === 'string' && descriptor.runtime.generationId,
    `${name}: missing runtime generation`);

  const claimName = `claim.${location}.json`;
  const claim = JSON.parse(await readFile(resolve(root, 'docs/conformance', claimName), 'utf8'));
  const descriptorDigest = `sha256:${createHash('sha256').update(descriptorBytes).digest('hex')}`;
  assert(claim.claimVersion === '0.15' && claim.specVersion === 'community-v0.15',
    `${claimName}: wrong claim/spec version`);
  assert(claim.subject === `${manifest.id}@${manifest.version}`, `${claimName}: wrong subject`);
  assert(claim.hostDescriptorDigest === descriptorDigest, `${claimName}: host digest mismatch`);
  assert(claim.artifactDigest === actualArtifactDigest, `${claimName}: artifact digest mismatch`);
  assert(claim.evidenceLevel === 'Tested' && claim.result === 'pass' && claim.revoked === false,
    `${claimName}: claim must be a non-revoked tested pass`);
  assert(Array.isArray(claim.failedRequirements) && claim.failedRequirements.length === 0,
    `${claimName}: failed requirements must be empty`);
}

const packRoot = await mkdtemp(join(tmpdir(), 'dsh-lark-tui-pack-'));
try {
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', packRoot,
  ], { cwd: root, encoding: 'utf8' }));
  const tarball = resolve(packRoot, packed[0]?.filename ?? '');
  assert(relative(packRoot, tarball) && !relative(packRoot, tarball).startsWith('..'),
    'npm pack did not return a package inside the temporary directory');
  const consumer = resolve(packRoot, 'consumer');
  await mkdir(consumer);
  await writeFile(resolve(consumer, 'package.json'), '{"name":"dsh-lark-tui-consumer","private":true}\n');
  execFileSync('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    '--legacy-peer-deps', '--omit=dev', tarball,
  ], { cwd: consumer, stdio: 'pipe' });
  const installed = await readFile(resolve(consumer, 'node_modules', packageJson.name, artifact.path));
  const installedDigest = `sha256:${createHash('sha256').update(installed).digest('hex')}`;
  assert(installedDigest === actualArtifactDigest,
    `installed npm artifact digest mismatch: ${installedDigest}`);
} finally {
  await rm(packRoot, { recursive: true, force: true });
}

process.stdout.write(`[tui-admission] manifest, packed/installed artifact, full lock integrity, descriptors and claims verified (${actualArtifactDigest})\n`);

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
