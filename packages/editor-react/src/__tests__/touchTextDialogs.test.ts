import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = join(process.cwd(), 'packages/editor-react/src/styles');
const touch = readFileSync(join(styles, 'touch-dialogs.css'), 'utf8');
const index = readFileSync(join(styles, 'index.css'), 'utf8');

describe('text-entry dialogs on touch screens', () => {
  it('open the link and document settings dialogs high, clear of the keyboard', () => {
    expect(touch).toMatch(/@media \(pointer: coarse\) \{/);
    expect(touch).toMatch(
      /\.squisq-link-dialog-overlay,\s*\.squisq-doc-settings-overlay \{[^}]*align-items: flex-start;/s,
    );
    // The host's keyboard measurement keeps the panel in the visible area.
    expect(touch).toContain('var(--squisq-keyboard-inset, 0px)');
    expect(touch).toMatch(
      /\.squisq-link-dialog,\s*\.squisq-doc-settings-dialog \{[^}]*max-height: 100%;/s,
    );
  });

  it('set their fields at 16px so iOS does not zoom into them', () => {
    expect(touch).toMatch(
      /\.squisq-link-dialog-input,\s*\.squisq-doc-settings-input \{[^}]*font-size: 16px;/s,
    );
  });

  it('load after editor.css, whose base dialog rules they override', () => {
    // Equal specificity: the touch rules win only by coming later.
    const base = index.indexOf("@import './editor.css';");
    const override = index.indexOf("@import './touch-dialogs.css';");
    expect(base).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(base);
  });
});
