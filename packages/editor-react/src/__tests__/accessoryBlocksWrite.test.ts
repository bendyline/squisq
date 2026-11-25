/**
 * Slide summaries in the Write view: each section's run of `{[summary]}`
 * blocks folds into one row, collapsed by default, that opens in place.
 * Folded text cannot be edited by accident, the summaries stay with their
 * section through ordinary edits, and none of it reaches the saved markdown.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMSerializer } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import {
  ACCESSORY_BLOCKS_KEY,
  ACCESSORY_HIDDEN_CLASS,
  AccessoryBlocksExtension,
  accessoryRunLabel,
  toggleAccessoryRun,
} from '../accessoryBlocks/AccessoryBlocksExtension';
import { computeAccessoryRuns } from '../accessoryBlocks/accessoryBlockRuns';
import { TrailingParagraphExtension, withoutTrailingParagraph } from '../trailingParagraph';

const MARKDOWN = [
  '## Results',
  '',
  'Revenue grew 40% last year.',
  '',
  '### Revenue grew {[summary]}',
  '',
  '- Most of it from new customers',
  '',
  '#### A note inside the summary',
  '',
  '### Older results {[summary passage=abc-1 hidden=true]}',
  '',
  '## Plan',
  '',
  'Hire and ship.',
].join('\n');

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) {
    const host = editor.options.element;
    editor.destroy();
    host?.remove();
  }
});

function makeEditor(markdown = MARKDOWN, trailing = false): Editor {
  const element = document.createElement('div');
  element.className = 'squisq-wysiwyg-editor';
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      AccessoryBlocksExtension,
      ...(trailing ? [TrailingParagraphExtension] : []),
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

const markdownOf = (editor: Editor) => tiptapToMarkdown(editor.getHTML()).replace(/\n+$/, '');
const runs = (editor: Editor) => ACCESSORY_BLOCKS_KEY.getState(editor.state)!.runs;
const isOpen = (editor: Editor) => {
  const state = ACCESSORY_BLOCKS_KEY.getState(editor.state)!;
  return state.open.has(state.runs[0]!.from);
};
const row = (editor: Editor) => editor.view.dom.querySelector('.squisq-accessory-row')!;
const hiddenTexts = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll(`.${ACCESSORY_HIDDEN_CLASS}`)].map((n) => n.textContent);
function topLevel(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.forEach((node, pos) => {
    if (found < 0 && node.textContent.startsWith(text)) found = pos;
  });
  if (found < 0) throw new Error(`No top-level node starts with ${text}`);
  return found;
}
function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key });
  return !!editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event));
}

describe('runs of mixed accessory blocks', () => {
  it('fold a section’s summaries and study cards into one row, each type counted', () => {
    const editor = makeEditor(
      [
        '## Results',
        '',
        'Revenue grew.',
        '',
        '### Revenue grew {[summary]}',
        '',
        '- Up 40%',
        '',
        '### What grew? {[flashcard]}',
        '',
        'Revenue.',
        '',
        '### By how much? {[quiz]}',
        '',
        '- 10%',
        '- 40%',
        '',
        '### Who bought? {[flashcard]}',
        '',
        'New customers.',
        '',
        '## Plan',
        '',
        'Ship.',
      ].join('\n'),
    );
    expect(runs(editor)).toHaveLength(1);
    expect(accessoryRunLabel(runs(editor)[0]!)).toBe(
      'Slide summary · Flashcards (2) · Quiz question',
    );
  });
});

describe('runs of summaries', () => {
  it('fold each section’s summaries, nested headings and all, into one run', () => {
    const editor = makeEditor();
    const [run] = runs(editor);
    expect(runs(editor)).toHaveLength(1);
    expect(run!.blocks.map((block) => block.level)).toEqual([3, 3]);
    expect(run!.parentPos).toBe(topLevel(editor, 'Results'));
    expect(run!.to).toBe(topLevel(editor, 'Plan'));
    expect(accessoryRunLabel(run!)).toBe('Slide summaries (2)');
    expect(computeAccessoryRuns(editor.state.doc)).toEqual(runs(editor));
  });

  it('start folded behind a row, and open and close in place without an edit', () => {
    const editor = makeEditor();
    const before = markdownOf(editor);
    expect(row(editor).textContent).toBe('Slide summaries (2)');
    expect(row(editor).querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    expect(hiddenTexts(editor)).toEqual([
      'Revenue grew',
      'Most of it from new customers',
      'A note inside the summary',
      'Older results',
    ]);

    toggleAccessoryRun(editor.view, runs(editor)[0]!.key);
    expect(isOpen(editor)).toBe(true);
    expect(hiddenTexts(editor)).toEqual([]);
    expect(row(editor).querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(markdownOf(editor)).toBe(before);
    expect(editor.can().undo()).toBe(false);

    row(editor)
      .querySelector('button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isOpen(editor)).toBe(false);
  });
});

describe('folded summaries cannot be edited by accident', () => {
  it('moves a caret over them in the direction it was going', () => {
    const editor = makeEditor();
    const run = runs(editor)[0]!;
    editor.commands.setTextSelection(run.from + 2);
    expect(editor.state.selection.from).toBeGreaterThanOrEqual(run.to);
    editor.commands.setTextSelection(topLevel(editor, 'Plan') + 1);
    editor.commands.setTextSelection(run.to - 2);
    expect(editor.state.selection.from).toBeLessThan(run.from);
  });

  it('opens them for a selection inside, such as a Find match', () => {
    const editor = makeEditor();
    const run = runs(editor)[0]!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, run.from + 1, run.from + 8),
      ),
    );
    expect(isOpen(editor)).toBe(true);
  });

  it('opens them on Backspace or Delete at their edge instead of merging text in', () => {
    const editor = makeEditor();
    const before = markdownOf(editor);
    editor.commands.setTextSelection(topLevel(editor, 'Plan') + 1);
    expect(press(editor, 'Backspace')).toBe(true);
    expect(isOpen(editor)).toBe(true);
    expect(markdownOf(editor)).toBe(before);

    const closed = makeEditor();
    const paragraph = topLevel(closed, 'Revenue grew 40%');
    closed.commands.setTextSelection(paragraph + 1 + 'Revenue grew 40% last year.'.length);
    expect(press(closed, 'Delete')).toBe(true);
    expect(isOpen(closed)).toBe(true);
  });
});

describe('summaries stay with their section', () => {
  it('when a heading is typed just above them', () => {
    const editor = makeEditor();
    const run = runs(editor)[0]!;
    editor.view.dispatch(
      editor.state.tr.insert(
        run.from,
        editor.schema.nodes.heading.create({ level: 2 }, editor.schema.text('New section')),
      ),
    );
    expect(markdownOf(editor)).toBe(MARKDOWN.replace('## Plan', '## New section\n\n## Plan'));
    // One undo takes the heading and the repair back together.
    editor.commands.undo();
    expect(markdownOf(editor)).toBe(MARKDOWN);
  });

  it('when the heading after them is deleted, or text lands after folded ones', () => {
    const editor = makeEditor();
    const plan = topLevel(editor, 'Plan');
    const node = editor.state.doc.nodeAt(plan)!;
    editor.view.dispatch(editor.state.tr.delete(plan, plan + node.nodeSize));
    expect(markdownOf(editor)).toBe(
      MARKDOWN.replace('\n\n## Plan\n\nHire and ship.', '').replace(
        'Revenue grew 40% last year.\n\n',
        'Revenue grew 40% last year.\n\nHire and ship.\n\n',
      ),
    );

    const other = makeEditor();
    const run = runs(other)[0]!;
    other.view.dispatch(
      other.state.tr.insert(
        run.to,
        other.schema.nodes.paragraph.create(null, other.schema.text('Added')),
      ),
    );
    expect(markdownOf(other)).toContain('Revenue grew 40% last year.\n\nAdded\n\n### Revenue grew');
  });

  it('leaves text added after open summaries where it was written', () => {
    const editor = makeEditor();
    toggleAccessoryRun(editor.view, runs(editor)[0]!.key);
    const run = runs(editor)[0]!;
    editor.view.dispatch(
      editor.state.tr.insert(
        run.to,
        editor.schema.nodes.paragraph.create(null, editor.schema.text('Mine')),
      ),
    );
    expect(markdownOf(editor)).toContain(
      '{[summary passage=abc-1 hidden=true]}\n\nMine\n\n## Plan',
    );
  });

  it('when their section’s heading changes level', () => {
    const editor = makeEditor();
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(topLevel(editor, 'Results'), undefined, { level: 1 }),
    );
    expect(markdownOf(editor)).toBe(
      MARKDOWN.replace('## Results', '# Results')
        .replace('### Revenue grew', '## Revenue grew')
        .replace('#### A note', '### A note')
        .replace('### Older results', '## Older results'),
    );
  });
});

describe('the end of the document', () => {
  const ENDING = [
    '## Results',
    '',
    '```',
    'const total = 40;',
    '```',
    '',
    '### Mine {[summary]}',
    '',
    '- A point',
  ].join('\n');

  it('keeps the place to type before summaries that end the document, never inside them', () => {
    const editor = makeEditor(ENDING, true);
    editor.view.dispatch(editor.state.tr.insertText(' ', 1, 1).setMeta('addToHistory', false));
    editor.view.dispatch(editor.state.tr.delete(1, 2).setMeta('addToHistory', false));
    const run = runs(editor)[0]!;
    const before = editor.state.doc.resolve(run.from).nodeBefore!;
    expect(before.type.name).toBe('paragraph');
    expect(before.content.size).toBe(0);
    expect(tiptapToMarkdown(withoutTrailingParagraphHtml(editor)).trim()).toBe(ENDING);
  });
});

/** The HTML the editor saves: its document without the empty paragraph it added. */
function withoutTrailingParagraphHtml(editor: Editor): string {
  const div = document.createElement('div');
  div.appendChild(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(
      withoutTrailingParagraph(editor.state.doc).content,
    ),
  );
  return div.innerHTML;
}
