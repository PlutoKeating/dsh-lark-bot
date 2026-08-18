import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    plugin: 'src/plugin.ts',
    invariant: 'src/invariant.ts',
    notify: 'src/notify/tool.ts',
    ask: 'src/notify/ask-tool.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: true,
  // The cordis plugin modules run inside a dsh profile; let the runtime
  // resolve its own @deepseek-ai/cordis copy. Tool definitions use the host
  // registry's raw schema boundary and do not import dsh-tools.
  external: ['@deepseek-ai/cordis'],
});
