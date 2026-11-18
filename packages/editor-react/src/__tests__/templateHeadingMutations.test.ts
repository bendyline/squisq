/**
 * @vitest-environment jsdom
 *
 * A change to a heading's template badge is not an edit. ProseMirror used to
 * read a `style` written onto the badge (by a browser extension, or by
 * Playwright hiding the caret for a screenshot) as a DOM change, redraw the
 * heading's range and remount the widgets in it, which flashed empty and
 * shifted the page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = '';
});

function mount(markdown: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    ],
    content: markdownToTiptap(markdown),
  });
  return editor;
}

/** Let ProseMirror's MutationObserver deliver and handle what it saw. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('template heading badges', () => {
  it('ignore attribute changes instead of redrawing the section', async () => {
    const e = mount('## Plan {[list]}\n\nFirst point.\n\n## Next\n\nMore.');
    const heading = e.view.dom.querySelector('h2')!;
    const paragraph = e.view.dom.querySelector('p')!;
    const badge = heading.querySelector('.squisq-template-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    const before = e.state.doc;

    badge.style.setProperty('caret-color', 'transparent', 'important');
    badge.setAttribute('data-gramm', 'false');
    (heading.querySelector('.squisq-props-badge') as HTMLElement).style.color = 'red';
    heading.setAttribute('data-extension', 'on');
    await settle();

    expect(e.view.dom.querySelector('h2')).toBe(heading);
    expect(e.view.dom.querySelector('p')).toBe(paragraph);
    expect(e.state.doc.eq(before)).toBe(true);
  });

  it('still reads text typed into the heading', async () => {
    const e = mount('## Plan {[list]}\n\nFirst point.');
    const text = e.view.dom.querySelector('h2 .squisq-heading-content')!.firstChild as Text;
    text.data = 'Plans';
    await settle();
    expect(e.state.doc.firstChild?.textContent).toBe('Plans');
    expect(tiptapToMarkdown(e.getHTML())).toContain('## Plans {[list]}');
  });

  it('renders as it did before, badge and all', () => {
    const e = mount('### Room {[drawing]}\n\nText.');
    const heading = e.view.dom.querySelector('h3')!;
    expect(heading.getAttribute('data-template')).toBe('drawing');
    expect(heading.querySelector('.squisq-heading-content')?.textContent).toBe('Room');
    expect(heading.querySelector('.squisq-template-badge')?.getAttribute('contenteditable')).toBe(
      'false',
    );
  });
});
