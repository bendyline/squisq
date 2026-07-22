import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RawEditor loading surface theme', () => {
  const css = readFileSync(
    join(process.cwd(), 'packages/editor-react/src/styles/editor.css'),
    'utf8',
  );

  it('gives the dark shell Monaco-matching fallback colors', () => {
    expect(css).toMatch(
      /\.squisq-editor-shell\[data-theme='dark'\]\s*\{[^}]*--squisq-editor-background:\s*#1e1e1e;[^}]*--squisq-editor-foreground:\s*#d4d4d4;/s,
    );
  });

  it('paints the RawEditor container during the Monaco mount handoff', () => {
    expect(css).toMatch(
      /\.squisq-raw-editor-container\s*\{[^}]*background:\s*var\(--squisq-editor-background,\s*#ffffff\);[^}]*color:\s*var\(--squisq-editor-foreground,\s*#1f2937\);/s,
    );
  });
});
