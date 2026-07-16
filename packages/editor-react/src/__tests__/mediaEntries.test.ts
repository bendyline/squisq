import { describe, expect, it } from 'vitest';
import type { MediaEntry } from '@bendyline/squisq/schemas';
import { isVisibleMediaEntry } from '../mediaEntries.js';

function entry(name: string): MediaEntry {
  return { name, mimeType: 'application/octet-stream', size: 0 };
}

describe('isVisibleMediaEntry', () => {
  it.each([
    '.versions/index.20260101T000000Z.md',
    'document_files/.versions/index.20260101T000000Z.md',
    '.imageEdits/hero/.versions/state.20260101T000000Z.json',
    'document_files\\.versions\\index.20260101T000000Z.md',
  ])('hides anything inside a .versions directory: %s', (name) => {
    expect(isVisibleMediaEntry(entry(name))).toBe(false);
  });

  it.each([
    '.imageEdits/hero/state.json',
    'document_files/.imageEdits/hero/state.json',
    'legacy-image_files/state.json',
  ])('hides image editor state: %s', (name) => {
    expect(isVisibleMediaEntry(entry(name))).toBe(false);
  });

  it.each(['state.json', 'attachments/data.json', 'document_files/hero.png'])(
    'keeps user-facing files visible: %s',
    (name) => {
      expect(isVisibleMediaEntry(entry(name))).toBe(true);
    },
  );
});
