/** @vitest-environment jsdom */

/**
 * A rich block at the end of a document must leave a place to keep typing
 * below it. Before the trailing paragraph, a diagram, tree, timeline or code
 * snippet that ended the document trapped the caret: Ctrl+End landed in its
 * hidden source, a click below went back above it, and a double-click below
 * selected the hidden source so the next keystroke deleted the block.
 */
import { Editor, getHTMLFromFragment } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import {
  needsTrailingParagraph,
  TrailingParagraphExtension,
  withoutTrailingParagraph,
} from '../trailingParagraph';
import {
  insertAsciiDiagramBlock,
  insertChartBlock,
  insertFenceBlock,
  insertTemplateHeading,
  insertTimelineBlock,
} from '../toolbar/sceneBlockInserts';
import { insertTaskList } from '../toolbar/tiptapToolbar';

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function makeEditor(markdown: string, onUpdate?: () => void): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      TrailingParagraphExtension,
    ],
    content: markdownToTiptap(markdown),
    ...(onUpdate ? { onUpdate } : {}),
  });
  editors.push(editor);
  return editor;
}

function topLevel(editor: Editor): string[] {
  const names: string[] = [];
  editor.state.doc.forEach((node) => {
    const template = (node.attrs as { dataTemplate?: string | null }).dataTemplate;
    names.push(template ? `${node.type.name}:${template}` : node.type.name);
  });
  return names;
}

function caretIn(editor: Editor, text: string): void {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target < 0 && node.isTextblock && node.textContent === text) target = pos + 1;
  });
  if (target < 0) throw new Error(`no textblock "${text}"`);
  editor.commands.setTextSelection(target + text.length);
}

/** The top-level block the caret is in, as `name:text`. */
function caretBlock(editor: Editor): string {
  const { $from } = editor.state.selection;
  const block = $from.node(1);
  return `${block.type.name}:${block.textContent}`;
}

/** The Markdown the Write view saves (WysiwygEditor's onUpdate path). */
function markdown(editor: Editor): string {
  const doc = withoutTrailingParagraph(editor.state.doc);
  return tiptapToMarkdown(getHTMLFromFragment(doc.content, editor.schema));
}

