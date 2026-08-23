import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      cli: 'src/cli.ts',
      plugin: 'src/plugin.ts',
      invariant: 'src/invariant.ts',
      notify: 'src/notify/tool.ts',
      ask: 'src/notify/ask-tool.ts',
      plan: 'src/notify/plan-tool.ts',
      approval: 'src/notify/approval-answerer.ts',
      file: 'src/notify/file-tool.ts',
      secret: 'src/notify/secret-tool.ts',
      'sdk-server': 'src/adapters/dsh/sdk-server.ts',
      skill: 'src/skill/index.ts',
    },
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    dts: true,
    clean: false,
    // The cordis plugin modules run inside a dsh profile; let the runtime
    // resolve its own service seam copies from the host profile.
    external: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-attachment',
      '@deepseek-ai/dsh-sdk-jsonrpc-server',
      '@deepseek-ai/dsh-sdk-protocol',
      '@deepseek-ai/dsh-settings',
    ],
  },
  {
    name: 'dsh-lark-bot/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'dist',
    format: ['cjs'],
    target: 'es2023',
    platform: 'browser',
    splitting: false,
    sourcemap: true,
    dts: false,
    clean: false,
    outExtension: () => ({ js: '.js' }),
    external: ['react', 'react/jsx-runtime'],
    banner: {
      js: 'window.__ModuleLoader__.load({ id: "dsh-lark-bot", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  },
]);
