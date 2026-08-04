import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals: true`, so RTL's automatic cleanup hook never
// registers itself — do it explicitly or DOM state leaks across tests.
afterEach(() => {
  cleanup();
});
