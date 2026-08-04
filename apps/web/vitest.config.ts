import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Component tests need a DOM; the pure-module tests are happy either way.
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Single in-process thread — see apps/api/vitest.config.ts for rationale.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
