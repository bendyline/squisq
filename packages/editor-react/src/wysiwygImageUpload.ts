import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView as ProseMirrorView } from '@tiptap/pm/view';
import { fileReference, mediaMimeType, squisqMediaKind, squisqMediaNode } from './mediaDragMime';
import { processMediaFiles } from './utils/dropUtils';

type ImageMutationView = Pick<ProseMirrorView, 'state' | 'dispatch'>;

/** Whether a file becomes a `<video>` or `<audio>` player when inserted. */
export function isPlayableMediaFile(file: Pick<File, 'name' | 'type'>): boolean {
  const kind = squisqMediaKind(mediaMimeType(file));
  return kind === 'video' || kind === 'audio';
}

/**
 * Store video and audio files, then insert a player for each at the caret,
 * which a drop has already moved to the drop point. Players are block atoms,
 * so they cannot borrow the inline placeholder images use; they land together,
 * in the order given, once every file is stored.
 */
export async function uploadAndInsertMediaPlayers(
  view: ImageMutationView,
  files: File[],
  mediaProvider: MediaProvider,
  onMediaUploaded?: () => void,
): Promise<void> {
  const paths = await processMediaFiles(files, mediaProvider);
  if (!paths.some(Boolean)) return;
  onMediaUploaded?.();

  const { schema } = view.state;
  const players: ProseMirrorNode[] = [];
  for (const [index, path] of paths.entries()) {
    if (!path) continue;
    const spec = squisqMediaNode(fileReference(path, files[index].name, files[index].type));
    const nodeType = spec ? schema.nodes[spec.type] : undefined;
    if (spec && nodeType) players.push(nodeType.create(spec.attrs));
  }
  if (players.length > 0) insertTopLevelNodes(view, players);
}

/**
 * Insert block nodes at the top level: in place of the caret's paragraph when
 * it is empty, otherwise after the caret's top-level block — never inside a
 * list item, whose serializer would drop a nested block.
 */
export function insertTopLevelNodes(view: ImageMutationView, nodes: ProseMirrorNode[]): void {
  const { state } = view;
  const { $from } = state.selection;
  if ($from.depth < 1) {
    view.dispatch(state.tr.insert(state.doc.content.size, nodes).scrollIntoView());
    return;
  }
  const block = $from.node(1);
  const tr =
    block.type.name === 'paragraph' && block.content.size === 0
      ? state.tr.replaceWith($from.before(1), $from.after(1), nodes)
      : state.tr.insert($from.after(1), nodes);
  view.dispatch(tr.scrollIntoView());
}

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
  for (const [index, token] of placeholders.entries()) {
    placeholderTr = placeholderTr.replaceSelectionWith(
      imageType.create({
        src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        alt: files[index].name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'Image',
        title: token,
      }),
    );
  }
  view.dispatch(placeholderTr);

  // Stable placeholders preserve document order even when a later image
  // finishes first. Bound concurrency so a large drop does not flood storage.
  let nextIndex = 0;
  const uploadNext = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++;
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
  };
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, uploadNext));
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
