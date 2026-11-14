/**
 * Footnotes in the Write view are decorated, not converted: `[^note]` reads as
 * a raised marker and `[^note]: …` as footnote text, while the document and
 * its Markdown stay exactly as written.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { FootnoteSyntaxExtension, scanFootnoteSyntax } from '../footnotes/FootnoteSyntaxExtension';

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: [StarterKit, FootnoteSyntaxExtension],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

const DOC = [
  'The pier was rebuilt in 2019.[^city] Ferries run hourly.',
  '',
  '[^city]: City records, 2019 capital budget.',
].join('\n');

describe('scanFootnoteSyntax', () => {
  it('finds the reference, the definition and its text', () => {
    const editor = makeEditor(DOC);
    const scan = scanFootnoteSyntax(editor.state.doc);
    const text = (from: number, to: number) => editor.state.doc.textBetween(from, to);

    expect(scan.ranges.map((range) => [range.kind, text(range.from, range.to)])).toEqual([
      ['reference', '[^city]'],
      ['definition-label', '[^city]:'],
    ]);
    expect(scan.definitions).toHaveLength(1);
    expect(scan.texts.get('city')).toBe('City records, 2019 capital budget.');
  });

  it('ignores footnote syntax in inline code and code blocks', () => {
    const editor = makeEditor(
      ['Write `[^note]` for a footnote.', '', '```', '[^note]: in a fence', '```'].join('\n'),
    );
    expect(scanFootnoteSyntax(editor.state.doc).ranges).toEqual([]);
  });

  it('reads only a label at the start of a paragraph as a definition', () => {
    const editor = makeEditor('See [^a]: not a definition.');
    const scan = scanFootnoteSyntax(editor.state.doc);
    expect(scan.definitions).toEqual([]);
    expect(scan.ranges.map((range) => range.kind)).toEqual(['reference']);
  });
});

describe('FootnoteSyntaxExtension', () => {
  it('raises the marker and names its footnote on hover', () => {
    const editor = makeEditor(DOC);
    const marker = editor.view.dom.querySelector<HTMLElement>('.squisq-footnote-ref');
    expect(marker?.textContent).toBe('[^city]');
    expect(marker?.getAttribute('title')).toBe('Footnote: City records, 2019 capital budget.');
  });

  it('sets the definition apart as footnote text', () => {
    const editor = makeEditor(DOC);
    const definition = editor.view.dom.querySelector('p.squisq-footnote-definition');
    expect(definition?.textContent).toBe('[^city]: City records, 2019 capital budget.');
    expect(definition?.querySelector('.squisq-footnote-label')?.textContent).toBe('[^city]:');
  });

  it('marks a reference whose footnote has no text yet', () => {
    const editor = makeEditor('Unsourced claim.[^todo]');
    const marker = editor.view.dom.querySelector<HTMLElement>('.squisq-footnote-ref');
    expect(marker?.classList.contains('squisq-footnote-ref--missing')).toBe(true);
    expect(marker?.getAttribute('title')).toBe('Footnote "todo" has no text yet');
  });

  it('follows edits', () => {
    const editor = makeEditor('Plain text.');
    expect(editor.view.dom.querySelector('.squisq-footnote-ref')).toBeNull();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '[^n]');
    expect(editor.view.dom.querySelector('.squisq-footnote-ref')?.textContent).toBe('[^n]');
  });

  it('leaves the Markdown exactly as written', () => {
    const editor = makeEditor(DOC);
    expect(tiptapToMarkdown(editor.getHTML()).trim()).toBe(DOC);
  });
});
