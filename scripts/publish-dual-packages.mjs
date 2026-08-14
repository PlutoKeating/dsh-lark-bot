#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PACKAGE_NAMES = ['dsh-lark-bot', 'dsh-feishu-bot'];

const dryRun = process.argv.includes('--dry-run');
const github = process.argv.includes('--github');
const packDirArgIndex = process.argv.indexOf('--pack-dir');
const packDir =
  packDirArgIndex >= 0 ? resolve(process.argv[packDirArgIndex + 1] ?? 'release-artifacts') : undefined;

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} exited with code ${String(code)}`));
      }
    });
  });
}

async function buildPackage(name) {
  const raw = await readFile(join(ROOT, 'package.json'), 'utf8');
  const root = JSON.parse(raw);

  const { scripts, devDependencies, ...publishedManifest } = root;
  const packageName = github
    ? `@${(process.env.GITHUB_PACKAGE_SCOPE ?? 'plutokeating').toLowerCase()}/${name}`
    : name;
  const manifest = {
    ...publishedManifest,
    name: packageName,
    bin: {
      [name]: `bin/${name}.mjs`,
    },
    files: ['dist', 'bin', 'cordis.patch.yml', 'README.md', 'SECURITY.md', 'LICENSE'],
  };
  const bundlePatch = `# ${name} as a profile bundle.

# Installed with \`dsh plugin --profile <name> add ${packageName}\` (or the
# single \`${name} setup\` command), dsh appends this package to the profile's
# \`dsh.profile.bundles\` and applies this patch on boot:
#   - \`${name}/plugin\` starts the full bridge engine IN-PROCESS (Feishu
#     channel, workspace/session layers, notify server, nested dsh SDK
#     runtime) and exposes \`ctx.larkBridge\` (status / stop).
#   - \`${name}/notify\` mounts the \`lark_notify\` tool for the host agent.
# First boot without credentials prints a QR code for one-time binding.
# Set DSH_LARK_DISABLED=1 to keep the engine stopped.

- insert:
    - id: dsh-lark-bot
      name: '${name}/plugin'
      config:
        home: !!js process.env.DSH_LARK_HOME
        tenant: !!js process.env.DSH_LARK_TENANT ?? 'feishu'
        appId: !!js process.env.DSH_LARK_APP_ID
        appSecret: !!js process.env.DSH_LARK_APP_SECRET
        workspace: !!js process.env.DSH_LARK_WORKSPACE
        adapter: !!js process.env.DSH_LARK_ADAPTER
        model: !!js process.env.DSH_LARK_MODEL
        disabled: !!js process.env.DSH_LARK_DISABLED === '1'

    - id: lark-notify
      name: '${name}/notify'
      config:
        endpoint: !!js process.env.DSH_LARK_NOTIFY_URL
        token: !!js process.env.DSH_LARK_NOTIFY_TOKEN
`;

  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  await mkdir(join(dir, 'dist'), { recursive: true });
  await Promise.all([
    copyFile(join(ROOT, 'dist', 'cli.js'), join(dir, 'dist', 'cli.js')),
    copyFile(join(ROOT, 'dist', 'index.js'), join(dir, 'dist', 'index.js')),
    copyFile(join(ROOT, 'dist', 'index.d.ts'), join(dir, 'dist', 'index.d.ts')),
    copyFile(join(ROOT, 'dist', 'cli.d.ts'), join(dir, 'dist', 'cli.d.ts')),
    copyFile(join(ROOT, 'dist', 'plugin.js'), join(dir, 'dist', 'plugin.js')),
    copyFile(join(ROOT, 'dist', 'plugin.d.ts'), join(dir, 'dist', 'plugin.d.ts')),
    copyFile(join(ROOT, 'dist', 'invariant.js'), join(dir, 'dist', 'invariant.js')),
    copyFile(join(ROOT, 'dist', 'invariant.d.ts'), join(dir, 'dist', 'invariant.d.ts')),
    copyFile(join(ROOT, 'dist', 'notify.js'), join(dir, 'dist', 'notify.js')),
    copyFile(join(ROOT, 'dist', 'notify.d.ts'), join(dir, 'dist', 'notify.d.ts')),
    copyFile(join(ROOT, 'dist', 'index.js.map'), join(dir, 'dist', 'index.js.map')),
    copyFile(join(ROOT, 'dist', 'cli.js.map'), join(dir, 'dist', 'cli.js.map')),
    copyFile(join(ROOT, 'dist', 'plugin.js.map'), join(dir, 'dist', 'plugin.js.map')),
    copyFile(join(ROOT, 'dist', 'invariant.js.map'), join(dir, 'dist', 'invariant.js.map')),
    copyFile(join(ROOT, 'dist', 'notify.js.map'), join(dir, 'dist', 'notify.js.map')),
    copyFile(join(ROOT, 'README.md'), join(dir, 'README.md')),
    copyFile(join(ROOT, 'SECURITY.md'), join(dir, 'SECURITY.md')),
    copyFile(join(ROOT, 'LICENSE'), join(dir, 'LICENSE')),
  ]);
  await writeFile(join(dir, 'cordis.patch.yml'), bundlePatch, 'utf8');

  await mkdir(join(dir, 'bin'), { recursive: true });
  await writeFile(
    join(dir, 'bin', `${name}.mjs`),
    [
      '#!/usr/bin/env node',
      "import { main } from '../dist/cli.js';",
      '',
      'await main();',
      '',
    ].join('\n'),
  );

  await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

async function main() {
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  if (packDir) await mkdir(packDir, { recursive: true });

  for (const name of PACKAGE_NAMES) {
    const dir = await buildPackage(name);
    try {
      const publishArgs = github
        ? ['publish', '--registry', 'https://npm.pkg.github.com']
        : ['publish', '--access', 'public'];
      if (dryRun) {
        publishArgs.push('--dry-run');
      } else if (process.env.GITHUB_ACTIONS === 'true' && !github) {
        publishArgs.push('--provenance');
      }
      await run('npm', publishArgs, dir);

      if (packDir) {
        await run('npm', ['pack', '--pack-destination', packDir], dir);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

await main();
