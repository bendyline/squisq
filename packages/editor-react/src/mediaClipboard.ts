/**
 * MediaClipboard — copy, cut and paste of one image, video or audio clip in
 * the Write view.
 *
 * Copying a selected clip remembers it: its node, and the bytes of the file
 * it names when that file is stored with the document. The clipboard HTML
 * carries the copy's id. A paste that finds the id:
 *
 *  - in the document it was copied from inserts the same reference, so the
 *    file is not stored twice;
 *  - in another document stores the remembered bytes in that document's
 *    media and references the new file, because the original path means
 *    nothing there — unless that path already holds the same file.
 *
 * Other applications get the picture itself: an image copy also writes a PNG
 * and an `<img>` whose source is the image's data, which they paste as an
 * image. The clipboard has no format for video or audio, so those carry their
 * file only between Squisq editors in this page.
 *
 * The memory is one copy deep and lives in this module, so it spans every
 * editor in the page but not other windows. A paste from another window finds
 * no match, and the Write view stores the clipboard's PNG instead.
 */

import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { mediaMimeType } from './mediaDragMime';
import { normalizeMalformedAssetUrl } from './utils/normalizeMalformedAssetUrl';
import {
  insertImageWhileStoring,
  insertTopLevelNodes,
  uniquePasteToken,
} from './wysiwygImageUpload';

export type ClipboardMediaKind = 'image' | 'video' | 'audio';

const MEDIA_NODE_TYPES: ReadonlySet<string> = new Set<ClipboardMediaKind>([
  'image',
  'video',
  'audio',
]);

/** Ties clipboard HTML to the copy this module remembers. */
const MEDIA_COPY_ATTRIBUTE = 'data-squisq-media-copy';

/** Image types other applications can show from an `<img>` data URL. */
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const CLIPBOARD_UNAVAILABLE = 'Clipboard access is unavailable.';

interface StoredFile {
  data: Blob;
  name: string;
  mimeType: string;
}

interface MediaCopy {
  id: string;
  /** The copying editor's media provider, which identifies its document. */
  provider: MediaProvider | null;
  /** The node as JSON, so an editor with another schema instance can rebuild it. */
  node: unknown;
  /** The file's bytes, read at copy time while its document can still serve them. */
  file: Promise<StoredFile | null>;
}

let lastCopy: MediaCopy | null = null;

export function isClipboardMediaNode(node: ProseMirrorNode): boolean {
  return MEDIA_NODE_TYPES.has(node.type.name);
}

/** The selected image, video or audio node, when the selection is exactly one. */
export function selectedMediaNode(
  state: EditorState,
): { node: ProseMirrorNode; pos: number } | null {
  const { selection } = state;
  return selection instanceof NodeSelection && isClipboardMediaNode(selection.node)
    ? { node: selection.node, pos: selection.from }
    : null;
}

/** Position of the image, video or audio node whose rendering contains `target`. */
export function mediaNodePosAt(view: EditorView, target: Node): number | null {
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (isClipboardMediaNode(node) && view.nodeDOM(pos)?.contains(target)) found = pos;
    return undefined;
  });
  return found;
}

/** The stored-media path `src` names, or null for a URL, which works anywhere. */
function storedMediaPath(src: unknown): string | null {
  if (typeof src !== 'string' || !src) return null;
  return normalizeMalformedAssetUrl(src) ?? (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(src) ? null : src);
}

async function readStoredFile(provider: MediaProvider, path: string): Promise<StoredFile | null> {
  try {
    const url = await provider.resolveUrl(path);
    if (!url || url === path) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.blob();
    if (data.size === 0) return null;
    const name = path.split('/').pop() || 'media';
    return { data, name, mimeType: mediaMimeType({ name, type: data.type }) };
  } catch {
    // Unreadable (a refused fetch, a provider since disposed): the copy
    // still pastes as a reference.
    return null;
  }
}

/**
 * Put the media node at `pos` on the clipboard and remember it.
 *
 * With a copy event's `clipboardData`, the HTML is written there at once. An
 * image's PNG follows through the asynchronous clipboard, whose write replaces
 * the event's data when it lands; until then, and if it fails, the event's
 * HTML stands. Without `clipboardData`, the asynchronous write carries it all.
 *
 * Everything that must happen during the user's gesture happens before this
 * returns: Safari refuses a clipboard write started later.
 */
export function copyMediaNode(
  view: EditorView,
  pos: number,
  provider: MediaProvider | null,
  clipboardData: DataTransfer | null,
): Promise<void> {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isClipboardMediaNode(node)) return Promise.resolve();

  const id = uniquePasteToken();
  const path = storedMediaPath(node.attrs.src);
  const file = path && provider ? readStoredFile(provider, path) : Promise.resolve(null);
  lastCopy = { id, provider, node: node.toJSON(), file };

  const { dom, text } = view.serializeForClipboard(new Slice(Fragment.from(node), 0, 0));
  dom.firstElementChild?.setAttribute(MEDIA_COPY_ATTRIBUTE, id);
  const html = dom.innerHTML;
  if (clipboardData) {
    clipboardData.clearData();
    clipboardData.setData('text/html', html);
    clipboardData.setData('text/plain', text);
  }

  const picture =
    node.type.name === 'image' ? writePicture(node, id, view.nodeDOM(pos), file) : null;
  if (clipboardData) {
    void picture?.catch(() => undefined);
    return Promise.resolve();
  }
  return (picture ?? Promise.reject(new Error(CLIPBOARD_UNAVAILABLE))).catch(() => writeHtml(html));
}

