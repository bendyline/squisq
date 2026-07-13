import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { findSceneHeadingPos, getHeadingKey } from '../SceneBlockExtension';

const schema = new Schema({
  nodes: {
    doc: { content: 'heading+' },
    text: {},
    heading: {
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
    const firstKey = getHeadingKey(first, 0);
    const secondKey = getHeadingKey(second, secondPos);
    expect(firstKey).not.toBe(secondKey);
    expect(findSceneHeadingPos(editor, secondKey, 'layout')).toBe(secondPos);
  });
});
