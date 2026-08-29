/**
 * Recover GFM footnotes from imported HTML.
 *
 * A footnote in HTML is two disconnected things — a superscript anchor in the
 * prose and a list item at the bottom of the page — joined only by a fragment
 * id. Imported naively they become a stray superscript link and an unrelated
 * ordered list, so the note stops being a note: it no longer travels with its
 * marker, and re-exporting to DOCX produces body text where Word should have a
 * real footnote.
 *
 * This pass puts them back together. It is deliberately conservative — it fires
 * only when the page marks a footnotes CONTAINER (`data-footnotes`, a
 * `class="footnotes"` section, or an EPUB `epub:type="footnotes"` aside), which
 * is what GFM, Pandoc, EPUB 3 and Word's HTML export all emit. A page with a
 * bare superscript link and no such container is left exactly as it was,
 * because a superscript link is far more often a cross-reference than a note.
 */

import type {
  MarkdownBlockNode,
  MarkdownFootnoteDefinition,
  MarkdownInlineNode,
  HtmlElement,
  HtmlNode,
} from '@bendyline/squisq/markdown';

type Attrs = Record<string, string | undefined>;

/** Trailing spaces/tabs/newlines. */
const TRAILING_WHITESPACE = /[ \t\r\n]+$/;
const WHITESPACE = /[ \t\r\n]+/;
/** Emoji/text presentation selectors, which decorate the arrow below. */
const VARIATION_SELECTORS = /[\ufe0e\ufe0f]/gu;
/** A return arrow and nothing else — what an unclassed backlink looks like. */
const RETURN_ARROW = /^[ \t\r\n\u2191\u21a9\u21b5^]+$/u;
/** `1`, `12`, `[2]`, `(3)`, `a`, `*`, `†` — how a footnote marker is labelled. */
const MARKER_LABEL = /^[ \t[(]*(?:[0-9]{1,4}|[a-z]|[*†‡])[ \t\])]*$/i;

function isElement(node: HtmlNode): node is HtmlElement {
  return node.type === 'htmlElement';
}

function attr(el: HtmlElement, name: string): string | undefined {
  return (el.attributes as Attrs)[name];
}

function classList(el: HtmlElement): string[] {
  return (attr(el, 'class') ?? '').split(WHITESPACE).filter(Boolean);
}

/** The container element a page uses to hold its footnote definitions. */
function isFootnotesContainer(el: HtmlElement): boolean {
  if (attr(el, 'data-footnotes') !== undefined) return true;
  if (attr(el, 'epub:type')?.includes('footnotes')) return true;
  const tag = el.tagName.toLowerCase();
  if (tag !== 'section' && tag !== 'aside' && tag !== 'div' && tag !== 'ol') return false;
  return classList(el).some(
    (c) => c === 'footnotes' || c === 'footnote-list' || c === 'squisq-footnotes',
  );
}

function textOf(node: HtmlNode): string {
  if (node.type === 'htmlText') return node.value;
  if (!isElement(node)) return '';
  return node.children.map(textOf).join('');
}

/** A backlink inside a definition — the arrow that returns to the marker. */
function isBacklink(el: HtmlElement): boolean {
  if (el.tagName.toLowerCase() !== 'a') return false;
  if (attr(el, 'data-footnote-backref') !== undefined) return true;
  if (classList(el).some((c) => c.includes('backref') || c === 'footnote-back')) return true;
  // Unclassed generators still emit the conventional return arrow and nothing
  // else, which no real prose link ever is.
  return RETURN_ARROW.test(textOf(el).replace(VARIATION_SELECTORS, ''));
}

/** Depth-first search for the first element satisfying `match`. */
function findElement(nodes: HtmlNode[], match: (el: HtmlElement) => boolean): HtmlElement | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (match(node)) return node;
    const nested = findElement(node.children, match);
    if (nested) return nested;
  }
  return null;
}

/** A copy of the tree with backlink anchors removed. */
function stripBacklinks(nodes: HtmlNode[]): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of nodes) {
    if (isElement(node)) {
      if (isBacklink(node)) continue;
      out.push({ ...node, children: stripBacklinks(node.children) });
      continue;
    }
    out.push(node);
  }
  return out;
}

/** A copy of the tree with one element removed, wherever it sits. */
function removeElement(nodes: HtmlNode[], target: HtmlElement): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of nodes) {
    if (node === (target as HtmlNode)) continue;
    if (isElement(node)) {
      out.push({ ...node, children: removeElement(node.children, target) });
      continue;
    }
    out.push(node);
  }
  return out;
}

/**
 * Trim trailing whitespace left behind by a removed backlink.
 *
 * The backlink is normally preceded by a separating space, which becomes a
 * trailing space on the definition's last text node once the anchor is gone —
 * and remark, quite correctly, escapes a trailing space as `&#x20;` so it can't
 * be mistaken for a hard break. Dropping it keeps the markdown clean.
 */
function trimTrailingText(nodes: HtmlNode[]): HtmlNode[] {
  const out = [...nodes];
  for (let i = out.length - 1; i >= 0; i--) {
    const node = out[i]!;
    if (node.type === 'htmlText') {
      const trimmed = node.value.replace(TRAILING_WHITESPACE, '');
      if (trimmed === '') {
        out.pop();
        continue;
      }
      out[i] = { ...node, value: trimmed };
      break;
    }
    if (isElement(node)) {
      out[i] = { ...node, children: trimTrailingText(node.children) };
    }
    break;
  }
  return out;
}

