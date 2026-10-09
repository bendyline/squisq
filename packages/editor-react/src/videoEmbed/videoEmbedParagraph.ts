/**
 * The Write view's reading of a hosted-video paragraph — the ProseMirror twin
 * of core's `findBlockVideoEmbed`, over what `tiptapBridge` makes of each
 * authored form:
 *
 *  - `[title](url)` → text carrying one link mark;
 *  - a bare URL, or the `<url>` autolink → plain text (the bridge does not
 *    autolink; Tiptap's autolink may add a mark later, which is also fine);
 *  - a raw `<iframe …>` embed snippet on its own line → plain text holding
 *    the HTML.
 *
 * Plus the inverse: the paragraph node the editor writes for a video, which
 * the bridge serializes as `[title](watchUrl)` or the bare watch URL.
 */

import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import {
  isVideoEmbedUrl,
  parseVideoEmbedInput,
  parseVideoEmbedUrl,
  type BlockVideoEmbed,
} from '@bendyline/squisq/markdown';
import { escapeLinkLabel, formatLinkDestination } from '../markdownDestination';

/**
 * The hosted video a paragraph stands for, or null. Every non-blank run must
 * carry the SAME link, or none may — a link with prose beside it is a link.
 */
export function videoEmbedOfParagraph(node: PMNode): BlockVideoEmbed | null {
  if (node.type.name !== 'paragraph' || node.childCount === 0) return null;
  let href: string | null = null;
  let unlinkedText = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child.isText) return null;
    const link = child.marks.find((mark) => mark.type.name === 'link');
    const childHref = (link?.attrs as { href?: unknown } | undefined)?.href;
    if (typeof childHref !== 'string') {
      if (child.text?.trim()) unlinkedText = true;
      continue;
    }
    if (href === null) href = childHref;
    else if (href !== childHref) return null;
  }

  const text = node.textContent.trim();
  if (!text) return null;

  if (href !== null) {
    if (unlinkedText) return null;
    const embed = parseVideoEmbedUrl(href);
    if (!embed) return null;
    const title = text !== href && !isVideoEmbedUrl(text) ? text : null;
    return { embed, title, form: title ? 'link' : 'url' };
  }

  const found = parseVideoEmbedInput(text);
  if (!found) return null;
  const iframe = text.startsWith('<') && !/^<https?:/i.test(text);
  return { ...found, form: iframe ? 'iframe' : 'url' };
}

/** The paragraph content the editor writes for a video. */
export function videoEmbedParagraphJson(watchUrl: string, title?: string | null): JSONContent {
  const label = title?.trim();
  return {
    type: 'paragraph',
    content: [
      label
        ? { type: 'text', text: label, marks: [{ type: 'link', attrs: { href: watchUrl } }] }
        : { type: 'text', text: watchUrl },
    ],
  };
}

/** {@link videoEmbedParagraphJson} as a schema node, for raw ProseMirror transactions. */
export function videoEmbedParagraphNode(
  schema: Schema,
  watchUrl: string,
  title?: string | null,
): PMNode {
  return schema.nodeFromJSON(videoEmbedParagraphJson(watchUrl, title));
}

/**
 * The markdown source the editor writes for a video: `[title](watchUrl)`, or
 * the bare watch URL when untitled (GFM autolinks it; core reads the
 * paragraph's text, so an autolink that stops short of an id's trailing `_`
 * still plays).
 */
export function videoEmbedMarkdown(watchUrl: string, title?: string | null): string {
  const label = title?.trim();
  return label ? `[${escapeLinkLabel(label)}](${formatLinkDestination(watchUrl)})` : watchUrl;
}
