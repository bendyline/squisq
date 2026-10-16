import type { Node as PMNode } from '@tiptap/pm/model';
import {
  splitKeyValueToken,
  tokenizeAttrTokens,
  type BlockVideoEmbed,
} from '@bendyline/squisq/markdown';
import { mediaKindFromUrl } from '../embeddedMedia';
import { mediaEditKeysFor, mediaEditNodeAttributeName } from '../tiptap/mediaEditAttributes';
import { videoEmbedOfParagraph } from '../videoEmbed/videoEmbedParagraph';

export interface DocumentTrayMedia {
  kind: 'audio' | 'video';
  src: string;
  title?: string | null;
  attrs: Record<string, unknown>;
  embed?: BlockVideoEmbed;
  /** Only native media nodes support the placement toolbar's attribute edits. */
  editableAttributes: boolean;
}

/** Read presentation data without changing the authored node or its spelling. */
export function documentTrayMedia(node: PMNode): DocumentTrayMedia | null {
  if (node.type.name === 'audio' || node.type.name === 'video') {
    const src: unknown = node.attrs.src;
    return typeof src === 'string' && src
      ? { kind: node.type.name, src, attrs: node.attrs, editableAttributes: true }
      : null;
  }
  if (node.type.name !== 'paragraph') return null;
  const embed = videoEmbedOfParagraph(node);
  if (embed) {
    return {
      kind: 'video',
      src: embed.embed.watchUrl,
      title: embed.title,
      attrs: {},
      embed,
      editableAttributes: false,
    };
  }
  // An annotation must occupy the entire paragraph, with no inline atoms or
  // code marks: an example in prose/code is never a document attachment.
  if (
    Array.from({ length: node.childCount }, (_, i) => node.child(i)).some(
      (child) => !child.isText || child.marks.some((mark) => mark.type.name === 'code'),
    )
  )
    return null;
  const match = node.textContent.trim().match(/^\{\[(audio|video|media)\s+([^\n]*?)\]\}$/);
  if (match) {
    const params: Record<string, string> = {};
    for (const token of tokenizeAttrTokens(match[2])) {
      const kv = splitKeyValueToken(token);
      if (kv) params[kv.key] = kv.value;
    }
    if (!params.src) return null;
    const kind = match[1] === 'video' ? 'video' : 'audio';
    const attrs: Record<string, unknown> = { src: params.src, controls: true };
    for (const key of mediaEditKeysFor(kind)) {
      if (params[key] != null) attrs[mediaEditNodeAttributeName(key)] = params[key];
    }
    return { kind, src: params.src, attrs, editableAttributes: false };
  }
  return null;
}

/** Standalone links to local media are attachments too; prose links are not. */
function linkedMedia(node: PMNode): DocumentTrayMedia | null {
  if (node.type.name !== 'paragraph' || !node.childCount) return null;
  let src: string | undefined;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const href: unknown = child.marks.find((mark) => mark.type.name === 'link')?.attrs.href;
    if (!child.isText || typeof href !== 'string' || (src && src !== href)) return null;
    src = href;
  }
  const kind = src ? mediaKindFromUrl(src) : null;
  return src && kind
    ? {
        kind,
        src,
        title: node.textContent,
        attrs: { src, controls: true },
        editableAttributes: false,
      }
    : null;
}

export interface LocatedTrayMedia extends DocumentTrayMedia {
  pos: number;
  node: PMNode;
}

/**
 * The opening media run, allowing blanks and one opening heading. Recorder
 * narrations live immediately after that heading. A second heading or any
 * other content (including images, lists, tables and fences) ends the run.
 * Never descend into nested content or promote a later document-anchored clip.
 */
export function collectDocumentTrayMedia(doc: PMNode): LocatedTrayMedia[] {
  const items: LocatedTrayMedia[] = [];
  let stopped = false;
  let headingSeen = false;
  doc.forEach((node, pos) => {
    if (stopped) return;
    if (node.type.name === 'heading' && !headingSeen) {
      headingSeen = true;
      return;
    }
    if (
      node.type.name === 'paragraph' &&
      !node.textContent.trim() &&
      Array.from({ length: node.childCount }, (_, i) => node.child(i)).every(
        (child) => child.isText,
      )
    )
      return;
    const media = documentTrayMedia(node) ?? linkedMedia(node);
    if (media) items.push({ ...media, node, pos });
    else stopped = true;
  });
  return items;
}
