/** @vitest-environment jsdom */

/**
 * DataCardExtension: claims paragraphs that are entirely one link to a
 * relative data file, leaves prose links and non-data links alone, and —
 * the load-bearing contract — never perturbs the markdown round-trip
 * (the card is decoration-only; the link paragraph stays authoritative).
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';
import { DATA_CARD_KEY, DataCardExtension, dataLinkHrefOf } from '../dataCard/DataCardExtension';

const editors: Editor[] = [];

function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      LinkWithTitle.configure({ openOnClick: false, autolink: false }),
      DataCardExtension.configure({
        mediaProvider: () => null,
        mediaRevision: () => 0,
      }),
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function entriesOf(editor: Editor) {
  return DATA_CARD_KEY.getState(editor.state)?.entries ?? [];
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

const REFERENCE_DOC = [
  '## Q3 Transactions {[dataTable src=report_files/data/q3.csv]}',
  '',
  '[q3.csv](report_files/data/q3.csv)',
  '',
  'Some prose with an inline [q3.csv](report_files/data/q3.csv) link.',
  '',
  '[readme](docs/readme.md)',
].join('\n');

describe('DataCardExtension claiming', () => {
  it('claims exactly the standalone data-link paragraph', () => {
    const editor = makeEditor(REFERENCE_DOC);
    const entries = entriesOf(editor);

    expect(entries).toHaveLength(1);
    const node = editor.state.doc.nodeAt(entries[0].pos);
    expect(node?.type.name).toBe('paragraph');
    expect(dataLinkHrefOf(node!)).toBe('report_files/data/q3.csv');
  });

  it('claims xlsx and parquet links too', () => {
    const editor = makeEditor(
      '[book.xlsx](r_files/data/book.xlsx)\n\n[m.parquet](r_files/data/m.parquet)',
    );
    expect(entriesOf(editor)).toHaveLength(2);
  });

  it('ignores absolute and non-data links', () => {
    const editor = makeEditor(
      '[remote](https://example.com/q3.csv)\n\n[abs](/data/q3.csv)\n\n[doc](notes.md)',
    );
    expect(entriesOf(editor)).toHaveLength(0);
  });

  it('keeps ids stable across an unrelated edit', () => {
    const editor = makeEditor(REFERENCE_DOC);
    const before = entriesOf(editor)[0];

    editor.commands.insertContentAt(0, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro.' }] },
    ]);

    const after = entriesOf(editor)[0];
    expect(after.id).toBe(before.id);
    expect(after.pos).not.toBe(before.pos);
  });
});

describe('DataCardExtension round-trip conformance', () => {
  it('does not perturb the markdown round-trip while active', () => {
    const withExtension = makeEditor(REFERENCE_DOC);
    const bare = new Editor({
      extensions: [StarterKit, LinkWithTitle.configure({ openOnClick: false, autolink: false })],
      content: markdownToTiptap(REFERENCE_DOC),
    });
    editors.push(bare);

    expect(tiptapToMarkdown(withExtension.getHTML())).toBe(tiptapToMarkdown(bare.getHTML()));
    expect(tiptapToMarkdown(withExtension.getHTML())).toContain(
      '[q3.csv](report_files/data/q3.csv)',
    );
  });
});
