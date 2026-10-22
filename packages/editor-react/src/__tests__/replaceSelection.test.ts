/**
 * Replacing a Write-view selection edits the selected text in place.
 *
 * insertContent inserted a parsed `<p>` as a block, so ProseMirror split the
 * paragraph around it: replacing one word left three paragraphs ("We will sell
 * pastel de nata, " / "rye" / " loaves, …"), and replacing a paragraph's whole
 * text left an empty paragraph above the new one. Accepting an AI rewrite hit
 * this on every use.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { replaceEditorSelection } from '../tiptap/replaceSelection';

const BAKERY = `# Neighborhood bakery plan

Our bakery opens in March. The results was mixed in the pilot.

## Menu

We will sell pastel de nata, sourdough loaves, and seasonal fruit tarts. Prices start at two euros.

## Staffing

Two bakers start at five in the morning.
`;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(markdown: string): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ heading: false }), HeadingWithTemplate],
    content: markdownToTiptap(markdown),
  });
  return editor;
}

/** The document position range of `text`, which must sit in one text node. */
function find(ed: Editor, text: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  ed.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const index = node.text!.indexOf(text);
    if (index >= 0) found = { from: pos + index, to: pos + index + text.length };
    return false;
  });
  if (!found) throw new Error(`"${text}" is not in the document`);
  return found;
}

/** The content range of the textblock containing `text` (a triple-click). */
function blockOf(ed: Editor, text: string): { from: number; to: number } {
  const $pos = ed.state.doc.resolve(find(ed, text).from);
  return { from: $pos.start(), to: $pos.end() };
}

function markdownOf(ed: Editor): string {
  return tiptapToMarkdown(ed.getHTML());
}

describe('replacing a Write-view selection', () => {
  it('keeps a paragraph whole when one word is replaced', () => {
    const ed = open(BAKERY);
    const blocks = ed.state.doc.childCount;
    ed.commands.setTextSelection(find(ed, 'sourdough'));

    expect(replaceEditorSelection(ed, markdownToTiptap('rye'))).toBe(true);

    expect(ed.state.doc.childCount).toBe(blocks);
    expect(markdownOf(ed)).toContain(
      'We will sell pastel de nata, rye loaves, and seasonal fruit tarts. Prices start at two euros.',
    );
  });

  it('keeps a paragraph whole when one sentence is rewritten, with its formatting', () => {
    const ed = open(BAKERY);
    const blocks = ed.state.doc.childCount;
    ed.commands.setTextSelection(find(ed, 'Prices start at two euros.'));

    replaceEditorSelection(ed, markdownToTiptap('Prices begin at **two** euros.'));

    expect(ed.state.doc.childCount).toBe(blocks);
    expect(markdownOf(ed)).toContain('seasonal fruit tarts. Prices begin at **two** euros.');
  });

  it('leaves no empty paragraph when a paragraph’s whole text is replaced', () => {
    const ed = open(BAKERY);
    ed.commands.setTextSelection(blockOf(ed, 'Our bakery opens'));

    replaceEditorSelection(
      ed,
      markdownToTiptap('Our bakery opens in March. The pilot results were mixed.'),
    );

    expect(markdownOf(ed)).toBe(
      BAKERY.replace('The results was mixed in the pilot.', 'The pilot results were mixed.'),
    );
  });

  it('does not absorb the next paragraph when a drag ends at its start', () => {
    const ed = open('First paragraph.\n\nSecond paragraph.\n');
    const second = blockOf(ed, 'Second paragraph.');
    ed.commands.setTextSelection({ from: blockOf(ed, 'First paragraph.').from, to: second.from });

    replaceEditorSelection(ed, markdownToTiptap('A better first.'));

    expect(markdownOf(ed)).toBe('A better first.\n\nSecond paragraph.\n');
  });

  it('replaces whole blocks with the blocks of the reply', () => {
    const ed = open(BAKERY);
    ed.commands.setTextSelection({
      from: blockOf(ed, 'Menu').from,
      to: blockOf(ed, 'We will sell').to,
    });

    replaceEditorSelection(
      ed,
      markdownToTiptap('## What we sell\n\nPastel de nata, sourdough and tarts from two euros.'),
    );

    expect(markdownOf(ed)).toContain(
      '## What we sell\n\nPastel de nata, sourdough and tarts from two euros.\n\n## Staffing',
    );
  });

  it('turns a heading and its paragraph into one paragraph when the reply is one', () => {
    const ed = open('## Menu\n\nNata and tarts.\n\nAfter.\n');
    ed.commands.setTextSelection({
      from: blockOf(ed, 'Menu').from,
      to: blockOf(ed, 'Nata and tarts.').to,
    });

    replaceEditorSelection(ed, markdownToTiptap('We sell nata and tarts.'));

    expect(markdownOf(ed)).toBe('We sell nata and tarts.\n\nAfter.\n');
  });

  it('rewrites list items in place', () => {
    const ed = open('- one\n- two\n- three\n');
    ed.commands.setTextSelection({ from: blockOf(ed, 'one').from, to: blockOf(ed, 'two').to });

    replaceEditorSelection(ed, markdownToTiptap('- uno\n- dos'));

    expect(markdownOf(ed)).toBe('- uno\n- dos\n- three\n');
  });

  it('keeps a heading a heading when its text is rewritten', () => {
    const ed = open(BAKERY);
    ed.commands.setTextSelection(blockOf(ed, 'Staffing'));

    replaceEditorSelection(ed, markdownToTiptap('## Who works when'));

    expect(markdownOf(ed)).toContain('## Who works when\n\nTwo bakers');
  });

  it('is one undoable edit', () => {
    const ed = open(BAKERY);
    const before = ed.getHTML();
    ed.commands.setTextSelection(find(ed, 'sourdough'));
    replaceEditorSelection(ed, markdownToTiptap('rye'));

    ed.commands.undo();

    expect(ed.getHTML()).toBe(before);
  });

  it('leaves an empty caret to the caller', () => {
    // Inserting at the caret keeps insertContent's rules, so it is not handled
    // here and nothing changes.
    const ed = open(BAKERY);
    const before = ed.getHTML();
    ed.commands.setTextSelection(find(ed, 'sourdough').from);

    expect(replaceEditorSelection(ed, markdownToTiptap('rye'))).toBe(false);
    expect(ed.getHTML()).toBe(before);
  });
});
