import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Single in-process thread — see apps/api/vitest.config.ts for rationale.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
