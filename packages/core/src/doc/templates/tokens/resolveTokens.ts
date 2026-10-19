/**
 * Token resolver for user-defined custom templates.
 *
 * Custom templates author their layers with placeholder strings — e.g.
 * a TextLayer whose `content.text` is `"Welcome, {title}!"` — and the
 * resolver substitutes those placeholders against the source Block's
 * actual data at render time. Built-in templates don't use the
 * resolver; they construct strings imperatively in their own
 * functions.
 *
 * Token grammar (v2):
 *   {name}            — bare name, e.g. `{title}`, `{content}`,
 *                       `{children}`
 *   {name:arg}        — name with a string argument, e.g. `{image:0}`
 *                       (Nth image in the block's body), `{attr:key}`
 *   {name|default}    — pipe default: used when the token resolves to
 *                       the empty string, e.g. `{title|Untitled}`
 *   {name:arg|default}— combined, e.g. `{attr:subtitle|Untitled}` or
 *                       `{image:1|fallback.jpg}` (the default is applied
 *                       AFTER arg splitting, so it works in image src)
 *   {{name}}          — escaped — renders as the literal text `{name}`
 *                       (lets an author include a real `{title}` in body
 *                       text without it being interpreted as a token)
 *
 * Unknown tokens are left as literal text so the author can see what's
 * misspelled. Tokens with no value (e.g. `{title}` when block.title is
 * undefined) collapse to the empty string — or to the pipe default when
 * one is supplied.
 *
 * Token semantics:
 *   - {title}      — Block.title
 *   - {content}    — extractPlainText() of Block.contents, joined
 *                    with single spaces
 *   - {children}   — comma-separated list of Block.children[].title
 *   - {attr:key}   — Block.templateOverrides[key] ?? templateData[key]
 *                    ?? metadata[key], stringified
 *   - {image:N}    — In TextLayer: the Nth image's `alt` text.
 *                    In ImageLayer.content.src: the Nth image's URL
 *                    (if no Nth image exists and no default is given,
 *                    the layer is dropped).
 *
 * Per-item tokens (only meaningful inside a layer that carries a
 * `repeat` directive — see {@link LayerRepeat}):
 *   - {item}       — image alt / child title / list-item text
 *   - {item:src}   — image src (empty for children / list items)
 *   - {item:label} — item label (same as {item} for children/list items)
 *   - {index}      — 1-based position of the item in its collection
 */

import type { Block, Layer, ImageLayer } from '../../../schemas/Doc.js';
import type { CustomTemplateLayer } from '../../../schemas/CustomTemplates.js';
import type { MarkdownBlockNode } from '../../../markdown/types.js';
import { extractPlainText, walkMarkdownTree } from '../../../markdown/utils.js';
import { extractImages, isPictureFence } from '../../templateInputs.js';

interface ImageRef {
  url: string;
  alt: string;
}

/**
 * One resolved iteration item, produced by {@link collectRepeatItems}
 * and threaded into token resolution for a repeated layer's clone.
 */
interface RepeatItem {
  /** `{item}` — image alt / child title / list-item text. */
  text: string;
  /** `{item:src}` — image URL (undefined for children / list items). */
  src?: string;
  /** `{item:label}` — a display label for the item. */
  label?: string;
  /** `{index}` — 1-based position in the source collection. */
  index: number;
}

// Matches a single token: name, optional `:arg`, optional `|default`.
// The arg stops at `|` so the default can be split off afterwards; the
// default runs to the closing brace. Recreated per call site would be
// wasteful, but a shared global is safe: String.replace resets a global
// regex's lastIndex, and resolution is single-threaded/sequential.
const TOKEN_RE = /\{(\w+)(?::([^}|]+))?(?:\|([^}]*))?\}/g;
// Matches an escaped `{{…}}` block (no nested braces).
const ESCAPE_RE = /\{\{([^{}]*)\}\}/g;

// Sentinels chosen so they can't collide with real user content and
// survive plain-text copy; safer than zero-width characters.
const ESCAPED_OPEN = ' ESC_OPEN ';
const ESCAPED_CLOSE = ' ESC_CLOSE ';

/**
 * The block's body images in document order — inline `![alt](url)` nodes
 * and raw HTML `<img>` tags alike, since the WYSIWYG editor writes a
 * resized image as `<img src width>`.
 *
 * Returns an empty array when the block has no `contents` or none of
 * the contents contain images.
 */
function collectImages(block: Block): ImageRef[] {
  return extractImages(block.contents).map((image) => ({ url: image.src, alt: image.alt }));
}

/**
 * Walk the block's body content collecting the plain text of every
 * top-level list item, in document order. Mirrors {@link collectImages}
 * but for `{ repeat: { source: 'listItems' } }`. Nested lists are not
 * descended into separately — a nested list's text is already folded
 * into its parent item's text, so we skip children of a `listItem` to
 * avoid double-counting.
 *
 * Exported for the same reason `resolveTokens` is: it's the collector
 * the repeat machinery relies on and is unit-tested directly.
 */
