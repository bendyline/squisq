/**
 * GFM column alignment survives the WYSIWYG view. Stock Tiptap cells dropped
 * the bridge's `text-align` style, so any save rewrote `:---:` and `---:` as
 * `---`, and exports lost the alignment too.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import { AlignedTableCell, AlignedTableHeader } from '../tiptap/alignedTableCells';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

const TABLE = `| Item | Qty | Price |
| :--- | :---: | ---: |
| Flour | 2 | 3.50 |
| Sugar | 10 | 12.00 |`;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('aligned table cells', () => {
  it('keep each column alignment through an edit and a save', () => {
    editor = new Editor({
      extensions: [StarterKit, Table, TableRow, AlignedTableCell, AlignedTableHeader],
      content: markdownToTiptap(`Intro\n\n${TABLE}\n`),
    });
    editor.commands.setTextSelection(1);
    editor.commands.insertContent('Edited ');

    const markdown = tiptapToMarkdown(editor.getHTML());
    expect(markdown).toContain('Edited Intro');
    expect(markdown).toContain('| :--- | :---: | ---: |');
  });

  it('leave unaligned columns unaligned', () => {
    editor = new Editor({
      extensions: [StarterKit, Table, TableRow, AlignedTableCell, AlignedTableHeader],
      content: markdownToTiptap('| A | B |\n| --- | --- |\n| 1 | 2 |\n'),
    });
    expect(editor.getHTML()).not.toContain('text-align');
    expect(tiptapToMarkdown(editor.getHTML())).toContain('| --- | --- |');
  });
});
