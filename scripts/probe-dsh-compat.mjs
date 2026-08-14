#!/usr/bin/env node
// Real availability probe for the pinned DeepSeek Harness matrix.
//
// Boots a scratch DSH_HOME with the exact pinned `@deepseek-ai/dsh` +
// `@deepseek-ai/dsh-base`, seeds a minimal bot profile, then runs
// `dist/cli.js doctor` with DSH_LARK_ADAPTER=sdk. The doctor builds the real
// SDK adapter: it creates the JSON-RPC runtime profile, pnpm-installs
// `@deepseek-ai/dsh-sdk-jsonrpc-server` at the pinned version, discovers the
// harness binary and performs a real SDK initialize round-trip.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDshCompatibility, rootDir } from './dsh-compat.mjs';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

async function main() {
  const compat = readDshCompatibility();
  const rootPackage = JSON.parse(
    readFileSync(join(rootDir(), 'package.json'), 'utf8'),
  );
  const root = await mkdtemp(join(tmpdir(), 'dsh-compat-probe-'));
  const dshHome = join(root, 'dsh');
  const larkHome = join(root, 'lark');
  const workspace = join(root, 'workspace');
  const env = {
    ...process.env,
    // The scratch profiles workspace grows a package.json dynamically (the
    // bot writes the runtime profile before its own pnpm install), so the
    // workspace lockfile is intentionally re-generated. CI forces
    // `frozen-lockfile` by default; opt out for the scratch workspace only.
    npm_config_frozen_lockfile: 'false',
    DSH_HOME: dshHome,
    DSH_LARK_HOME: larkHome,
    DSH_LARK_ADAPTER: 'sdk',
    DSH_LARK_WORKSPACE: workspace,
  };
  delete env.DSH_LARK_DSH_COMMAND;
  delete env.DSH_LARK_DSH_ARGS;

  try {
    // 1. Install the pinned harness + base bundle into the scratch dsh home.
    const profilesRoot = join(dshHome, 'profiles');
    await mkdir(profilesRoot, { recursive: true });
    await writeFile(
      join(profilesRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'dsh-compat-probe-profiles',
          private: true,
          // Pin the same pnpm the repo uses so corepack and CI behave alike.
          packageManager: rootPackage.packageManager,
          dependencies: {
            '@deepseek-ai/dsh': compat.harness,
            '@deepseek-ai/dsh-base': compat.harness,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    // pnpm 10 blocks dependency build scripts by default; the dsh harness
    // ships native modules (node-pty, koffi, protobufjs...), so the scratch
    // workspace opts into running them, exactly like a normal dsh install.
    await writeFile(
      join(profilesRoot, 'pnpm-workspace.yaml'),
      [
        'packages:',
        '  - "*"',
        'dangerouslyAllowAllBuilds: true',
        '',
      ].join('\n'),
      'utf8',
    );
    console.log(`[probe] installing dsh ${compat.harness} into ${dshHome}`);
    await run('pnpm', ['install'], { cwd: profilesRoot, env });

    // 2. Assert the installed harness version matches the matrix.
    const harnessBin = join(
      profilesRoot,
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'lib',
      'bin.js',
    );
    const versionCheck = spawn('node', [harnessBin, '--version'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const versionOutput = await new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      versionCheck.stdout.on('data', (chunk) => {
        out += String(chunk);
      });
      versionCheck.stderr.on('data', (chunk) => {
        err += String(chunk);
      });
      versionCheck.once('error', reject);
      versionCheck.once('exit', (code) => resolve({ code, out, err }));
    });
    if (versionOutput.code !== 0) {
      throw new Error(`dsh --version failed: ${versionOutput.err || versionOutput.out}`);
    }
    const version = versionOutput.out.trim();
    if (!version.includes(compat.harness)) {
      throw new Error(`dsh version mismatch: got "${version}", expected ${compat.harness}`);
    }
    console.log(`[probe] harness version ok: ${version}`);

    // 3. Seed a minimal bot profile so `doctor` can run its real probe.
    await mkdir(larkHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(
      join(larkHome, 'config.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          activeProfile: 'default',
          profiles: {
            default: {
              schemaVersion: 1,
              agentKind: 'dsh',
              tenant: 'feishu',
              accounts: {
                appId: 'cli_compat_probe',
                appSecret: 'compat-probe-secret',
              },
              workspaces: { default: workspace },
              preferences: {
                model: 'deepseek-v4-flash',
                stopGraceMs: 5000,
                runTimeoutMs: 300000,
              },
              access: { allowedUsers: [], allowedChats: [], admins: [] },
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // 4. Real availability probe through the shipped CLI.
    console.log('[probe] running `doctor` (SDK runtime bootstrap + initialize round-trip)');
    const doctor = spawn('node', [join(rootDir(), 'dist', 'cli.js'), 'doctor'], {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const doctorCode = await new Promise((resolve) => {
      doctor.once('exit', (code) => resolve(code ?? 1));
    });
    if (doctorCode !== 0) {
      throw new Error(`doctor exited with code ${doctorCode}`);
    }
    console.log(`[probe] ok: sdk-server ${compat.sdkServer} round-trip against dsh ${compat.harness}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
