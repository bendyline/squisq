/**
 * Template input derivation — build a template's required inputs from a
 * block's heading + markdown body.
 *
 * Used by:
 * - `markdownToDoc`'s content-aware auto template picking, so an
 *   auto-picked `quote`/`statHighlight`/`leftFeature` block carries the
 *   inputs its template needs through every render path (player, linear
 *   view, exports).
 * - `LinearDocView` / editor previews, to render annotated blocks whose
 *   authors didn't spell out every template param.
 *
 * Two modes:
 * - strict (default): returns `null` when an essential input can't be
 *   derived (no image for a feature block, no table for dataTable…) —
 *   auto-picking uses this to fall back to the structural default.
 * - placeholders: returns visible placeholder values instead of failing —
 *   preview surfaces use this so a half-authored block still renders.
 */

import type { MarkdownBlockNode, MarkdownList, MarkdownTable } from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';

/** First image discovered in a block's body, with explicit dimensions when present. */
export interface FirstImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

/** Plain text of a block's body contents (excluding the heading). */
export function extractBodyPlainText(contents?: MarkdownBlockNode[]): string {
  if (!contents || contents.length === 0) return '';
  return contents
    .map((n) => extractPlainText(n))
    .join('\n')
    .trim();
}

/** Extract list items as plain text. */
export function extractListItems(contents?: MarkdownBlockNode[]): string[] {
  if (!contents) return [];
  const items: string[] = [];
  for (const node of contents) {
    if (node.type === 'list') {
      for (const item of (node as MarkdownList).children) {
        const text = extractPlainText(item).trim();
        if (text) items.push(text);
      }
    }
  }
  return items;
}

/** Parse a `width`/`height` HTML attribute to a positive number. */
function parseDim(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Find images referenced anywhere in block contents — both markdown
 * shorthand `![alt](url)` (type `image`) and raw HTML `<img>` tags
 * (type `htmlBlock`/`htmlInline`). The WYSIWYG editor emits the HTML form
 * whenever a user resizes an image, so missing that path silently breaks
 * every resized image.
 *
 * @param limit Stop after this many images (default: all).
 */
export function extractImages(
  contents: MarkdownBlockNode[] | undefined,
  limit = Infinity,
): FirstImage[] {
  if (!contents || contents.length === 0) return [];
  const found: FirstImage[] = [];

  function fromHtml(nodes: unknown[]): void {
    for (const node of nodes) {
      if (found.length >= limit) return;
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      if (n.type === 'htmlElement' && n.tagName === 'img') {
        const attrs = n.attributes as Record<string, string> | undefined;
        if (attrs && typeof attrs.src === 'string' && attrs.src) {
          found.push({
            src: attrs.src,
            alt: typeof attrs.alt === 'string' ? attrs.alt : '',
            width: parseDim(attrs.width),
            height: parseDim(attrs.height),
          });
        }
      }
      if (Array.isArray(n.children)) fromHtml(n.children);
    }
  }

  function walk(node: unknown): void {
    if (found.length >= limit) return;
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'image' && typeof n.url === 'string' && n.url) {
      found.push({ src: n.url, alt: typeof n.alt === 'string' ? n.alt : '' });
      return;
    }
    if ((n.type === 'htmlBlock' || n.type === 'htmlInline') && Array.isArray(n.htmlChildren)) {
      fromHtml(n.htmlChildren);
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
    }
  }

  for (const node of contents) {
    if (found.length >= limit) break;
    walk(node);
  }
  return found;
}

/** First image in a block's body, or null. */
export function extractFirstImage(contents: MarkdownBlockNode[] | undefined): FirstImage | null {
  return extractImages(contents, 1)[0] ?? null;
}

/** Extract table data (headers, rows, alignment) from block contents. */
export function extractTableFromContents(contents?: MarkdownBlockNode[]): {
  headers: string[];
  rows: string[][];
  align?: (('left' | 'right' | 'center') | null)[];
} | null {
  if (!contents) return null;
  for (const node of contents) {
    if (node.type === 'table') {
      const table = node as MarkdownTable;
      const [headerRow, ...bodyRows] = table.children;
      if (!headerRow) return null;
      const headers = headerRow.children.map((cell) => extractPlainText(cell).trim());
      const rows = bodyRows.map((row) => row.children.map((cell) => extractPlainText(cell).trim()));
      return { headers, rows, align: table.align };
    }
  }
  return null;
}

/** First blockquote's plain text, or ''. */
export function extractBlockquoteText(contents?: MarkdownBlockNode[]): string {
  if (!contents) return '';
  for (const node of contents) {
    if (node.type === 'blockquote') return extractPlainText(node).trim();
  }
  return '';
}

export interface DeriveTemplateInputsOptions {
  /**
   * Return visible placeholder values instead of `null` when an essential
   * input can't be derived (preview surfaces). Default false (strict).
   */
  placeholders?: boolean;
}

/**
 * Derive a template's inputs from a block's heading text and body nodes.
 * Returns the input fields to merge onto the block, or `null` in strict
 * mode when an essential input is missing.
 */
export function deriveTemplateInputs(
  templateName: string,
  headingText: string,
  contents: MarkdownBlockNode[] | undefined,
  options: DeriveTemplateInputsOptions = {},
): Record<string, unknown> | null {
  const placeholders = options.placeholders === true;
  const bodyText = extractBodyPlainText(contents);

  switch (templateName) {
    case 'statHighlight':
      return { stat: headingText, description: bodyText || headingText };
    case 'quote': {
      const quote = extractBlockquoteText(contents) || bodyText || headingText;
      return { quote };
    }
    case 'fullBleedQuote':
    case 'pullQuote': {
      // These templates take `text` (not `quote`).
      const text = extractBlockquoteText(contents) || bodyText || headingText;
      return { text };
    }
    case 'factCard':
      return { fact: headingText, explanation: bodyText || headingText };
    case 'comparisonBar':
      return placeholders ? { leftLabel: 'A', leftValue: 60, rightLabel: 'B', rightValue: 40 } : null;
    case 'list': {
      const items = extractListItems(contents);
      if (items.length > 0) return { items };
      return placeholders ? { items: ['Item 1', 'Item 2', 'Item 3'] } : null;
    }
    case 'definitionCard':
      return { term: headingText, definition: bodyText || headingText };
    case 'dateEvent':
      return { date: headingText, description: bodyText || headingText };
    case 'dataTable': {
      const tableData = extractTableFromContents(contents);
      if (tableData) return tableData;
      return placeholders ? { headers: ['Column'], rows: [['Data']] } : null;
    }
    case 'imageWithCaption': {
      const img = extractFirstImage(contents);
      if (!img) return placeholders ? { caption: headingText } : null;
      return { imageSrc: img.src, imageAlt: img.alt || headingText, caption: headingText };
    }
    case 'photoGrid': {
      const images = extractImages(contents, 4);
      if (images.length < 2) return placeholders ? {} : null;
      return {
        images: images.map((i) => ({ src: i.src, alt: i.alt })),
        caption: headingText,
      };
    }
    case 'leftFeature':
    case 'rightFeature': {
      const img = extractFirstImage(contents);
      if (!img && !placeholders) return null;
      return {
        imageSrc: img?.src ?? '',
        imageAlt: img?.alt || headingText,
        imageWidth: img?.width,
        imageHeight: img?.height,
        title: headingText,
        body: bodyText,
      };
    }
    default:
      return placeholders ? {} : null;
  }
}
