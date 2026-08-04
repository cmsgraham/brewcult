// BrewCult flat ESLint config (root — applies to every workspace).
// Module-boundary enforcement lives in .dependency-cruiser.cjs and runs as part
// of `npm run lint` via the `lint:boundaries` script (EF §1.2, backlog F-04).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error', // structured logs only (pino) — EF §7.2
    },
  },
  {
    // CommonJS config files (.dependency-cruiser.cjs, etc.).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    // tools/* and db/* (seed/migration runners) are CLI scripts —
    // console output is their UI.
    files: ['tools/**', 'db/**'],
    rules: { 'no-console': 'off' },
  },
);
