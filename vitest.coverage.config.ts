import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * Coverage ratchet for published runtime packages. Thresholds intentionally
 * start modestly: all source files are included, including previously unseen
 * branches. Raise each package threshold as gaps are closed; never lower one
 * merely to make a change pass.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: [
          'packages/core/src/**/*.{ts,tsx}',
          'packages/formats/src/**/*.{ts,tsx}',
          'packages/react/src/**/*.{ts,tsx}',
          'packages/video/src/**/*.{ts,tsx}',
          'packages/video-react/src/**/*.{ts,tsx}',
          'packages/editor-react/src/**/*.{ts,tsx}',
        ],
        exclude: [
          '**/*.d.ts',
          '**/__tests__/**',
          '**/*.test.{ts,tsx}',
          '**/*.fixtures.ts',
          '**/standalone-entry.tsx',
        ],
        reporter: ['text', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
        reportOnFailure: true,
        thresholds: {
          lines: 30,
          functions: 30,
          statements: 30,
          branches: 25,
          'packages/core/src/**': {
            lines: 45,
            functions: 45,
            statements: 45,
            branches: 40,
          },
          'packages/formats/src/**': {
            lines: 55,
            functions: 55,
            statements: 55,
            branches: 45,
          },
          'packages/react/src/**': {
            lines: 20,
            functions: 20,
            statements: 20,
            branches: 15,
          },
          'packages/video/src/**': {
            lines: 35,
            functions: 35,
            statements: 35,
            branches: 30,
          },
          'packages/video-react/src/**': {
            lines: 20,
            functions: 20,
            statements: 20,
            branches: 15,
          },
          'packages/editor-react/src/**': {
            lines: 20,
            functions: 20,
            statements: 20,
            branches: 15,
          },
        },
      },
    },
  }),
);
