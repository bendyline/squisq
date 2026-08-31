/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_FILE_LINK_CLASS,
  syncAccessoryFileLinkPlaceholders,
} from '../accessoryFileLinks';

describe('accessory file link placeholders', () => {
  it('marks only exact links to files in the accessory bin', () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<a href="attachments/brief.md">brief</a>',
      '<a href="https://example.com">website</a>',
    ].join('');

    syncAccessoryFileLinkPlaceholders(root, new Set(['attachments/brief.md']));

    const links = root.querySelectorAll('a');
    expect(links[0]?.classList.contains(ACCESSORY_FILE_LINK_CLASS)).toBe(true);
    expect(links[1]?.classList.contains(ACCESSORY_FILE_LINK_CLASS)).toBe(false);
  });

  it('removes a stale placeholder when the file leaves the bin', () => {
    const root = document.createElement('div');
    root.innerHTML = `<a class="${ACCESSORY_FILE_LINK_CLASS}" href="brief.md">brief</a>`;

    syncAccessoryFileLinkPlaceholders(root, new Set());

    expect(root.querySelector('a')?.classList.contains(ACCESSORY_FILE_LINK_CLASS)).toBe(false);
  });
});
