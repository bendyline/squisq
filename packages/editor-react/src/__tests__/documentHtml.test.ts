import { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentHtmlSerializer } from '../documentHtml';
import { markdownToTiptap } from '../tiptapBridge';

afterEach(() => vi.restoreAllMocks());

describe('cached document HTML', () => {
  it('matches the full serializer across edits, marks, structural changes, undo and replacement', () => {
    const editor = new Editor({
      extensions: [StarterKit, Table, TableRow, TableCell, TableHeader],
      content: markdownToTiptap(
        '# Title\n\nA **bold** paragraph.\n\n- parent\n  - nested\n\n> quote\n\n```js\nx < 2\n```\n\n| A | B |\n| --- | --- |\n| x | y |',
      ),
    });
    const serialize = createDocumentHtmlSerializer();
    const check = () => expect(serialize(editor.state.doc)).toBe(editor.getHTML());
    try {
      check();
      editor.commands.setTextSelection(3);
      editor.commands.insertContent('changed');
      check();
      editor.commands.setTextSelection({ from: 1, to: 5 });
      editor.commands.toggleBold();
      check();
      editor.commands.insertContent('<p>New</p><p>blocks</p>');
      check();
      editor.commands.undo();
      check();
      editor.commands.redo();
      check();
      editor.commands.setContent('<p>Replacement document</p>');
      check();
    } finally {
      editor.destroy();
    }
  });

  it('serializes only the changed block of a large document', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i}</p>`).join(''),
    });
    const serialize = createDocumentHtmlSerializer();
    try {
      serialize(editor.state.doc);
      editor.commands.setTextSelection(2);
      editor.commands.insertContent('x');
      const createElement = vi.spyOn(document, 'createElement');
      const html = serialize(editor.state.doc);
      // One paragraph plus its temporary serialization wrapper, independent
      // of the other 399 paragraphs. Avoid hardware-dependent time assertions.
      expect(createElement.mock.calls.length).toBeLessThan(5);
      createElement.mockRestore();
      expect(html).toBe(editor.getHTML());
    } finally {
      editor.destroy();
    }
  });

  it('preserves marks spanning top-level blocks', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph*', marks: '_' },
        paragraph: { content: 'text*', toDOM: () => ['p', 0] },
        text: {},
      },
      marks: { strong: { toDOM: () => ['strong', 0] } },
    });
    const mark = schema.marks.strong.create();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('a'), [mark]),
      schema.node('paragraph', null, schema.text('b'), [mark]),
    ]);
    expect(createDocumentHtmlSerializer()(doc)).toBe('<strong><p>a</p><p>b</p></strong>');
  });
});