export function collectListItems(block: Block): string[] {
  if (!block.contents) return [];
  const out: string[] = [];
  for (const node of block.contents as MarkdownBlockNode[]) {
    walkMarkdownTree(node, (n) => {
      if (n.type === 'listItem') {
        const text = extractPlainText(n).replace(/\s+/g, ' ').trim();
        if (text) out.push(text);
        // Skip descent: this item's nested lists are already part of
        // its plain text above; don't visit them as separate items.
        return true;
      }
      return;
    });
  }
  return out;
}

/**
 * Plain-text join of Block.contents. Block-level boundaries become
 * spaces so a `{content}` substitution reads as natural prose rather
 * than running paragraphs together.
 */
function getBlockBodyText(block: Block): string {
  if (!block.contents) return '';
  return (block.contents as MarkdownBlockNode[])
    .filter((node) => !isPictureFence(node))
    .map((node) => extractPlainText(node).trim())
    .filter((s) => s.length > 0)
    .join(' ');
}

/** Comma-joined child titles (omits children without a title). */
function getChildrenSummary(block: Block): string {
  if (!block.children || block.children.length === 0) return '';
  return block.children
    .map((c) => c.title?.trim())
    .filter((t): t is string => Boolean(t))
    .join(', ');
}

function escapeBraces(text: string): string {
  return text.replace(ESCAPE_RE, (_match, inner: string) => ESCAPED_OPEN + inner + ESCAPED_CLOSE);
}

function unescapeBraces(text: string): string {
  return text
    .replace(new RegExp(ESCAPED_OPEN, 'g'), '{')
    .replace(new RegExp(ESCAPED_CLOSE, 'g'), '}');
}

/**
 * Substitute every `{token}` occurrence in `text` using `resolve`,
 * preserving `{{token}}` as a literal `{token}`.
 *
 * `resolve` returns `null` for an unknown token (the whole match,
 * including any `|default`, is left literal) or a string value. When the
 * value is the empty string and a `|default` was supplied, the default
 * is used. Escaped `{{…}}` blocks are shielded first so tokens inside
 * them are never interpreted.
 */
function substitute(
  text: string,
  resolve: (name: string, arg: string | undefined) => string | null,
): string {
  const escaped = escapeBraces(text);
  const tokenized = escaped.replace(
    TOKEN_RE,
    (match, name: string, arg: string | undefined, def: string | undefined) => {
      const value = resolve(name, arg);
      if (value == null) return match;
      if (value === '' && def !== undefined) return def;
      return value;
    },
  );
  return unescapeBraces(tokenized);
}

/**
 * Look up a single token as text. Returns null when the token is
 * unknown — caller treats null as "leave the placeholder literal".
 * `{item}` / `{index}` resolve to null when there is no per-item
 * context (i.e. the layer isn't inside a `repeat`).
 */
function resolveToken(
  name: string,
  arg: string | undefined,
  block: Block,
  images: ImageRef[],
  item: RepeatItem | undefined,
): string | null {
  switch (name) {
    case 'title':
      return block.title ?? '';
    case 'content':
      return getBlockBodyText(block);
    case 'children':
      return getChildrenSummary(block);
    case 'attr': {
      if (!arg) return '';
      const raw =
        block.templateOverrides?.[arg] ?? block.templateData?.[arg] ?? block.metadata?.[arg];
      return raw == null ? '' : String(raw);
    }
    case 'image': {
      const idx = arg ? parseInt(arg, 10) : 0;
      if (!Number.isFinite(idx) || idx < 0 || idx >= images.length) return '';
      return images[idx].alt;
    }
    case 'item': {
      if (!item) return null;
      if (!arg) return item.text;
      if (arg === 'src') return item.src ?? '';
      if (arg === 'label') return item.label ?? '';
      return '';
    }
    case 'index':
      return item ? String(item.index) : null;
    default:
      return null;
  }
}

function substituteText(
  text: string,
  block: Block,
  images: ImageRef[],
  item: RepeatItem | undefined,
): string {
  return substitute(text, (name, arg) => resolveToken(name, arg, block, images, item));
}

/**
 * Resolve tokens inside an ImageLayer's `content.src`. `{image:N}`
 * resolves to the Nth image's URL (not its alt); `{item:src}` and
 * `{attr:key}` resolve as usual. When an `{image:N}` has no matching
 * image AND no `|default`, the whole layer is dropped (returns null) so
 * we never leave a broken URL. A supplied default suppresses the drop.
 */
function resolveImageSrc(
  src: string,
  block: Block,
  images: ImageRef[],
  item: RepeatItem | undefined,
): string | null {
  // Optimization: nothing to resolve.
  if (!src.includes('{')) return src;

  let dropped = false;
  const escaped = escapeBraces(src);
  const tokenized = escaped.replace(
    TOKEN_RE,
    (match, name: string, arg: string | undefined, def: string | undefined) => {
      if (name === 'image') {
        const idx = arg ? parseInt(arg, 10) : 0;
        const ok = Number.isFinite(idx) && idx >= 0 && idx < images.length;
        if (ok) return images[idx].url;
        if (def !== undefined) return def;
        dropped = true;
        return '';
      }
      const value = resolveToken(name, arg, block, images, item);
      if (value == null) return match;
      if (value === '' && def !== undefined) return def;
      return value;
    },
  );

  if (dropped) return null;
  return unescapeBraces(tokenized);
}

