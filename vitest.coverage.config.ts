import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * Coverage ratchet for published runtime packages. All source files are
 * included, including files that no test imports. Package floors sit just
 * below the measured baseline so ordinary variance has a small buffer while
 * meaningful regressions fail the build. Raise floors as gaps are closed;
 * never lower one merely to make a change pass.
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
        // 'text-summary' prints only the compact totals block, not the full
        // per-file ASCII table — so a test failure or a threshold breach reads
        // plainly instead of being buried under hundreds of file rows. The
        // detailed table still lives in the 'html' report under coverage/.
        reporter: ['text-summary', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
        reportOnFailure: true,
        thresholds: {
          lines: 72,
          functions: 68,
          statements: 70,
          branches: 60,
          'packages/core/src/**': {
            lines: 88,
            functions: 89,
            statements: 86,
            branches: 75,
          },
          'packages/formats/src/**': {
            lines: 84,
            functions: 85,
            statements: 81,
            branches: 67,
          },
          'packages/react/src/**': {
            lines: 70,
            functions: 69,
            statements: 68,
            branches: 57,
          },
          'packages/video/src/**': {
            lines: 88,
            functions: 92,
            statements: 88,
            branches: 79,
          },
          'packages/video-react/src/**': {
            lines: 58,
            functions: 62,
            statements: 56,
            branches: 47,
          },
          'packages/editor-react/src/**': {
            lines: 58,
            functions: 55,
            statements: 55,
            branches: 47,
          },
        },
      },
    },
  }),
);
