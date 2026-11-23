import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL_WINDOW_DIALOG_QUERY } from '../dialogLayout';

const src = join(process.cwd(), 'packages/editor-react/src');
const styles = join(src, 'styles');
const dialogs = readFileSync(join(styles, 'dialogs.css'), 'utf8');
const touch = readFileSync(join(styles, 'touch-dialogs.css'), 'utf8');
const index = readFileSync(join(styles, 'index.css'), 'utf8');

/** Every modal overlay drawn by a stylesheet rather than inline styles. */
const MODAL_OVERLAYS = [
  'squisq-template-gallery-dialog',
  'squisq-link-dialog-overlay',
  'squisq-doc-settings-overlay',
  'squisq-media-preview',
  'squisq-media-edit-modal',
  'squisq-image-edit-modal',
  'squisq-diagram-maximized-overlay',
  'squisq-template-designer-overlay',
  'squisq-layout-manager-overlay',
];

/** The sheets whose base dialog rules dialogs.css overrides by coming later. */
const DIALOG_SHEETS = [
  './template-gallery.css',
  './editor.css',
  './image-edit-affordance.css',
  './media-edit.css',
  './diagram.css',
  '../customTemplates/designer.css',
];

function importAt(sheet: string): number {
  return index.indexOf(`@import '${sheet}';`);
}

describe('modal dialogs and the safe areas', () => {
  it('give every modal overlay the safe-area insets, host-published first', () => {
    const tokens = /([^{}]*)\{\s*--squisq-dialog-safe-top:[^}]*\}/s.exec(dialogs);
    expect(tokens).not.toBeNull();
    for (const overlay of MODAL_OVERLAYS) {
      expect(tokens![1], overlay).toContain(`.${overlay}`);
    }
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(tokens![0]).toContain(
        `--squisq-dialog-safe-${side}: var(--squisq-safe-area-${side}, env(safe-area-inset-${side}, 0px));`,
      );
    }
  });

  it('fill the window on the same phone-sized query the gallery placement reads', () => {
    expect(dialogs).toContain(`@media ${FULL_WINDOW_DIALOG_QUERY} {`);
  });

  it('run the full-window header up under the status bar', () => {
    const phone = dialogs.slice(dialogs.indexOf('@media'));
    expect(phone).toMatch(
      /\.squisq-template-gallery-dialog-header \{\s*padding: calc\(var\(--squisq-dialog-safe-top\) \+ 12px\)/,
    );
  });

  it('keep the full-window panels border-box, so their padding stays inside the window', () => {
    // A host need not reset box-sizing (DocBlocks does not); a content-box
    // panel grows by its padding, the keyboard's height included.
    const phone = dialogs.slice(dialogs.indexOf('@media'));
    const panels = /([^{}]*\.squisq-layout-manager-panel)\s*\{([^}]*)\}/s.exec(phone);
    expect(panels).not.toBeNull();
    expect(panels![1]).toContain('.squisq-template-gallery-dialog-panel');
    expect(panels![2]).toContain('box-sizing: border-box;');
    expect(panels![2]).toContain('height: 100%;');
  });

  it('load after every sheet they override, and before the touch placement', () => {
    const own = importAt('./dialogs.css');
    expect(own).toBeGreaterThan(-1);
    for (const sheet of DIALOG_SHEETS) {
      expect(importAt(sheet), sheet).toBeGreaterThan(-1);
      expect(importAt(sheet), sheet).toBeLessThan(own);
    }
    expect(importAt('./touch-dialogs.css')).toBeGreaterThan(own);
  });

  it('leave the document settings dialog a width cap of its own', () => {
    // dialogs.css sets max-width: 100% on it and loads after editor.css, so a
    // max-width in editor.css is lost and the dialog spans the whole window.
    expect(dialogs).toMatch(/\.squisq-doc-settings-dialog,[^{]*\{[^}]*max-width: 100%;/s);
    const editor = readFileSync(join(styles, 'editor.css'), 'utf8');
    const base = /\n\.squisq-doc-settings-dialog \{([^}]*)\}/.exec(editor);
    expect(base).not.toBeNull();
    expect(base![1]).toContain('width: min(100%, 440px);');
    expect(base![1]).not.toContain('max-width');
    expect(editor).toMatch(
      /@media \(min-width: 800px\) \{\s*\.squisq-doc-settings-dialog \{\s*width: min\(100%, 720px\);/,
    );
  });

  it('anchor the touch text-entry dialogs below the same insets', () => {
    expect(touch).not.toContain('env(safe-area-inset');
    expect(touch).toContain('var(--squisq-dialog-safe-top)');
    expect(touch).toContain('var(--squisq-dialog-safe-bottom)');
  });
});
