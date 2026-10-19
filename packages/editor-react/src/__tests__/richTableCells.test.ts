import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { insertTaskList, tableContent } from '../toolbar/tiptapToolbar';

const extensions = [
  StarterKit,
  Table,
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem.configure({ nested: true }),
];

describe('rich table cells survive Markdown persistence', () => {
  it('retains inserted task items, checked states, and undo through repeated source toggles', () => {
    const editor = new Editor({
      extensions,
      content: {
        type: 'doc',
        content: [
          tableContent([
            ['', '', ''],
            ['', '', ''],
            ['', '', ''],
          ]),
        ],
      },
    });
    try {
      editor.commands.setTextSelection(4);
      insertTaskList(editor);
      expect(editor.getHTML().match(/data-type="taskItem"/g)).toHaveLength(3);
      editor.commands.undo();
      expect(editor.getHTML()).not.toContain('taskItem');
      editor.commands.redo();
      // This is the same parse/serialize boundary as switching Write/Source,
      // saving, and loading the document in a new editor.
      const before = editor.getJSON();
      for (let i = 0; i < 3; i++) {
        const source = tiptapToMarkdown(editor.getHTML());
        expect(source).not.toContain('Task 1Task 2');
        editor.commands.setContent(markdownToTiptap(source));
        expect(editor.getJSON()).toEqual(before);
      }
    } finally {
      editor.destroy();
    }
  });

  it('preserves nested lists, checked tasks, formatting, pipes, and multiline code', () => {
    const editor = new Editor({
      extensions,
      content:
        '<table><tr><th><p>Header</p></th></tr><tr><td><p>Before</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p><strong>Checked | task</strong></p><ul><li><p>Nested</p></li></ul></li><li data-type="taskItem" data-checked="false"><p>Pending</p></li></ul><pre><code>first | line\nsecond line</code></pre><p>After</p></td></tr></table>',
    });
    try {
      const before = editor.getJSON();
      const source = tiptapToMarkdown(editor.getHTML());
      expect(source.split('\n').filter((line) => line.startsWith('|'))).toHaveLength(3);
      editor.commands.setContent(markdownToTiptap(source));
      expect(editor.getJSON()).toEqual(before);
    } finally {
      editor.destroy();
    }
  });

  it('sanitizes the HTML envelope when source text is untrusted', () => {
    const html = markdownToTiptap(
      '| Header |\n| --- |\n| <div data-squisq-table-cell=""><ul onclick="alert(1)"><li>Safe<script>alert(1)</script><img src="javascript:alert(1)"></li></ul></div> |',
    );
    expect(html).not.toMatch(/onclick|<script|javascript:/);
    expect(html).toContain('Safe');
  });
});
