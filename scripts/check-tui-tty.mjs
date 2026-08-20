import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--child')) {
  if (process.stdout.isTTY !== true) throw new Error('stdout is not attached to a real PTY');
  process.stdout.write('[tui-tty] real PTY presentation boundary verified\n');
  process.exit(0);
}

if (process.platform === 'win32') {
  process.stdout.write('[tui-tty] automatic PTY allocation is unavailable on Windows; run the documented ConPTY smoke test\n');
  process.exit(0);
}

const self = fileURLToPath(import.meta.url);
const command = `${shellQuote(process.execPath)} ${shellQuote(self)} --child`;
const result = spawnSync('/usr/bin/script', ['-qec', command, '/dev/null'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`real PTY verification failed: ${result.stderr || result.stdout}`);
}
process.stdout.write(result.stdout);

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