/** Forget the remembered copy (the clipboard now holds something else). */
export function forgetMediaCopy(): void {
  lastCopy = null;
}

function asyncClipboardWritable(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

async function writeHtml(html: string): Promise<void> {
  if (!asyncClipboardWritable()) throw new Error(CLIPBOARD_UNAVAILABLE);
  await navigator.clipboard.write([
    new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) }),
  ]);
}

/** Write an image as a PNG plus an `<img>` of its data, for other applications. */
function writePicture(
  image: ProseMirrorNode,
  id: string,
  dom: Node | null,
  file: Promise<StoredFile | null>,
): Promise<void> {
  if (!asyncClipboardWritable()) return Promise.reject(new Error(CLIPBOARD_UNAVAILABLE));
  // Draw now: a cut removes the node view before the file read settles.
  const canvas = drawnImage(dom);
  const picture = file.then((stored) => pictureOf(stored, canvas));
  const png = picture.then((result) => result.png);
  const html = picture.then(
    async (result) =>
      new Blob([pictureHtml(image, id, await dataUrl(result.inline))], { type: 'text/html' }),
  );
  void png.catch(() => undefined);
  void html.catch(() => undefined);
  return navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'image/png': png })]);
}

/** The image as the editor shows it, drawn on a canvas, or null before it loads. */
function drawnImage(dom: Node | null): HTMLCanvasElement | null {
  const img = dom instanceof Element ? dom.querySelector('img') : null;
  if (!img?.complete || !img.naturalWidth || !img.naturalHeight) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(img, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

async function pictureOf(
  stored: StoredFile | null,
  canvas: HTMLCanvasElement | null,
): Promise<{ png: Blob; inline: Blob }> {
  const png =
    stored?.mimeType === 'image/png'
      ? stored.data
      : ((await canvasPng(canvas)) ?? (await decodedPng(stored)));
  if (!png) throw new Error('The image could not be copied as a picture.');
  const inline =
    stored && INLINE_IMAGE_TYPES.has(stored.mimeType)
      ? new Blob([stored.data], { type: stored.mimeType })
      : png;
  return { png, inline };
}

async function canvasPng(canvas: HTMLCanvasElement | null): Promise<Blob | null> {
  if (!canvas) return null;
  try {
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    // A cross-origin image taints the canvas.
    return null;
  }
}

async function decodedPng(stored: StoredFile | null): Promise<Blob | null> {
  if (!stored || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(stored.data);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await canvasPng(canvas);
  } catch {
    return null;
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function pictureHtml(image: ProseMirrorNode, id: string, src: string): string {
  const img = document.createElement('img');
  img.setAttribute('src', src);
  for (const name of ['alt', 'width', 'height'] as const) {
    const value: unknown = image.attrs[name];
    if (value != null && value !== '') img.setAttribute(name, String(value));
  }
  img.setAttribute(MEDIA_COPY_ATTRIBUTE, id);
  return img.outerHTML;
}

/**
 * Paste the remembered copy when the clipboard carries it; see the module
 * comment. False for any other clipboard content, which the caller pastes as
 * usual.
 */
export function pasteCopiedMedia(
  view: EditorView,
  clipboard: DataTransfer,
  provider: MediaProvider | null,
  onMediaUploaded?: () => void,
): boolean {
  const copy = lastCopy;
  if (!copy || !clipboard.getData('text/html').includes(`${MEDIA_COPY_ATTRIBUTE}="${copy.id}"`)) {
    return false;
  }
  let node: ProseMirrorNode;
  try {
    node = view.state.schema.nodeFromJSON(copy.node);
  } catch {
    return false;
  }
  const path = storedMediaPath(node.attrs.src);
  if (!path || !provider || provider === copy.provider) {
    insertPastedMedia(view, node);
    return true;
  }

  // Read now: a clipboard file is only readable during the paste event.
  const clipboardImage =
    Array.from(clipboard.items ?? [])
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile() ?? null;
  const store = () => storeCopy(provider, path, copy.file, clipboardImage);
  if (node.type.name === 'image') {
    void insertImageWhileStoring(view, node, store, onMediaUploaded);
  } else {
    void store().then(
      (stored) => {
        insertPastedMedia(view, stored ? node.type.create({ ...node.attrs, src: stored }) : node);
        if (stored) onMediaUploaded?.();
      },
      (err: unknown) => console.error('Failed to store pasted media:', err),
    );
  }
  return true;
}

/**
 * Store a copied file in another document's media and return its path there:
 * a file that document already stores with the same bytes (`path` itself
 * first), else a new file under a name no existing file uses. Null when the
 * copy's bytes could not be read.
 */
async function storeCopy(
  provider: MediaProvider,
  path: string,
  file: Promise<StoredFile | null>,
  clipboardImage: File | null,
): Promise<string | null> {
  const copied =
    (await file) ??
    (clipboardImage
      ? {
          data: clipboardImage,
          name: `${
            path
              .split('/')
              .pop()
              ?.replace(/\.[^.]+$/, '') || 'image'
          }.png`,
          mimeType: clipboardImage.type || 'image/png',
        }
      : null);
  if (!copied) return null;
  const stored = await storedCopyOf(provider, path, copied.data);
  if (stored) return stored;
  return provider.addMedia(await unusedName(provider, copied.name), copied.data, copied.mimeType);
}

/**
 * A file `provider` itself stores with exactly `data`'s bytes, preferring
 * `path`. Only listed media counts: a host may also resolve references a
 * document does not store (DocBlocks reads `a_files/pic.png` beside `b.md`),
 * and a paste pointing at one of those breaks once the other document is
 * renamed, moved or deleted.
 */
async function storedCopyOf(
  provider: MediaProvider,
  path: string,
  data: Blob,
): Promise<string | null> {
  let entries: MediaEntry[];
  try {
    entries = await provider.listMedia();
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry.size === data.size)
    .sort((a, b) => Number(b.name === path) - Number(a.name === path));
  for (const { name } of candidates) {
    const existing = await readStoredFile(provider, name);
    if (existing && (await sameBytes(existing.data, data))) return name;
  }
  return null;
}

async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  for (let index = 0; index < x.length; index += 1) if (x[index] !== y[index]) return false;
  return true;
}

/** `name`, or `name-2`, `name-3`… — whichever no stored file already uses. */
async function unusedName(provider: MediaProvider, name: string): Promise<string> {
  let taken: Set<string>;
  try {
    taken = new Set((await provider.listMedia()).map((entry) => entry.name.split('/').pop() ?? ''));
  } catch {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let suffix = 2; taken.has(candidate); suffix += 1)
    candidate = `${stem}-${suffix}${extension}`;
  return candidate;
}

/**
 * Insert a pasted clip as a paste would: in place of the selection. A player
 * lands at the top level instead — inside a list item its serializer would
 * drop it — unless it replaces a selected top-level node.
 */
function insertPastedMedia(view: EditorView, node: ProseMirrorNode): void {
  const { selection } = view.state;
  if (
    node.type.name !== 'image' &&
    !(selection instanceof NodeSelection && selection.$from.depth === 0)
  ) {
    insertTopLevelNodes(view, [node]);
    return;
  }
  view.dispatch(
    view.state.tr
      .replaceSelectionWith(node, false)
      .scrollIntoView()
      .setMeta('paste', true)
      .setMeta('uiEvent', 'paste'),
  );
}

/**
 * Copy or cut the media node at `pos` for a menu command. A real copy event
 * runs the editor's own handler, exactly as ⌘C would; where the browser will
 * not raise one, the asynchronous clipboard carries the copy.
 */
export async function copyMediaCommand(
  view: EditorView,
  pos: number,
  provider: MediaProvider | null,
  cut: boolean,
): Promise<void> {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.focus();
  const before = lastCopy;
  document.execCommand?.(cut ? 'cut' : 'copy');
  if (lastCopy !== before) return;
  await copyMediaNode(view, pos, provider, null);
  if (cut) {
    view.dispatch(
      view.state.tr
        .setSelection(NodeSelection.create(view.state.doc, pos))
        .deleteSelection()
        .scrollIntoView()
        .setMeta('uiEvent', 'cut'),
    );
  }
}

export interface MediaClipboardOptions {
  /** The editor's current media provider, read at copy time. */
  mediaProvider: () => MediaProvider | null;
}

/**
 * Handles ⌘C / ⌘X on a selected image, video or audio clip. Pasting is the
 * Write view's `handlePaste`, which consults `pasteCopiedMedia` before its
 * other rules.
 */
export const MediaClipboard = Extension.create<MediaClipboardOptions>({
  name: 'mediaClipboard',

  addOptions() {
    return { mediaProvider: () => null };
  },

  addProseMirrorPlugins() {
    const { mediaProvider } = this.options;
    const onCopy = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
      const media = selectedMediaNode(view.state);
      if (!media) {
        forgetMediaCopy();
        return false;
      }
      if (!event.clipboardData || (cut && !view.editable)) return false;
      event.preventDefault();
      void copyMediaNode(view, media.pos, mediaProvider(), event.clipboardData);
      if (cut) {
        view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
      }
      return true;
    };
    return [
      new Plugin({
        key: new PluginKey('mediaClipboard'),
        props: {
          handleDOMEvents: {
            copy: (view, event) => onCopy(view, event, false),
            cut: (view, event) => onCopy(view, event, true),
          },
        },
      }),
    ];
  },
});