/** Tiptap emits `create` (where the extension corrects a loaded document) a tick later. */
function created(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('needsTrailingParagraph', () => {
  it.each([
    ['a diagram fence', 'Intro.\n\n```diagram\n[A]\n```\n', true],
    ['a code fence', 'Intro.\n\n```python\nprint(1)\n```\n', true],
    ['a table', '| A | B |\n| --- | --- |\n| 1 | 2 |\n', true],
    ['a drawing heading', 'Intro.\n\n## Sketch {[drawing]}\n', true],
    ['a paragraph', 'Intro.\n', false],
    ['a plain heading', 'Intro.\n\n## Next\n', false],
    ['a bullet list', '- one\n- two\n', false],
    ['a blockquote', '> Quote\n', false],
  ])('%s at the end: %s', (_label, md, expected) => {
    // Read the document as loaded, before the extension corrects it.
    expect(needsTrailingParagraph(makeEditor(md).state.doc)).toBe(expected);
  });
});

describe('TrailingParagraphExtension', () => {
  it('adds a paragraph after a fence that ends a loaded document without reporting an edit', async () => {
    const onUpdate = vi.fn();
    const source = 'Intro.\n\n```diagram\n[A]\n```\n';
    const editor = makeEditor(source, onUpdate);
    await created();
    expect(topLevel(editor)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    expect(onUpdate).not.toHaveBeenCalled();
    // The empty paragraph is not Markdown: the document is unchanged.
    expect(markdown(editor)).toBe(source);
    // Nothing to undo.
    expect(editor.can().undo()).toBe(false);
  });

  it('adds one after an edit leaves a fence last, outside the undo history', () => {
    const editor = makeEditor('Intro.\n');
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'codeBlock',
      attrs: { language: 'tree' },
      content: [{ type: 'text', text: 'src/' }],
    });
    expect(topLevel(editor)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    editor.commands.undo();
    expect(topLevel(editor).filter((name) => name === 'codeBlock')).toEqual([]);
  });

  it('Ctrl+End reaches a line below a trailing diagram, and typing there stays below it', async () => {
    const editor = makeEditor('Intro.\n\n```diagram\n[A]\n```\n');
    await created();
    editor.commands.focus('end');
    expect(caretBlock(editor)).toBe('paragraph:');
    editor.commands.insertContent('After.');
    expect(markdown(editor)).toBe('Intro.\n\n```diagram\n[A]\n```\n\nAfter.\n');
  });

  it('keeps an author’s own trailing blank line, which the bridge preserves on purpose', async () => {
    const source = 'Intro.\n\n```diagram\n[A]\n```\n\n\n';
    const editor = makeEditor(source);
    const loaded = topLevel(editor);
    await created();
    // The loaded blank line already gives a place to type; nothing appended,
    // and the author's blank line is still saved.
    expect(loaded[loaded.length - 1]).toBe('paragraph');
    expect(topLevel(editor)).toEqual(loaded);
    expect(markdown(editor)).toBe(tiptapToMarkdown(editor.getHTML()));
  });

  it('saves nothing extra after a diagram inserted at the end', () => {
    const editor = makeEditor('Intro.\n');
    caretIn(editor, 'Intro.');
    insertAsciiDiagramBlock(editor);
    expect(markdown(editor)).toMatch(/```\n$/);
  });

  it('leaves an ordinary document alone', async () => {
    const onUpdate = vi.fn();
    const editor = makeEditor('# Title\n\nBody.\n', onUpdate);
    await created();
    expect(topLevel(editor)).toEqual(['heading', 'paragraph']);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('inserting a widget block puts the caret below it', () => {
  it('turns the empty line holding the caret into the diagram', () => {
    const editor = makeEditor('Intro.\n\nMore.\n');
    caretIn(editor, 'Intro.');
    editor.commands.splitBlock(); // a new empty line after "Intro."
    insertAsciiDiagramBlock(editor);
    // No blank line left behind above the diagram; the caret moves on to
    // the paragraph that follows it.
    expect(topLevel(editor)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    expect(caretBlock(editor)).toBe('paragraph:More.');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
  });

  it('opens a line between the diagram and a heading that follows it', () => {
    const editor = makeEditor('Intro.\n\n## Next\n');
    caretIn(editor, 'Intro.');
    insertAsciiDiagramBlock(editor);
    expect(topLevel(editor)).toEqual(['paragraph', 'codeBlock', 'paragraph', 'heading']);
    editor.commands.insertContent('Below.');
    expect(markdown(editor)).toMatch(/```\n\nBelow\.\n\n## Next\n$/);
  });

  it('continues on the line after a timeline inserted at the end of the document', () => {
    const editor = makeEditor('Intro.\n');
    caretIn(editor, 'Intro.');
    insertTimelineBlock(editor);
    expect(topLevel(editor)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    expect(caretBlock(editor)).toBe('paragraph:');
  });

  it('keeps focus handling for code snippets, which edit in their own editor', () => {
    const editor = makeEditor('Intro.\n');
    caretIn(editor, 'Intro.');
    insertFenceBlock(editor, 'print(1)', 'python', { focusInsertedCodeSnippet: true });
    expect(caretBlock(editor)).toBe('paragraph:Intro.');
    // Still somewhere to type once the snippet is done.
    expect(topLevel(editor)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
  });
});

describe('heading-based inserts select their generated title', () => {
  it('a chart: typing names it instead of being prepended to "Column chart"', () => {
    const editor = makeEditor('## Spending\n\nWhere the money goes.\n');
    caretIn(editor, 'Where the money goes.');
    insertChartBlock(editor, {
      template: 'columnChart',
      headingText: 'Column chart',
      table: { headers: ['Category', 'Value'], rows: [['A', '1']] },
    });
    expect(
      editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
    ).toBe('Column chart');
    editor.commands.insertContent('Budget by month');
    expect(markdown(editor)).toContain('### Budget by month {[columnChart]}');
    // The table ends the document; a line below it is available.
    const blocks = topLevel(editor);
    expect(blocks[blocks.length - 1]).toBe('paragraph');
  });

  it('a drawing', () => {
    const editor = makeEditor('Intro.\n');
    caretIn(editor, 'Intro.');
    insertTemplateHeading(editor, { template: 'drawing', text: 'Drawing' });
    editor.commands.insertContent('Floor plan');
    expect(markdown(editor)).toContain('## Floor plan {[drawing]}');
    expect(topLevel(editor)).toEqual(['paragraph', 'heading:drawing', 'paragraph']);
  });
});

describe('an empty task item through Markdown', () => {
  it('stays an empty task item, not a "[ ]" bullet', () => {
    // What a just-inserted, still-empty task list saves as, and loads back.
    const editor = makeEditor('Before we leave.\n');
    caretIn(editor, 'Before we leave.');
    editor.commands.splitBlock();
    insertTaskList(editor);
    const saved = markdown(editor);
    const reloaded = makeEditor(saved);
    const item = reloaded.state.doc.lastChild?.firstChild;
    expect(reloaded.state.doc.lastChild?.type.name).toBe('taskList');
    expect(item?.type.name).toBe('taskItem');
    expect(item?.textContent).toBe('');
    expect(markdown(reloaded)).toBe(saved);
  });
});

describe('Insert → Task List', () => {
  it('starts one empty item with the caret in it', () => {
    const editor = makeEditor('Before we leave.\n');
    caretIn(editor, 'Before we leave.');
    editor.commands.splitBlock();
    insertTaskList(editor);
    editor.commands.insertContent('Book the venue');
    expect(markdown(editor)).toBe('Before we leave.\n\n- [ ] Book the venue\n');
  });
});
