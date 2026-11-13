/**
 * An empty task-list item — the one an author has just added with Enter or
 * Insert → Task List, before typing — must stay a task item through a save.
 * GFM reads `- [ ]` with no text as a bullet whose text is "[ ]", and the
 * writer dropped the box of a task item with no content, so the item came
 * back as "• [ ]" on slides and as a plain bullet in the editor.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index.js';
import type { MarkdownList } from '../markdown/types.js';

function items(source: string) {
  return (parseMarkdown(source).children[0] as MarkdownList).children;
}

describe('empty task-list items', () => {
  it.each([
    ['- [ ]\n', false],
    ['- [ ] \n', false],
    ['- [x]\n', true],
    ['- [X]\n', true],
  ])('%j is an empty task item', (source, checked) => {
    const [item] = items(source);
    expect(item?.checked).toBe(checked);
    expect(item?.children).toEqual([]);
  });

  it('reads an empty item after a filled one', () => {
    const list = items('- [ ] Book the venue\n- [ ]\n');
    expect(list.map((item) => item.checked)).toEqual([false, false]);
    expect(list[1]?.children).toEqual([]);
  });

  it('writes the box of an empty task item and reads it back', () => {
    const doc = parseMarkdown('- [ ] Book the venue\n- [ ]\n');
    const written = stringifyMarkdown(doc);
    expect(written).toMatch(/^- \[ \] Book the venue\n- \[ \]\s*$/);
    const again = items(written);
    expect(again.map((item) => item.checked)).toEqual([false, false]);
    expect(stringifyMarkdown(parseMarkdown(written))).toBe(written);
  });

  it('leaves a bullet with other text alone', () => {
    const [item] = items('- [ ] and more\n');
    expect(item?.checked).toBe(false);
    const [plain] = items('- [maybe]\n');
    expect(plain?.checked).toBeUndefined();
  });
});
