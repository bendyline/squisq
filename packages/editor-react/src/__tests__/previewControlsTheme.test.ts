import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(process.cwd(), 'packages/editor-react/src/styles/editor.css'),
  'utf8',
);

describe('preview control theme', () => {
  it('uses host accent tokens for segmented control selection states', () => {
    expect(css).toMatch(
      /\.squisq-preview-seg-btn--active\s*\{[^}]*background:\s*var\(--squisq-accent,\s*#2563eb\);[^}]*color:\s*var\(--squisq-text-on-accent,\s*#fff\);/s,
    );
    expect(css).toMatch(
      /\.squisq-preview-seg-btn--active:hover\s*\{[^}]*background:\s*var\(--squisq-accent-hover,\s*var\(--squisq-accent,\s*#2563eb\)\);/s,
    );
  });
});
