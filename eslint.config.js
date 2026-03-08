import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
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
    rules: {
      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow explicit any in a few cases (tighten later)
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Disable rules that conflict with Prettier (must be last)
  prettier,
);