/**
 * Parse the leading numeric magnitude of a position field (px number or
 * `%`-string). Used to advance the cursor between repeated clones.
 */
function parseMagnitude(value: number | string | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const m = value.match(/-?\d*\.?\d+/);
    if (m) return parseFloat(m[0]);
  }
  return 0;
}

/**
 * Offset a position coordinate by `delta`, preserving its unit: a bare
 * number stays a number; a `%`-string (or any suffixed string) keeps
 * its suffix.
 */
function offsetCoord(base: number | string | undefined, delta: number): number | string {
  if (base == null) return delta;
  if (typeof base === 'number') return base + delta;
  const m = base.match(/^(\s*)(-?\d*\.?\d+)(.*)$/);
  if (m) {
    const next = parseFloat(m[2]) + delta;
    return `${m[1]}${next}${m[3]}`;
  }
  return base;
}

/** Build the per-item list for a `repeat` source collection. */
function collectRepeatItems(
  source: 'images' | 'children' | 'listItems',
  block: Block,
  images: ImageRef[],
): RepeatItem[] {
  switch (source) {
    case 'images':
      return images.map((img, i) => ({
        text: img.alt,
        src: img.url,
        label: img.alt,
        index: i + 1,
      }));
    case 'children':
      return (block.children ?? []).map((child, i) => ({
        text: child.title ?? '',
        label: child.title ?? '',
        index: i + 1,
      }));
    case 'listItems':
      return collectListItems(block).map((text, i) => ({ text, label: text, index: i + 1 }));
    default:
      return [];
  }
}

/**
 * Expand a `repeat` layer into one clone per item of its source
 * collection. Each clone is offset along `direction` by the cumulative
 * `(width|height) + gap`, has `repeat` stripped, gets a per-clone id,
 * and resolves per-item tokens against its item.
 */
function expandRepeat(layer: CustomTemplateLayer, block: Block, images: ImageRef[]): Layer[] {
  const repeat = layer.repeat;
  if (!repeat) {
    const resolved = resolveLayer(layer, block, images, undefined);
    return resolved ? [resolved] : [];
  }

  const items = collectRepeatItems(repeat.source, block, images);
  const direction = repeat.direction ?? 'column';
  const gap = repeat.gap ?? 24;
  const limit =
    repeat.max != null && repeat.max >= 0 ? Math.min(repeat.max, items.length) : items.length;

  const out: Layer[] = [];
  let cursor = 0;
  for (let i = 0; i < limit; i++) {
    const position = { ...layer.position };
    if (direction === 'row') {
      position.x = offsetCoord(position.x, cursor);
    } else {
      position.y = offsetCoord(position.y, cursor);
    }

    const clone = { ...layer, position, id: `${layer.id}-${i}` } as CustomTemplateLayer;
    delete clone.repeat;

    const resolved = resolveLayer(clone, block, images, items[i]);
    if (resolved) out.push(resolved);

    const dim = direction === 'row' ? layer.position.width : layer.position.height;
    cursor += parseMagnitude(dim) + gap;
  }
  return out;
}

/**
 * Walk the layer array and produce a new array with all placeholder
 * tokens resolved. Layers carrying a `repeat` directive are expanded
 * into one clone per source item. ImageLayers whose `{image:N}` token
 * doesn't match a real image (and has no default) are filtered out.
 * Other layer types pass through unchanged.
 *
 * Pure function — does not mutate the input.
 */
export function resolveTokens(layers: readonly CustomTemplateLayer[], block: Block): Layer[] {
  const images = collectImages(block);
  const out: Layer[] = [];
  for (const layer of layers) {
    if (layer.repeat) {
      out.push(...expandRepeat(layer, block, images));
    } else {
      const resolved = resolveLayer(layer, block, images, undefined);
      if (resolved) out.push(resolved);
    }
  }
  return out;
}

function resolveLayer(
  layer: CustomTemplateLayer,
  block: Block,
  images: ImageRef[],
  item: RepeatItem | undefined,
): Layer | null {
  switch (layer.type) {
    case 'text':
      return {
        ...layer,
        content: {
          ...layer.content,
          text: substituteText(layer.content.text, block, images, item),
        },
      };
    case 'image': {
      const nextSrc = resolveImageSrc(layer.content.src, block, images, item);
      if (nextSrc == null) return null;
      const next: ImageLayer = {
        ...layer,
        content: {
          ...layer.content,
          src: nextSrc,
        },
      };
      // Also try to substitute the alt text if it carries a token.
      if (layer.content.alt && layer.content.alt.includes('{')) {
        next.content.alt = substituteText(layer.content.alt, block, images, item);
      }
      return next;
    }
    default:
      return layer;
  }
}
