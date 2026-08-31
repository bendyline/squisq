import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('maximized diagram theme surface', () => {
  it('paints the maximized canvas with the chrome surface token', () => {
    const css = readFileSync(
      join(process.cwd(), 'packages/editor-react/src/styles/diagram.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.squisq-diagram-maximized-content\s*\{[^}]*background:\s*var\(--squisq-surface\)/s,
    );
  });
});
