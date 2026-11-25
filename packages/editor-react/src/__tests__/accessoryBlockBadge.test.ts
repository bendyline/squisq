/**
 * A summary heading (`### Headline {[summary …]}`) is an accessory block:
 * side information about its section. In Write its chip names it and changes
 * nothing, and its tag — every parameter — survives the round trip, as do a
 * section's summary settings on its own heading.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { templateLabel } from '../TemplatePicker';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

const MARKDOWN = [
  '## Results {[slideLayout=cards supportingSlides=false]}',
  '',
  'Revenue grew 40% last year.',
  '',
  '### Revenue grew {[summary passage=abc-1 origin=ai layout=hub center="Two words"]}',
  '',
  '- Most of it from new customers',
  '',
  '### Older results {[summary passage=def-2 hidden=true]}',
].join('\n');

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) {
    const host = editor.options.element;
    editor.destroy();
    host?.remove();
  }
});

function makeEditor(markdown: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

describe('summary headings in Write', () => {
  it('round-trip every parameter, and the section’s settings', () => {
    const editor = makeEditor(MARKDOWN);
    expect(tiptapToMarkdown(editor.getHTML()).trim()).toBe(MARKDOWN);
  });

  it('show a chip that names them and opens nothing', () => {
    const editor = makeEditor(MARKDOWN);
    const heading = editor.view.dom.querySelector('h3[data-accessory-block="summary"]');
    expect(heading).not.toBeNull();
    const badge = heading!.querySelector('.squisq-template-badge')!;
    expect(badge.classList.contains('squisq-template-badge--accessory')).toBe(true);
    expect(badge.getAttribute('role')).toBeNull();
    expect(badge.getAttribute('tabindex')).toBeNull();
    expect(badge.getAttribute('aria-haspopup')).toBeNull();
    expect(
      badge.querySelector('.squisq-template-badge-core')!.getAttribute('data-template-label'),
    ).toBe('Slide summary');
    expect(heading!.querySelector('.squisq-props-badge')).toBeNull();
  });

  it('are named by the accessory registry, not as a template', () => {
    expect(templateLabel('summary')).toBe('Slide summary');
  });
});
