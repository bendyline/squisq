import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { afterEach, describe, expect, it } from 'vitest';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { selectionMarkdown } from '../selectionMarkdown';

let editor: Editor;
afterEach(() => editor?.destroy());
function createEditor(source: string) {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate,
      Link,
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(source),
  });
  return editor;
}

const SOURCE =
  '## So what should you use? {[factCard]}\n\nA **bold** [answer](https://example.com).';
describe('selection Markdown', () => {
  it('preserves heading levels, block annotations, inline formatting and links', () => {
    createEditor(SOURCE).commands.selectAll();
    expect(selectionMarkdown(editor.state)).toBe(SOURCE);
    expect(editor.state.doc.textContent).not.toContain('{[factCard]}');
  });

  it('round-trips tagged replacement content as metadata with one undo', () => {
    createEditor(SOURCE).commands.selectAll();
    const before = editor.getJSON();
    const replacement = selectionMarkdown(editor.state).replace('A **bold**', 'A **new**');
    editor.commands.insertContent(markdownToTiptap(replacement));
    expect(editor.state.doc.firstChild?.attrs.dataTemplate).toBe('factCard');
    expect(editor.state.doc.textContent).not.toContain('{[factCard]}');
    expect(tiptapToMarkdown(editor.getHTML()).trimEnd()).toBe(replacement);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(before);
  });

  it('keeps a complete selected heading but does not turn part of it into a new heading', () => {
    createEditor('### A **bold** heading {[factCard]}');
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.firstChild!.nodeSize - 1 });
    expect(selectionMarkdown(editor.state)).toBe('### A **bold** heading {[factCard]}');
    editor.commands.setTextSelection({ from: 3, to: 7 });
    expect(selectionMarkdown(editor.state)).toBe('**bold**');
  });

  it('preserves table structure, not just concatenated cell text', () => {
    const source = '## Results {[dataTable]}\n\n| Model | Score |\n| --- | --- |\n| Writer | 42 |';
    createEditor(source).commands.selectAll();
    expect(selectionMarkdown(editor.state)).toContain('| Model | Score |');
    expect(selectionMarkdown(editor.state)).toContain('| Writer | 42 |');
    expect(selectionMarkdown(editor.state)).toContain('## Results {[dataTable]}');
    // A text selection inside one cell should remain cell text.
    let cellText = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Writer') cellText = pos;
    });
    editor.commands.setTextSelection({ from: cellText, to: cellText + 6 });
    expect(selectionMarkdown(editor.state)).toBe('Writer');
  });

  it('keeps annotation examples literal in code blocks', () => {
    const source = '```markdown\n## Example {[factCard]}\n```';
    createEditor(source).commands.selectAll();
    expect(selectionMarkdown(editor.state)).toBe(source);
  });

  it('returns an empty string at a bare caret', () => {
    createEditor(SOURCE);
    editor.commands.setTextSelection(2);
    expect(selectionMarkdown(editor.state)).toBe('');
  });
});
