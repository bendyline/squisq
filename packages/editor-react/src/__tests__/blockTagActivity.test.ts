import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BlockTagActivityExtension,
  BLOCK_TAG_HOVERED_CLASS,
  BLOCK_TAG_SELECTED_CLASS,
} from '../blockTagActivity';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { markdownToTiptap } from '../tiptapBridge';

const MARKDOWN = `# First block {[title]}

First body.

- Outer item with **nested inline target**

# Second block {[quote]}

Second body.
`;

const editors: Editor[] = [];
const editorHosts: HTMLElement[] = [];

function makeEditor(): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editorHosts.push(element);

  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: false }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      BlockTagActivityExtension,
    ],
    content: markdownToTiptap(MARKDOWN),
  });
  editors.push(editor);
  return editor;
}

function positionInsideTopLevelNode(editor: Editor, text: string): number {
  let position: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (position === null && node.textContent === text) position = offset + 1;
  });
  if (position === null) throw new Error(`Top-level node not found: ${text}`);
  return position;
}

function headings(editor: Editor): HTMLElement[] {
  return Array.from(editor.view.dom.children).filter((element): element is HTMLElement =>
    /^H[1-6]$/.test(element.tagName),
  );
}

function elementWithExactText(editor: Editor, selector: string, text: string): HTMLElement {
  const element = Array.from(editor.view.dom.querySelectorAll<HTMLElement>(selector)).find(
    (candidate) => candidate.textContent === text,
  );
  if (!element) throw new Error(`Element not found: ${selector} containing ${text}`);
  return element;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of editorHosts.splice(0)) host.remove();
});

function waitForDomReconciliation(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('block-tag activity', () => {
  it('decorates the initial selection before the editor view settles', async () => {
    const editor = makeEditor();
    await waitForDomReconciliation();

    const [firstHeading] = headings(editor);
    expect(firstHeading.isConnected).toBe(true);
    expect(firstHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(true);
  });

  it('keeps cursor and hover decorations through DOM reconciliation', async () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(positionInsideTopLevelNode(editor, 'First body.'));
    await waitForDomReconciliation();

    const [firstHeading, secondHeading] = headings(editor);
    expect(firstHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(true);
    expect(secondHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(false);

    const secondBody = elementWithExactText(editor, 'p', 'Second body.');
    secondBody.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await waitForDomReconciliation();

    expect(firstHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(true);
    expect(firstHeading.classList.contains(BLOCK_TAG_HOVERED_CLASS)).toBe(false);
    expect(secondHeading.classList.contains(BLOCK_TAG_HOVERED_CLASS)).toBe(true);
    expect(secondHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(false);

    editor.view.dom.dispatchEvent(new MouseEvent('mouseleave'));
    await waitForDomReconciliation();
    expect(secondHeading.classList.contains(BLOCK_TAG_HOVERED_CLASS)).toBe(false);
    expect(firstHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(true);

    editor.commands.setTextSelection(positionInsideTopLevelNode(editor, 'Second body.'));
    await waitForDomReconciliation();
    expect(firstHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(false);
    expect(secondHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(true);
  });

  it('maps a nested list target to the heading that owns the list', async () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(positionInsideTopLevelNode(editor, 'Second body.'));
    await waitForDomReconciliation();

    const [firstHeading, secondHeading] = headings(editor);
    const nestedTarget = elementWithExactText(editor, 'strong', 'nested inline target');
    nestedTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await waitForDomReconciliation();

    expect(firstHeading.classList.contains(BLOCK_TAG_HOVERED_CLASS)).toBe(true);
    expect(firstHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(false);
    expect(secondHeading.classList.contains(BLOCK_TAG_SELECTED_CLASS)).toBe(true);
    expect(secondHeading.classList.contains(BLOCK_TAG_HOVERED_CLASS)).toBe(false);
  });
});
