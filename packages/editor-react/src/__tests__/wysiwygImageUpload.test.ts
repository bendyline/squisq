import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { uploadAndInsertImages } from '../wysiwygImageUpload';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    image: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
      },
    },
  },
});

describe('asynchronous WYSIWYG image upload', () => {
  it('replaces a mapped placeholder instead of the user’s later selection', async () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('before after')),
    ]);
    let state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 8),
    });
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: typeof state.tr) {
        state = state.apply(tr);
      },
    };
    let finishUpload!: (path: string) => void;
    const upload = new Promise<string>((resolve) => {
      finishUpload = resolve;
    });
    const provider = {
      addMedia: vi.fn(() => upload),
    } as unknown as MediaProvider;
    const file = {
      name: 'photo.png',
      type: 'image/png',
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    } as File;

    const pending = uploadAndInsertImages(view, [file], provider);
    // Keep editing elsewhere while storage is pending.
    view.dispatch(state.tr.insertText(' tail', state.doc.content.size - 1));
    finishUpload('assets/photo.png');
    await pending;

    const paragraph = state.doc.firstChild!;
    expect(paragraph.childCount).toBe(3);
    expect(paragraph.child(0).text).toBe('before ');
    expect(paragraph.child(1).type.name).toBe('image');
    expect(paragraph.child(1).attrs.src).toBe('assets/photo.png');
    expect(paragraph.child(2).text).toBe('after tail');
  });
});
