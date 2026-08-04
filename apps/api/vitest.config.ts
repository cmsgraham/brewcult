import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Unit suite is small; a single in-process thread keeps the run cheap and
    // avoids per-file worker processes (also friendlier to memory-constrained
    // dev machines). Revisit if the suite grows enough to want parallelism.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
