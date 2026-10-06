import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { HeadingWithTemplate } from '../TemplateAnnotation';

let editor: Editor;
afterEach(() => editor?.destroy());

function createEditor(editable = true, content = '<p><strong>Heading text</strong></p>') {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ heading: false }), HeadingWithTemplate],
    content,
    editable,
  });
  editor.commands.setTextSelection(3);
}

function pressHeadingKey(level: number, altKey = false) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: String(level),
      code: `Digit${level}`,
      ctrlKey: true,
      altKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe('heading shortcuts', () => {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    it(`toggles Ctrl+${level} between H${level} and a paragraph`, () => {
      createEditor();
      pressHeadingKey(level);
      expect(editor.isActive('heading', { level })).toBe(true);
      expect(editor.state.doc.textContent).toBe('Heading text');
      expect(editor.getHTML()).toContain('<strong>Heading text</strong>');
      pressHeadingKey(level);
      expect(editor.isActive('paragraph')).toBe(true);
      expect(editor.getHTML()).toBe('<p><strong>Heading text</strong></p>');
    });
  }

  it('changes an existing heading level and supports undo', () => {
    createEditor(true, '<h2>Heading text</h2>');
    pressHeadingKey(5);
    expect(editor.isActive('heading', { level: 5 })).toBe(true);
    editor.commands.undo();
    expect(editor.isActive('heading', { level: 2 })).toBe(true);
  });

  it('retains the original Ctrl+Alt heading shortcuts', () => {
    createEditor();
    pressHeadingKey(3, true);
    expect(editor.isActive('heading', { level: 3 })).toBe(true);
  });

  it('does not change a read-only document', () => {
    createEditor(false);
    pressHeadingKey(1);
    expect(editor.getHTML()).toBe('<p><strong>Heading text</strong></p>');
  });
});
