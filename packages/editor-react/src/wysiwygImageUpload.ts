import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView as ProseMirrorView } from '@tiptap/pm/view';

type ImageMutationView = Pick<ProseMirrorView, 'state' | 'dispatch'>;

/**
 * Upload images while stable placeholder nodes retain the original event
 * position as the surrounding ProseMirror document continues to change.
 */
export async function uploadAndInsertImages(
  view: ImageMutationView,
  files: File[],
  mediaProvider: MediaProvider,
  onMediaUploaded?: () => void,
): Promise<void> {
  const placeholders = files.map(() => `squisq-upload:${uniquePasteToken()}`);
  const imageType = view.state.schema.nodes.image;
  if (!imageType) return;

  let placeholderTr = view.state.tr;
  for (const token of placeholders) {
    placeholderTr = placeholderTr.replaceSelectionWith(
      imageType.create({
        src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        alt: 'Uploading image',
        title: token,
      }),
    );
  }
  view.dispatch(placeholderTr);

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const token = placeholders[index];
    try {
      const buffer = await file.arrayBuffer();
      const mimeType = file.type || 'image/png';
      const name =
        file.name && file.name !== 'image.png'
          ? file.name
          : `pasted-${uniquePasteToken()}.${extFromMime(mimeType)}`;
      const relativePath = await mediaProvider.addMedia(name, buffer, mimeType);
      const altText = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      replaceUploadPlaceholder(view, token, relativePath, altText);
      onMediaUploaded?.();
    } catch (err) {
      removeUploadPlaceholder(view, token);
      console.error('Failed to upload dropped image:', err);
    }
  }
}

function findUploadPlaceholder(
  view: ImageMutationView,
  token: string,
): { pos: number; node: ProseMirrorNode } | null {
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (node.type === view.state.schema.nodes.image && node.attrs.title === token) {
      found = { pos, node };
      return false;
    }
    return undefined;
  });
  return found;
}

function replaceUploadPlaceholder(
  view: ImageMutationView,
  token: string,
  src: string,
  alt: string,
): void {
  const found = findUploadPlaceholder(view, token);
  if (!found) return;
  view.dispatch(
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.node.attrs,
      src,
      alt,
      title: null,
    }),
  );
}

function removeUploadPlaceholder(view: ImageMutationView, token: string): void {
  const found = findUploadPlaceholder(view, token);
  if (!found) return;
  view.dispatch(view.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
}

let pasteCounter = 0;
function uniquePasteToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  pasteCounter = (pasteCounter + 1) % 1_000_000;
  return `${Date.now()}-${pasteCounter.toString(36)}`;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  return map[mime.toLowerCase()] ?? 'png';
}
