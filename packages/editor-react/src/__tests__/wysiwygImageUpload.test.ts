import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import {
  isPlayableMediaFile,
  uploadAndInsertImages,
  uploadAndInsertMediaPlayers,
} from '../wysiwygImageUpload';

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

const blockSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: {},
    video: {
      group: 'block',
      atom: true,
      attrs: { src: {}, controls: { default: true }, width: { default: null } },
    },
    audio: { group: 'block', atom: true, attrs: { src: {}, controls: { default: true } } },
  },
});

function blockView(paragraphs: string[], caret: number) {
  const doc = blockSchema.node(
    'doc',
    null,
    paragraphs.map((text) =>
      blockSchema.node('paragraph', null, text ? blockSchema.text(text) : []),
    ),
  );
  let state = EditorState.create({
    schema: blockSchema,
    doc,
    selection: TextSelection.create(doc, caret),
  });
  return {
    get state() {
      return state;
    },
    dispatch(tr: typeof state.tr) {
      state = state.apply(tr);
    },
  };
}

function mediaFile(name: string, type: string, bytes = 1): File {
  return { name, type, arrayBuffer: async () => new Uint8Array(bytes).buffer } as File;
}

const storingProvider = {
  addMedia: vi.fn(async (name: string) => `attachments/${name}`),
} as unknown as MediaProvider;

describe('dropped video and audio players', () => {
  it('recognizes video and audio by MIME type or, when untyped, by extension', () => {
    expect(isPlayableMediaFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true);
    expect(isPlayableMediaFile({ name: 'take.mp3', type: '' })).toBe(true);
    expect(isPlayableMediaFile({ name: 'voice.m4a', type: 'application/octet-stream' })).toBe(true);
    expect(isPlayableMediaFile({ name: 'photo.png', type: 'image/png' })).toBe(false);
    expect(isPlayableMediaFile({ name: 'brief.pdf', type: 'application/pdf' })).toBe(false);
  });

  it('inserts players in drop order after the caret’s block', async () => {
    const view = blockView(['first', 'second'], 3);
    const uploaded = vi.fn();
    await uploadAndInsertMediaPlayers(
      view,
      [mediaFile('clip.mp4', 'video/mp4'), mediaFile('take.mp3', '')],
      storingProvider,
      uploaded,
    );

    const children = view.state.doc.children.map((node) =>
      node.isTextblock ? node.textContent : `${node.type.name}:${node.attrs.src}`,
    );
    expect(children).toEqual([
      'first',
      'video:attachments/clip.mp4',
      'audio:attachments/take.mp3',
      'second',
    ]);
    expect(view.state.doc.child(1).attrs.width).toBe(480);
    expect(uploaded).toHaveBeenCalledOnce();
  });

  it('replaces the empty paragraph the caret sits in', async () => {
    const view = blockView([''], 1);
    await uploadAndInsertMediaPlayers(view, [mediaFile('clip.mp4', 'video/mp4')], storingProvider);

    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.firstChild?.type.name).toBe('video');
  });

  it('leaves the document alone when no file could be stored', async () => {
    const view = blockView(['first'], 3);
    const uploaded = vi.fn();
    await uploadAndInsertMediaPlayers(
      view,
      [mediaFile('empty.mp4', 'video/mp4', 0)],
      storingProvider,
      uploaded,
    );

    expect(view.state.doc.childCount).toBe(1);
    expect(uploaded).not.toHaveBeenCalled();
  });
});
