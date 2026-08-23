import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Isolate the ambient DSH_HOME so profile-building tests never resolve to
    // (or write through) the live dsh profile. See test/setup.ts.
    setupFiles: ['./test/setup.ts'],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
