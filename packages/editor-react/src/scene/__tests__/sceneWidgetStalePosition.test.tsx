/** @vitest-environment jsdom */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { markdownToTiptap } from '../../tiptapBridge';
import { SceneBlockWidget } from '../SceneBlockWidget';
import { getHeadingKey } from '../SceneBlockExtension';
import { nodeAtOrNull } from '../nodeAtOrNull';

/**
 * A scene widget outlives its heading by a tick: ProseMirror destroys the
 * widget's DOM at once but its React root later. A transaction in between
 * re-rendered the canvas against the heading's old position, and past the end
 * of a shrunken document (entering block-at-a-time, deleting a large
 * selection) `doc.nodeAt` threw `Position N outside of fragment`.
 */

const DOC = [
  '# First',
  '',
  'A first section long enough that the drawing below sits well past the end',
  'of the document once only this section remains.',
  '',
  '## Sketch {[drawing]}',
  '',
  '### Box {[rect x=10 y=10 w=20 h=20]}',
].join('\n');

// The canvas measures its host; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function drawingHeading(e: Editor): { pos: number; key: string } {
  let found: { pos: number; key: string } | null = null;
  e.state.doc.descendants((node, pos) => {
    if (found || node.type.name !== 'heading') return;
    if ((node.attrs as { dataTemplate?: string }).dataTemplate === 'drawing') {
      found = { pos, key: getHeadingKey(node, pos) };
    }
  });
  if (!found) throw new Error('fixture has no drawing heading');
  return found;
}

describe('scene widget with a stale heading position', () => {
  it('renders nothing instead of throwing when the document shrinks under it', () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ heading: false }), HeadingWithTemplate],
      content: markdownToTiptap(DOC),
    });
    const { pos, key } = drawingHeading(editor);
    const { container } = render(
      <SceneBlockWidget editor={editor} headingKey={key} fallbackParentPos={pos} mode="drawing" />,
    );
    expect(container.childElementCount).toBeGreaterThan(0);

    // What entering block-at-a-time does: the document becomes the first
    // section alone, far shorter than the drawing heading's position.
    act(() => {
      editor!.commands.setContent(markdownToTiptap('# First\n\nShort.'));
    });
    expect(editor.state.doc.content.size).toBeLessThan(pos);
    expect(container.childElementCount).toBe(0);
  });

  it('ignores a fallback position past the end of the document', () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ heading: false }), HeadingWithTemplate],
      content: markdownToTiptap('# Only\n\nShort.'),
    });
    const { container } = render(
      <SceneBlockWidget
        editor={editor}
        headingKey="sketch@999"
        fallbackParentPos={999}
        mode="drawing"
      />,
    );
    expect(container.childElementCount).toBe(0);
  });
});

describe('nodeAtOrNull', () => {
  it('returns null rather than throwing for positions outside the document', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>Hi</p>' });
    const doc = editor.state.doc;
    expect(nodeAtOrNull(doc, doc.content.size + 10)).toBeNull();
    expect(nodeAtOrNull(doc, -1)).toBeNull();
    expect(nodeAtOrNull(doc, 0)?.type.name).toBe('paragraph');
  });
});
