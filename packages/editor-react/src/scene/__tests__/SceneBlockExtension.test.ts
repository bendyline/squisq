import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { findSceneHeadingPos, getHeadingKey, sceneHeadingKeys } from '../SceneBlockExtension';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: {},
    paragraph: { group: 'block', content: 'text*' },
    heading: {
      group: 'block',
      content: 'text*',
      attrs: {
        level: { default: 1 },
        dataTemplate: { default: 'layout' },
        dataBlockAttrs: { default: null },
      },
    },
  },
});

describe('SceneBlockExtension heading identity', () => {
  it('targets the correct canvas when headings have duplicate text or ids', () => {
    const first = schema.node('heading', { dataBlockAttrs: '#same' }, schema.text('Layout'));
    const second = schema.node('heading', { dataBlockAttrs: '#same' }, schema.text('Layout'));
    const secondPos = first.nodeSize;
    const doc = schema.node('doc', null, [first, second]);
    const editor = { state: { doc } } as unknown as Editor;
    const firstKey = getHeadingKey(doc, 0, 'layout');
    const secondKey = getHeadingKey(doc, secondPos, 'layout');
    expect(firstKey).toBe('same');
    expect(secondKey).toBe('same~2');
    expect(findSceneHeadingPos(editor, secondKey ?? '', 'layout')).toBe(secondPos);
  });

  it('keeps a heading’s key when text above it moves it', () => {
    const heading = (text: string) => schema.node('heading', null, schema.text(text));
    const before = schema.node('doc', null, [heading('Plan'), heading('Plan')]);
    const after = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('A new opening line.')),
      heading('Plan'),
      heading('Plan'),
    ]);
    expect([...sceneHeadingKeys(after, 'layout').values()]).toEqual([
      ...sceneHeadingKeys(before, 'layout').values(),
    ]);
    // Only same-template headings count toward the ordinal.
    expect(getHeadingKey(after, 0, 'drawing')).toBeNull();
  });
});
