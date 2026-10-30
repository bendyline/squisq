/** @vitest-environment jsdom */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';
import { tiptapToMarkdown } from '../tiptapBridge';
import { forgetMediaCopy } from '../mediaClipboard';

/** Files behind the fake `blob:` URLs the providers below resolve to. */
const servedFiles = new Map<string, Blob>();
let providerCount = 0;

interface FakeProvider extends MediaProvider {
  files: Map<string, Blob>;
  addMedia: ReturnType<typeof vi.fn<MediaProvider['addMedia']>>;
}

/** One document's media, stored as `media/<name>`. */
function fakeProvider(initial: Record<string, Blob> = {}): FakeProvider {
  const files = new Map(Object.entries(initial));
  const scope = `doc${(providerCount += 1)}`;
  return {
    files,
    async resolveUrl(path: string) {
      const file = files.get(path);
      if (!file) return path;
      const url = `blob:test/${scope}/${path}`;
      servedFiles.set(url, file);
      return url;
    },
    async listMedia(): Promise<MediaEntry[]> {
      return [...files].map(([name, data]) => ({ name, mimeType: data.type, size: data.size }));
    },
    addMedia: vi.fn<MediaProvider['addMedia']>(async (name, data, mimeType) => {
      const path = `media/${name}`;
      files.set(
        path,
        data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: mimeType }),
      );
      return path;
    }),
    async removeMedia(path: string) {
      files.delete(path);
    },
    dispose() {},
  };
}

const png = (...bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

const PHOTO = '<img src="images/photo.png" alt="Harbor at dusk" width="320">';

async function mountWriteView(markdown: string, mediaProvider: MediaProvider): Promise<Editor> {
  const live: { editor: Editor | null } = { editor: null };
  function Probe() {
    live.editor = useEditorContext().tiptapEditor;
    return null;
  }
  render(
    <EditorProvider initialMarkdown={markdown} initialView="wysiwyg" mediaProvider={mediaProvider}>
      <WysiwygEditor />
      <Probe />
    </EditorProvider>,
  );
  await waitFor(() => expect(live.editor).toBeTruthy());
  return live.editor!;
}

function mediaNodes(editor: Editor): Array<{ node: ProseMirrorNode; pos: number }> {
  const found: Array<{ node: ProseMirrorNode; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (['image', 'video', 'audio'].includes(node.type.name)) found.push({ node, pos });
  });
  return found;
}

function selectMedia(editor: Editor, index = 0): void {
  act(() => {
    editor.commands.setNodeSelection(mediaNodes(editor)[index]!.pos);
  });
}

function caretAtEnd(editor: Editor): void {
  act(() => {
    editor.commands.focus('end');
    editor.commands.splitBlock();
  });
}

/** A clipboard event whose data lives in `data`, plus optional pasted files. */
function clipboardEvent(
  type: 'copy' | 'cut' | 'paste',
  data: Map<string, string>,
  files: File[] = [],
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => data.clear(),
      setData: (format: string, value: string) => data.set(format, value),
      getData: (format: string) => data.get(format) ?? '',
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    },
  });
  return event;
}

function copy(editor: Editor, type: 'copy' | 'cut' = 'copy'): Map<string, string> {
  const data = new Map<string, string>();
  act(() => {
    editor.view.dom.dispatchEvent(clipboardEvent(type, data));
  });
  return data;
}

function paste(editor: Editor, data: Map<string, string>, files: File[] = []): void {
  act(() => {
    editor.view.dom.dispatchEvent(clipboardEvent('paste', data, files));
  });
}

// jsdom's Blob reads only through FileReader.
const polyfilled: Array<'arrayBuffer' | 'text'> = [];
beforeAll(() => {
  const read = (blob: Blob, as: 'readAsArrayBuffer' | 'readAsText') =>
    new Promise<unknown>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader[as](blob);
    });
  const methods = {
    arrayBuffer(this: Blob) {
      return read(this, 'readAsArrayBuffer');
    },
    text(this: Blob) {
      return read(this, 'readAsText');
    },
  };
  for (const name of ['arrayBuffer', 'text'] as const) {
    if (typeof Blob.prototype[name] === 'function') continue;
    Object.defineProperty(Blob.prototype, name, {
      configurable: true,
      writable: true,
      value: methods[name],
    });
    polyfilled.push(name);
  }
});
afterAll(() => {
  for (const name of polyfilled) Reflect.deleteProperty(Blob.prototype, name);
});

