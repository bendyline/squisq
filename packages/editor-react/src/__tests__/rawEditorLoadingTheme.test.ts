import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RawEditor loading surface theme', () => {
  const chrome = readFileSync(
    join(process.cwd(), 'packages/editor-react/src/styles/chrome.css'),
    'utf8',
  );
  const css = readFileSync(
    join(process.cwd(), 'packages/editor-react/src/styles/editor.css'),
    'utf8',
  );

  it('gives the dark shell Monaco-matching fallback colors', () => {
    expect(chrome).toMatch(
      /:where\(\[data-theme='dark'\]\)\s*\{[^}]*--squisq-editor-background:\s*#1e1e1e;[^}]*--squisq-editor-foreground:\s*#d4d4d4;/s,
    );
  });

  it('paints the RawEditor container during the Monaco mount handoff', () => {
    expect(css).toMatch(
      /\.squisq-raw-editor-container\s*\{[^}]*background:\s*var\(--squisq-editor-background\);[^}]*color:\s*var\(--squisq-editor-foreground\);/s,
    );
  });
});
