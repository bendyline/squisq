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

describe('bounded image upload concurrency', () => {
  it('lets later files finish first while retaining document order and at most three active uploads', async () => {
    let state = EditorState.create({ schema });
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: typeof state.tr) {
        state = state.apply(tr);
      },
    };
    const finishes = new Map<string, (path: string) => void>();
    let active = 0;
    let maximum = 0;
    const provider = {
      addMedia: vi.fn(async (name: string) => {
        active++;
        maximum = Math.max(maximum, active);
        const path = await new Promise<string>((resolve) => {
          finishes.set(name, resolve);
        });
        active--;
        return path;
      }),
    } as unknown as MediaProvider;
    const files = ['first.png', 'second.png', 'third.png', 'fourth.png'].map(
      (name) =>
        ({
          name,
          type: 'image/png',
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        }) as File,
    );
    const uploaded = vi.fn();
    const pending = uploadAndInsertImages(view, files, provider, uploaded);
    await vi.waitFor(() => expect(finishes.size).toBe(3));
    finishes.get('third.png')!('assets/third.png');
    await vi.waitFor(() => expect(finishes.size).toBe(4));
    const sources: string[] = [];
    state.doc.descendants((node) => {
      if (node.type.name === 'image') sources.push(node.attrs.src);
    });
    expect(sources[2]).toBe('assets/third.png');
    finishes.get('fourth.png')!('assets/fourth.png');
    finishes.get('second.png')!('assets/second.png');
    finishes.get('first.png')!('assets/first.png');
    await pending;
    const final: string[] = [];
    state.doc.descendants((node) => {
      if (node.type.name === 'image') final.push(node.attrs.src);
    });
    expect(final).toEqual(files.map((file) => `assets/${file.name}`));
    expect(maximum).toBe(3);
    expect(uploaded).toHaveBeenCalledTimes(4);
  });
});
