import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import sonarjs from 'eslint-plugin-sonarjs';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.config.ts',
      '**/*.config.js',
      '**/vitest.setup.ts',
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended (type-checked disabled for speed in CI)
  ...tseslint.configs.recommended,

  // React hooks rules for react & editor-react packages
  {
    files: [
      'packages/react/**/*.{ts,tsx}',
      'packages/editor-react/**/*.{ts,tsx}',
      'packages/site/**/*.{ts,tsx}',
    ],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Project-wide rule overrides
  {
    plugins: {
      sonarjs,
    },
    rules: {
      // ── Type safety ──────────────────────────────────────────────
      // Ban `as any` in production code (test files get a relaxed override below)
      '@typescript-eslint/no-explicit-any': 'error',
      // Note: `catch (err: unknown)` is enforced by TS strict mode
      // (`useUnknownInCatchVariables`). The lint rule for .catch() callbacks
      // requires type-checked mode which we skip for CI speed.

      // Allow unused vars only for function args prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // ── Code quality ─────────────────────────────────────────────
      // No console.log in production (warn/error are fine)
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Flag identical functions (catches copy-pasted utilities)
      'sonarjs/no-identical-functions': 'warn',
      // Flag identical if/else/ternary branches (e.g., `x ? 0.5 : 0.5`)
      'sonarjs/no-duplicated-branches': 'warn',
    },
  },

  // ── Test file relaxations ──────────────────────────────────────
  // Tests legitimately use `as any` for test data construction
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },

  // ── Accepted exceptions ────────────────────────────────────────
  // unified/remark processor typing requires `any` (documented in CLAUDE.md)
  {
    files: ['packages/core/src/markdown/parse.ts', 'packages/core/src/markdown/stringify.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Disable rules that conflict with Prettier (must be last)
  prettier,
);
