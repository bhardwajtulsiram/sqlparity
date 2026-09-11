import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The SQL parser is a large ANTLR bundle loaded on demand; the first transform and
    // grammar initialisation comfortably exceeds the 5s default.
    testTimeout: 30_000,
  },
});