/** Every `<li id="…">` under a container, keyed by its fragment id. */
function collectDefinitionItems(container: HtmlElement): Map<string, HtmlNode[]> {
  const items = new Map<string, HtmlNode[]>();
  const walk = (nodes: HtmlNode[]): void => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      const id = attr(node, 'id');
      if (node.tagName.toLowerCase() === 'li' && id) {
        items.set(id, trimTrailingText(stripBacklinks(node.children)));
        continue;
      }
      walk(node.children);
    }
  };
  walk(container.children);
  return items;
}

/**
 * A readable markdown label for a generator's fragment id.
 *
 * GFM writes `user-content-fn-1`, Pandoc writes `fn1`; carried through
 * verbatim those become `[^user-content-fn-1]` in the markdown, which is noise
 * for something an author will read and edit. Strip the boilerplate down to the
 * marker itself, keeping the raw id whenever the short form would collide.
 */
function readableIdentifier(rawId: string, taken: ReadonlySet<string>): string {
  const short = rawId
    .replace(/^user-content-/, '')
    .replace(/^fn[-_:]?/i, '')
    .replace(/^footnote[-_:]?/i, '');
  if (short === '' || taken.has(short)) return rawId;
  return short;
}

/** What the pre-pass extracted, for the caller to fold into the document. */
export interface ExtractedFootnotes {
  /** The HTML with the footnotes container removed. */
  nodes: HtmlNode[];
  /** Definition bodies (still HTML), keyed by their READABLE identifier. */
  bodies: Map<string, HtmlNode[]>;
  /** Original fragment id → readable identifier, for resolving marker links. */
  identifiers?: Map<string, string>;
}

/**
 * Pull the footnotes container out of a parsed HTML tree.
 *
 * Returns the input unchanged (and an empty map) when the page has no marked
 * footnotes container, so ordinary pages take a single failed search.
 */
export function extractFootnoteSection(nodes: HtmlNode[]): ExtractedFootnotes {
  const container = findElement(nodes, isFootnotesContainer);
  if (!container) return { nodes, bodies: new Map() };
  const raw = collectDefinitionItems(container);
  if (raw.size === 0) return { nodes, bodies: new Map() };

  // Rename the ids to something an author would want to read, keeping a map
  // from the ORIGINAL fragment id so the marker links still resolve.
  const bodies = new Map<string, HtmlNode[]>();
  const identifiers = new Map<string, string>();
  const taken = new Set<string>();
  for (const [rawId, body] of raw) {
    const identifier = readableIdentifier(rawId, taken);
    taken.add(identifier);
    identifiers.set(rawId, identifier);
    bodies.set(identifier, body);
  }
  return { nodes: removeElement(nodes, container), bodies, identifiers };
}

/** Plain text of an inline subtree. */
function inlineText(nodes: MarkdownInlineNode[]): string {
  return nodes
    .map((n) =>
      'value' in n && typeof n.value === 'string'
        ? n.value
        : 'children' in n && Array.isArray(n.children)
          ? inlineText(n.children as MarkdownInlineNode[])
          : '',
    )
    .join('');
}

/** Whether a node is block-level, for the mixed `children` arrays below. */
function isBlockish(node: { type: string }): boolean {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'blockquote':
    case 'list':
    case 'listItem':
    case 'table':
    case 'tableRow':
    case 'tableCell':
    case 'code':
    case 'footnoteDefinition':
      return true;
    default:
      return false;
  }
}

/**
 * Rewrite marker links into `footnoteReference` nodes across a block tree.
 *
 * A link qualifies when it points at a known definition id AND reads as a
 * marker: wrapped in a superscript, or labelled like one (`1`, `[2]`, `*`).
 * An ordinary in-page link to a footnote — "see note 4 below" — has neither,
 * so it stays an ordinary link.
 */
export function linkFootnoteReferences(
  blocks: MarkdownBlockNode[],
  known: ReadonlyMap<string, string>,
): void {
  const rewriteInlines = (nodes: MarkdownInlineNode[], inSuperscript: boolean): void => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node.type === 'link') {
        const id = node.url.startsWith('#') ? node.url.slice(1) : null;
        const identifier = id ? known.get(id) : undefined;
        if (identifier && (inSuperscript || MARKER_LABEL.test(inlineText(node.children)))) {
          nodes[i] = { type: 'footnoteReference', identifier };
        }
        continue;
      }
      if (node.type === 'superscript') {
        rewriteInlines(node.children, true);
        // A superscript wrapping nothing but its marker link is now redundant
        // chrome around a reference that already renders as a superscript.
        const only = node.children.length === 1 ? node.children[0]! : null;
        if (only?.type === 'footnoteReference') nodes[i] = only;
        continue;
      }
      if ('children' in node && Array.isArray(node.children)) {
        rewriteInlines(node.children as MarkdownInlineNode[], inSuperscript);
      }
    }
  };

  const walk = (list: MarkdownBlockNode[]): void => {
    for (const block of list) {
      if (!('children' in block) || !Array.isArray(block.children)) continue;
      const children = block.children as { type: string }[];
      if (children.length > 0 && children.every(isBlockish)) {
        walk(children as MarkdownBlockNode[]);
      } else {
        rewriteInlines(children as MarkdownInlineNode[], false);
      }
    }
  };
  walk(blocks);
}

/** Build definition blocks in the order the page defined them. */
export function buildFootnoteDefinitions(
  bodies: Map<string, MarkdownBlockNode[]>,
): MarkdownFootnoteDefinition[] {
  return [...bodies.entries()].map(([identifier, children]) => ({
    type: 'footnoteDefinition' as const,
    identifier,
    children,
  }));
}