afterEach(() => {
  act(() => cleanup());
  forgetMediaCopy();
  servedFiles.clear();
  vi.unstubAllGlobals();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

function serveFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const file = servedFiles.get(url);
      return file
        ? { ok: true, blob: async () => file }
        : { ok: false, blob: async () => new Blob() };
    }),
  );
}

describe('copying an image, video or audio clip in the Write view', () => {
  it('copies a selected image as its reference, tagged for a paste to recognize', async () => {
    serveFetch();
    const editor = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': png(1, 2) }));
    selectMedia(editor);

    const data = copy(editor);

    const html = data.get('text/html') ?? '';
    expect(html).toContain('src="images/photo.png"');
    expect(html).toMatch(/data-squisq-media-copy="[^"]+"/);
  });

  it('pastes the same reference back into its own document, storing nothing', async () => {
    serveFetch();
    const provider = fakeProvider({ 'images/photo.png': png(1, 2) });
    const editor = await mountWriteView(`${PHOTO}\n\nAfter the photo.`, provider);
    selectMedia(editor);
    const data = copy(editor);

    caretAtEnd(editor);
    // The asynchronous copy also puts a PNG on the clipboard; it must not be stored again.
    paste(editor, data, [new File([png(1, 2)], 'image.png', { type: 'image/png' })]);

    const images = mediaNodes(editor);
    expect(images.map(({ node }) => node.attrs.src)).toEqual([
      'images/photo.png',
      'images/photo.png',
    ]);
    expect(images[1]!.node.attrs.width).toBe(320);
    expect(provider.addMedia).not.toHaveBeenCalled();
  });

  it('cuts the image, and a paste puts the same reference back', async () => {
    serveFetch();
    const provider = fakeProvider({ 'images/photo.png': png(1, 2) });
    const editor = await mountWriteView(`Before.\n\n${PHOTO}`, provider);
    selectMedia(editor);

    const data = copy(editor, 'cut');
    expect(mediaNodes(editor)).toHaveLength(0);

    caretAtEnd(editor);
    paste(editor, data);
    expect(mediaNodes(editor).map(({ node }) => node.attrs.src)).toEqual(['images/photo.png']);
    expect(provider.addMedia).not.toHaveBeenCalled();
  });

  it("stores the original file in another document's media and references the copy", async () => {
    serveFetch();
    const source = fakeProvider({ 'images/photo.png': png(1, 2, 3) });
    const target = fakeProvider();
    const from = await mountWriteView(PHOTO, source);
    const to = await mountWriteView('Another document.', target);
    selectMedia(from);
    const data = copy(from);

    caretAtEnd(to);
    paste(to, data);

    await waitFor(() => expect(mediaNodes(to)[0]?.node.attrs.src).toBe('media/photo.png'));
    const [name, stored, mimeType] = target.addMedia.mock.calls[0]!;
    expect(name).toBe('photo.png');
    expect(mimeType).toBe('image/png');
    expect([...new Uint8Array(await (stored as Blob).arrayBuffer())]).toEqual([1, 2, 3]);
    const pasted = mediaNodes(to)[0]!.node;
    expect(pasted.attrs.alt).toBe('Harbor at dusk');
    expect(pasted.attrs.width).toBe(320);
    expect(pasted.attrs.title).toBeNull();
  });

  it('undoes a paste into another document in one step', async () => {
    serveFetch();
    const from = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': png(1) }));
    const target = fakeProvider();
    // Slower than the history's grouping window, as a large file or a host
    // bridge is, so the stored path lands as a change of its own.
    const store = target.addMedia.getMockImplementation()!;
    target.addMedia.mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return store(...args);
    });
    const to = await mountWriteView('Another document.', target);
    selectMedia(from);
    const data = copy(from);
    caretAtEnd(to);
    paste(to, data);
    await waitFor(() => expect(mediaNodes(to)[0]?.node.attrs.src).toBe('media/photo.png'), {
      timeout: 2_000,
    });

    // Undo scrolls the selection into view, measuring a Range jsdom cannot.
    Object.assign(Range.prototype, {
      getClientRects: () => [],
      getBoundingClientRect: () => new DOMRect(),
    });
    act(() => {
      to.commands.undo();
    });
    Reflect.deleteProperty(Range.prototype, 'getClientRects');
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');

    expect(mediaNodes(to)).toHaveLength(0);
  });

  it('keeps the reference when the other document already holds the same file there', async () => {
    serveFetch();
    const from = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': png(7, 7) }));
    const target = fakeProvider({ 'images/photo.png': png(7, 7) });
    const to = await mountWriteView('Same folder, same picture.', target);
    selectMedia(from);
    const data = copy(from);

    caretAtEnd(to);
    paste(to, data);

    await waitFor(() => expect(mediaNodes(to)[0]?.node.attrs.title).toBeNull());
    expect(mediaNodes(to)[0]!.node.attrs.src).toBe('images/photo.png');
    expect(target.addMedia).not.toHaveBeenCalled();
  });

  it('stores a copy even when the other document can read the original from where it is', async () => {
    // A host may resolve references a document does not store, as DocBlocks
    // reads `a_files/pic.png` beside `b.md`. Reusing that path would break the
    // paste once the original's document is renamed, moved or deleted.
    serveFetch();
    const original = png(4, 5, 6);
    const from = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': original }));
    const target = fakeProvider();
    const ownResolve = target.resolveUrl;
    target.resolveUrl = async (path) => {
      if (path !== 'images/photo.png') return ownResolve(path);
      servedFiles.set('blob:test/elsewhere/images/photo.png', original);
      return 'blob:test/elsewhere/images/photo.png';
    };
    const to = await mountWriteView('Beside the original.', target);
    selectMedia(from);
    const data = copy(from);

    caretAtEnd(to);
    paste(to, data);

    await waitFor(() => expect(mediaNodes(to)[0]?.node.attrs.src).toBe('media/photo.png'));
    expect(target.addMedia).toHaveBeenCalledTimes(1);
    expect([...new Uint8Array(await target.files.get('media/photo.png')!.arrayBuffer())]).toEqual([
      4, 5, 6,
    ]);
  });

  it('reuses the copy an earlier paste stored instead of storing the file again', async () => {
    serveFetch();
    const from = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': png(3, 1, 4) }));
    const target = fakeProvider();
    const to = await mountWriteView('Pasted twice.', target);
    selectMedia(from);
    const data = copy(from);

    caretAtEnd(to);
    paste(to, data);
    await waitFor(() => expect(mediaNodes(to)[0]?.node.attrs.src).toBe('media/photo.png'));
    // Ending on the image would select it, and a paste then replaces it.
    act(() => {
      to.commands.insertContentAt(to.state.doc.content.size, '<p>And again:</p>');
    });
    caretAtEnd(to);
    paste(to, data);

    await waitFor(() => expect(mediaNodes(to)).toHaveLength(2));
    await waitFor(() =>
      expect(mediaNodes(to).map(({ node }) => node.attrs.src)).toEqual([
        'media/photo.png',
        'media/photo.png',
      ]),
    );
    expect(target.addMedia).toHaveBeenCalledTimes(1);
  });

  it('never overwrites a different file of the same name in the other document', async () => {
    serveFetch();
    const from = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': png(1) }));
    const target = fakeProvider({ 'media/photo.png': png(9) });
    const to = await mountWriteView('Has its own photo.png.', target);
    selectMedia(from);
    const data = copy(from);

    caretAtEnd(to);
    paste(to, data);

    await waitFor(() => expect(mediaNodes(to)[0]?.node.attrs.src).toBe('media/photo-2.png'));
    expect([...new Uint8Array(await target.files.get('media/photo.png')!.arrayBuffer())]).toEqual([
      9,
    ]);
  });

  it("falls back to the clipboard's PNG when the original cannot be read", async () => {
    // No fetch stub: the copy cannot read its file.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('refused'))),
    );
    const from = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': png(1) }));
    const target = fakeProvider();
    const to = await mountWriteView('Another document.', target);
    selectMedia(from);
    const data = copy(from);

    caretAtEnd(to);
    paste(to, data, [new File([png(4, 4)], 'image.png', { type: 'image/png' })]);

    await waitFor(() => expect(mediaNodes(to)[0]?.node.attrs.src).toBe('media/photo.png'));
    const stored = target.addMedia.mock.calls[0]![1] as Blob;
    expect([...new Uint8Array(await stored.arrayBuffer())]).toEqual([4, 4]);
  });

  it('carries a video into another document as a stored file', async () => {
    serveFetch();
    const clip = new Blob([new Uint8Array([5, 6])], { type: 'video/mp4' });
    const from = await mountWriteView(
      'Intro.\n\n<video src="media/demo.mp4" controls width="480"></video>',
      fakeProvider({ 'media/demo.mp4': clip }),
    );
    const target = fakeProvider();
    const to = await mountWriteView('Another document.', target);
    selectMedia(from);
    const data = copy(from);

    caretAtEnd(to);
    paste(to, data);

    await waitFor(() => expect(mediaNodes(to)).toHaveLength(1));
    expect(mediaNodes(to)[0]!.node.type.name).toBe('video');
    expect(mediaNodes(to)[0]!.node.attrs.src).toBe('media/demo.mp4');
    expect(target.addMedia).toHaveBeenCalledWith('demo.mp4', clip, 'video/mp4');
    expect(tiptapToMarkdown(to.getHTML())).toContain('<video src="media/demo.mp4"');
  });

  it('writes the picture itself for other applications: a PNG and an <img> of its data', async () => {
    serveFetch();
    const written: Array<Record<string, Promise<Blob>>> = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Promise<Blob>>) {
          written.push(items);
        }
      },
    );
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    const editor = await mountWriteView(PHOTO, fakeProvider({ 'images/photo.png': png(1, 2) }));
    selectMedia(editor);

    const data = copy(editor);

    expect(write).toHaveBeenCalledTimes(1);
    const items = written[0]!;
    expect([...new Uint8Array(await (await items['image/png']!).arrayBuffer())]).toEqual([1, 2]);
    const html = await (await items['text/html']!).text();
    expect(html).toMatch(/^<img src="data:image\/png;base64,AQI="/);
    expect(html).toContain('alt="Harbor at dusk"');
    // Same copy id as the event's HTML, so a paste of either is recognized.
    const id = /data-squisq-media-copy="([^"]+)"/.exec(data.get('text/html') ?? '')?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`data-squisq-media-copy="${id}"`);
  });

  it('pastes a clipboard image from elsewhere as an upload, as before', async () => {
    serveFetch();
    const provider = fakeProvider();
    const editor = await mountWriteView('Notes.', provider);
    caretAtEnd(editor);

    paste(editor, new Map([['text/html', '<img src="https://example.com/a.png">']]), [
      new File([png(3)], 'image.png', { type: 'image/png' }),
    ]);

    await waitFor(() => expect(provider.addMedia).toHaveBeenCalledTimes(1));
  });

  it('forgets a copied clip once text is copied instead', async () => {
    serveFetch();
    const from = await mountWriteView(
      `${PHOTO}\n\nWords to copy.`,
      fakeProvider({ 'images/photo.png': png(1) }),
    );
    const target = fakeProvider();
    const to = await mountWriteView('Another document.', target);
    selectMedia(from);
    const imageCopy = copy(from);
    act(() => {
      const end = from.state.doc.content.size - 1;
      from.commands.setTextSelection({ from: end - 5, to: end });
    });
    copy(from);

    caretAtEnd(to);
    paste(to, imageCopy);

    // No longer the remembered copy: ordinary HTML, so nothing is stored.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.addMedia).not.toHaveBeenCalled();
  });
});
