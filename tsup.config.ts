import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    plugin: 'src/plugin.ts',
    invariant: 'src/invariant.ts',
    notify: 'src/notify/tool.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: true,
  // The cordis plugin modules run inside a dsh profile; let the runtime
  // resolve its own @deepseek-ai/cordis and @deepseek-ai/dsh-tools copies.
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools'],
});
