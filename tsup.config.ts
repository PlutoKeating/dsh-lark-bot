import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  dts: true,
  clean: true,
});
