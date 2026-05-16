/**
 * Plain HTML Export — semantic, player-free
 *
 * Renders a MarkdownDocument to a self-contained HTML string. Unlike
 * `docToHtml` (which bundles the SquisqPlayer IIFE and renders SVG block
 * cards), this output is what a reader-mode tool would produce: semantic
 * `<h1>`/`<p>`/`<ul>`/etc. with a small embedded stylesheet, no JS, no
 * runtime path-rewriting. Drives both the "Page" preview tab in the
 * editor and the plain-style branch of the export dialog so what users
 * see live matches the file they download.
 *
 * Image URLs default to the markdown's own paths. Pass `images` to
 * substitute a different value per source URL — typically pre-resolved
 * blob URLs (live preview) or data URIs (single-file export).
 */

import type { MarkdownDocument, MarkdownNode, HtmlNode } from '@bendyline/squisq/markdown';
import type { Theme } from '@bendyline/squisq/schemas';
import { resolveFontFamily, buildGoogleFontsUrl, resolveTheme } from '@bendyline/squisq/schemas';

// ── Public Types ───────────────────────────────────────────────────

export interface PlainHtmlExportOptions {
  /** Document title — populates `<title>` and is HTML-escaped. */
  title?: string;
  /**
   * Substitution map for image `src` URLs. Keys are the URL exactly as
   * it appears in the markdown source; values are the URL to emit in
   * the rendered `<img src>`. URLs not present in the map fall through
   * unchanged (so external `https://…` references still work).
   */
  images?: Map<string, string>;
  /**
   * Substitution map for anchor `href` URLs. Keys are the URL exactly
   * as it appears in the markdown source (e.g. `'resume.md'`,
   * `'resume.md#experience'`); values are the URL to emit. URLs not in
   * the map pass through unchanged. Used by the recursive bundle
   * exporter to rewrite `.md` references to `.html` so a static export
   * of a linked document tree is internally browsable.
   */
  links?: Map<string, string>;
  /**
   * Optional Squisq theme. When provided, the rendered page uses the
   * theme's colors and typography, and any Google-hosted fonts the
   * theme references are loaded via a `<link>` to fonts.googleapis.com
   * so the face renders correctly without host preloads.
   *
   * When omitted, the function falls back (in order) to {@link themeId}
   * and then to `doc.frontmatter.themeId` — so an authored
   * `themeId: warm-earth` in the doc's frontmatter styles the export
   * automatically, without the caller having to wire theme resolution
   * themselves.
   */
  theme?: Theme;
  /**
   * Optional theme id (e.g. `'warm-earth'`, `'gezellig'`). Convenient
   * for hosts whose export dialog tracks themes by id — they can pass
   * the id straight through instead of resolving to a `Theme` object.
   * When both `theme` and `themeId` are provided, `theme` wins.
   */
  themeId?: string;
  /**
   * Optional FontAwesome CSS text to inline into the rendered page,
   * replacing the default cross-origin `<link>` to cdnjs. Required for
   * sandboxed iframe previews where tracking prevention or stricter
   * origin policies can silently drop cross-origin font fetches —
   * inlining keeps the icons resolvable purely from same-origin
   * resources. Hosts typically gather this string by scraping
   * `document.styleSheets` for `@font-face` rules whose family starts
   * with `"Font Awesome"`. The CDN `<link>` is only emitted when this
   * option is not provided.
   */
  iconsCss?: string;
}

/**
 * Internal render context — bundles the substitution maps so adding a
 * new one (e.g. `links`) doesn't require threading another parameter
 * through every node renderer.
 */
interface RenderCtx {
  images?: Map<string, string>;
  links?: Map<string, string>;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Render a parsed markdown document as a complete, semantic HTML page.
 *
 * When `options.theme` is provided, the output adopts the theme's
 * colors and typography. Google-hosted fonts referenced by the theme
 * are loaded via a single `<link>` to fonts.googleapis.com so the page
 * renders consistently when opened standalone.
 */
export function markdownDocToPlainHtml(
  doc: MarkdownDocument,
  options: PlainHtmlExportOptions = {},
): string {
  const { title = 'Document', images, links, themeId, iconsCss } = options;
  // Fall back chain for theme: explicit `theme` → explicit `themeId`
  // option → doc frontmatter `themeId`. Hosts whose export dialog
  // tracks themes by id can pass `themeId` straight through; authored
  // docs with `themeId: warm-earth` in frontmatter get styled
  // automatically when neither is supplied.
  const theme =
    options.theme ??
    (themeId ? resolveTheme(themeId) : undefined) ??
    (typeof doc.frontmatter?.themeId === 'string'
      ? resolveTheme(doc.frontmatter.themeId)
      : undefined);
  const ctx: RenderCtx = { images, links };
  const body = renderTopLevel(doc.children, ctx);
  const fontsLink = theme ? renderFontsLink(theme) : '';
  // Resolve how to load FontAwesome — only when the doc actually uses
  // icons. When the host supplies `iconsCss` (typical for sandboxed
  // iframe previews where cross-origin font fetches get blocked), we
  // inline it as a `<style>` block; otherwise we fall back to the
  // public cdnjs `<link>` which works for standalone HTML files.
  const usesIcons = docUsesIcons(doc);
  let iconsLink = '';
  if (usesIcons) {
    iconsLink = iconsCss ? `<style data-fa-inline>\n${iconsCss}\n</style>\n` : FONT_AWESOME_LINK;
  }
  const themedCss = theme ? renderThemedCss(theme) : DEFAULT_CSS;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${fontsLink}${iconsLink}<style>
${themedCss}
${FEATURE_CSS}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Hosted FontAwesome Free CSS. Pinned to a specific release so the
 * integrity hash stays in sync — bump both fields together when
 * upgrading. Cdnjs serves the matching SRI hash on every release page.
 */
const FONT_AWESOME_LINK = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" integrity="sha512-SnH5WK+bZxgPHs44uWIX+LLJAJ9/2PkPKZ5QiAj6Ta86w+fsb2TkcmfRyVX3pBnMFcV7oQPJkl9QevSCWr3W6A==" crossorigin="anonymous" referrerpolicy="no-referrer">
`;

/** Walk the doc looking for any `inlineIcon` node. Cheap depth-first
 *  traversal — bails out at the first hit. */
function docUsesIcons(doc: MarkdownDocument): boolean {
  function visit(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, unknown>;
    if (n.type === 'inlineIcon') return true;
    if (Array.isArray(n.children)) {
      for (const child of n.children) if (visit(child)) return true;
    }
    return false;
  }
  return visit(doc);
}

// ── Top-level walk with feature-section grouping ───────────────────

/**
 * Walk the document's top-level children, grouping headings that carry
 * a `leftFeature` / `rightFeature` template annotation with the body
 * blocks that follow them (up to the next sibling-or-higher heading).
 * Each group renders as a single `<section class="squisq-feature ...">`
 * with a media column and a text column — the plain-HTML analogue of
 * the SVG layer layout produced by `getLayers` for the same templates.
 */
function renderTopLevel(children: MarkdownNode[], ctx: RenderCtx | undefined): string {
  const out: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i] as { type?: string };
    if (node && node.type === 'heading') {
      const heading = node as MarkdownHeadingLike;
      const tpl = heading.templateAnnotation?.template;
      if (tpl === 'leftFeature' || tpl === 'rightFeature') {
        const end = findSectionEnd(children, i);
        const sectionBody = children.slice(i + 1, end);
        out.push(renderFeatureSection(heading, sectionBody, tpl, ctx));
        i = end - 1;
        continue;
      }
    }
    out.push(nodeToHtml(node as MarkdownNode, ctx));
  }
  return out.join('\n');
}

interface MarkdownHeadingLike {
  type: 'heading';
  depth: number;
  children?: MarkdownNode[];
  templateAnnotation?: { template?: string };
}

/**
 * Index of the next heading after `from`; otherwise the array length.
 * Feature sections greedily eat the heading's immediate body content
 * (paragraphs, lists, images) up to the next heading of any depth — a
 * nested sub-heading inside a feature would look chaotic in the
 * side-by-side layout, so we keep features short by design.
 */
function findSectionEnd(nodes: MarkdownNode[], from: number): number {
  for (let i = from + 1; i < nodes.length; i++) {
    const n = nodes[i] as { type?: string };
    if (n && n.type === 'heading') return i;
  }
  return nodes.length;
}

/**
 * Render a feature section as `<section class="squisq-feature ...">`.
 * The first image found in the body becomes the media column; the
 * heading + remaining content (with the image stripped, so it doesn't
 * appear twice) becomes the text column.
 */
function renderFeatureSection(
  heading: MarkdownHeadingLike,
  bodyNodes: MarkdownNode[],
  side: 'leftFeature' | 'rightFeature',
  ctx: RenderCtx | undefined,
): string {
  const headingTag = `h${Math.min(Math.max(heading.depth ?? 2, 1), 6)}`;
  const headingHtml = `<${headingTag}>${childrenToHtml({ children: heading.children }, ctx)}</${headingTag}>`;

  const featured = takeFirstImage(bodyNodes);
  const media = featured.image
    ? renderFeatureImage(featured.image, ctx)
    : '<div class="squisq-feature__media squisq-feature__media--empty"></div>';

  const textHtml = [headingHtml, ...featured.remaining.map((n) => nodeToHtml(n, ctx))]
    .filter((s) => s.length > 0)
    .join('\n');

  const sideClass = side === 'leftFeature' ? 'squisq-feature--left' : 'squisq-feature--right';

  return `<section class="squisq-feature ${sideClass}">
${media}
<div class="squisq-feature__body">
${textHtml}
</div>
</section>`;
}

interface FeaturedImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

function renderFeatureImage(img: FeaturedImage, ctx: RenderCtx | undefined): string {
  const resolved = ctx?.images?.get(img.src) ?? img.src;
  const attrs = [`src="${escapeAttr(resolved)}"`, `alt="${escapeAttr(img.alt)}"`];
  // Emit `width` / `height` attributes only when the source HTML had
  // them. The CSS rules then know to honor those values rather than
  // stretching the image to fill the column.
  if (typeof img.width === 'number') attrs.push(`width="${img.width}"`);
  if (typeof img.height === 'number') attrs.push(`height="${img.height}"`);
  const sizedClass =
    typeof img.width === 'number' || typeof img.height === 'number'
      ? ' squisq-feature__media--sized'
      : '';
  return `<div class="squisq-feature__media${sizedClass}"><img ${attrs.join(' ')} /></div>`;
}

/**
 * Pull the first image reference out of a section's body — either a
 * markdown `image` node (possibly nested inside a paragraph) or a raw
 * HTML `<img>` (the WYSIWYG editor emits these for resized images).
 * Returns the image plus the body with that image removed (so it's not
 * rendered a second time inside the text column).
 */
function takeFirstImage(nodes: MarkdownNode[]): {
  image: FeaturedImage | null;
  remaining: MarkdownNode[];
} {
  for (let i = 0; i < nodes.length; i++) {
    const found = extractFirstImageFromBlock(nodes[i]);
    if (!found) continue;
    const remaining = [...nodes];
    if (found.replacement === null) {
      remaining.splice(i, 1);
    } else {
      remaining[i] = found.replacement;
    }
    return { image: found.image, remaining };
  }
  return { image: null, remaining: nodes };
}

/**
 * Look for the first image inside a single block node. If the block is
 * a paragraph that contains only the image (with optional whitespace),
 * we drop the whole paragraph; if there's surrounding text, we strip
 * the image from the paragraph's inline children and keep the rest.
 * For raw `<img>` html blocks we drop the block entirely.
 */
function extractFirstImageFromBlock(
  block: MarkdownNode,
): { image: FeaturedImage; replacement: MarkdownNode | null } | null {
  if (!block || typeof block !== 'object') return null;
  const b = block as unknown as Record<string, unknown>;
  if (b.type === 'paragraph' && Array.isArray(b.children)) {
    const kids = b.children as MarkdownNode[];
    const imgIdx = kids.findIndex(
      (k) =>
        (k as { type?: string }).type === 'image' &&
        typeof (k as { url?: unknown }).url === 'string',
    );
    if (imgIdx >= 0) {
      const img = kids[imgIdx] as { url: string; alt?: string };
      const remainingKids = [...kids.slice(0, imgIdx), ...kids.slice(imgIdx + 1)].filter(
        (k) => !isBlankInline(k),
      );
      const replacement =
        remainingKids.length === 0
          ? null
          : ({ ...(b as object), children: remainingKids } as MarkdownNode);
      return {
        image: { src: img.url, alt: img.alt ?? '' },
        replacement,
      };
    }
  }
  if (b.type === 'htmlBlock' && Array.isArray(b.htmlChildren)) {
    const hit = findHtmlImg(b.htmlChildren as HtmlNode[]);
    if (hit) return { image: hit, replacement: null };
  }
  return null;
}

function isBlankInline(node: MarkdownNode): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: string; value?: unknown };
  return n.type === 'text' && typeof n.value === 'string' && n.value.trim().length === 0;
}

function findHtmlImg(nodes: HtmlNode[]): FeaturedImage | null {
  for (const n of nodes) {
    if (n.type !== 'htmlElement') continue;
    if (n.tagName.toLowerCase() === 'img') {
      const src = n.attributes.src;
      if (typeof src === 'string' && src) {
        return {
          src,
          alt: typeof n.attributes.alt === 'string' ? n.attributes.alt : '',
          width: parseHtmlDim(n.attributes.width),
          height: parseHtmlDim(n.attributes.height),
        };
      }
    }
    const nested = findHtmlImg(n.children);
    if (nested) return nested;
  }
  return null;
}

function parseHtmlDim(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const FEATURE_CSS = `  .squisq-feature {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5em;
    align-items: center;
    margin: 1.75em 0;
  }
  .squisq-feature--right { flex-direction: row-reverse; }
  .squisq-feature__media {
    flex: 0 0 42%;
    min-width: 0;
  }
  .squisq-feature__media--empty { display: none; }
  /* Default: image fills the media column. */
  .squisq-feature__media img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 6px;
  }
  /* "Sized" media: the image carried explicit width/height attrs (the
     WYSIWYG editor wrote them after a resize). Honor the attribute
     values and center the image inside the media column with padding. */
  .squisq-feature__media--sized {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1em;
    box-sizing: border-box;
  }
  /* Leave width and height untouched here -- the HTML attributes set
     the intrinsic dimensions, and CSS overrides would silently discard
     the author's sizing. max-width: 100% still keeps the image from
     overflowing the column on narrow viewports; HTML5 derives the
     aspect ratio from the width/height pair so the scale stays right. */
  .squisq-feature__media--sized img {
    max-width: 100%;
    display: block;
    border-radius: 6px;
  }
  .squisq-feature__body {
    flex: 1 1 0;
    min-width: 0;
  }
  .squisq-feature__body > :first-child { margin-top: 0; }
  .squisq-feature__body > :last-child { margin-bottom: 0; }
  @media (max-width: 600px) {
    .squisq-feature, .squisq-feature--right { flex-direction: column; }
    .squisq-feature__media { flex-basis: auto; width: 100%; }
  }`;

// ── Theme-driven CSS ───────────────────────────────────────────────

const DEFAULT_CSS = `  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; line-height: 1.6; color: #1f2937; }
  h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
  pre { background: #f3f4f6; padding: 1em; border-radius: 4px; overflow-x: auto; }
  code { background: #f3f4f6; padding: 0.15em 0.3em; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d1d5db; margin-left: 0; padding-left: 1em; color: #6b7280; }
  /* Images: cap at the container width so nothing overflows, but only
     force aspect-ratio height when the author didn't set explicit
     dimensions on the <img> tag. The WYSIWYG editor writes width/height
     attributes after a resize — overriding them here would silently
     ignore the user's sizing. */
  img { max-width: 100%; }
  img:not([width]):not([height]) { height: auto; }
  a { color: #3b82f6; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  hr { border: none; border-top: 1px solid #d1d5db; margin: 1.5em 0; }`;

/**
 * Build the stylesheet for a themed page. We resolve fonts and colors
 * to CSS-ready strings up front (rather than emitting `--squisq-*`
 * custom properties everywhere) so the output works in environments
 * that strip CSS variables.
 */
function renderThemedCss(theme: Theme): string {
  const bodyFamily = resolveFontFamily(theme.typography.bodyFont, 'system-ui, sans-serif');
  const titleFamily = resolveFontFamily(theme.typography.titleFont, 'Georgia, serif');
  const monoFamily = resolveFontFamily(theme.typography.monoFont, 'Consolas, monospace');
  const lineHeight = theme.typography.lineHeight ?? 1.6;
  const titleLineHeight = theme.typography.titleLineHeight ?? 1.25;
  const titleWeight = theme.typography.titleWeight === 'normal' ? 400 : 700;
  const c = theme.colors;
  // A few derived colors so the page doesn't end up unreadable on
  // themes that swing dark (most code/table chrome reads as "dim panel
  // on background"). We do this in CSS, not in JS, by mixing with
  // `color-mix` so older browsers without it still get a sensible look.
  return `  :root {
    --plain-bg: ${c.background};
    --plain-text: ${c.text};
    --plain-muted: ${c.textMuted};
    --plain-primary: ${c.primary};
    --plain-secondary: ${c.secondary};
    --plain-accent: ${c.highlight};
    --plain-bg-light: ${c.backgroundLight};
    --plain-body-font: ${bodyFamily};
    --plain-title-font: ${titleFamily};
    --plain-mono-font: ${monoFamily};
  }
  body {
    font-family: var(--plain-body-font);
    max-width: 800px;
    margin: 2em auto;
    padding: 0 1em;
    line-height: ${lineHeight};
    color: var(--plain-text);
    background: var(--plain-bg);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--plain-title-font);
    color: var(--plain-text);
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    line-height: ${titleLineHeight};
    font-weight: ${titleWeight};
  }
  p { margin: 0.75em 0; }
  pre {
    background: var(--plain-bg-light);
    padding: 1em;
    border-radius: 4px;
    overflow-x: auto;
    font-family: var(--plain-mono-font);
  }
  code {
    background: var(--plain-bg-light);
    padding: 0.15em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
    font-family: var(--plain-mono-font);
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid var(--plain-primary);
    margin-left: 0;
    padding-left: 1em;
    color: var(--plain-muted);
  }
  /* See DEFAULT_CSS comment: only auto-scale height when the author
     didn't set explicit width/height attributes. */
  img { max-width: 100%; }
  img:not([width]):not([height]) { height: auto; }
  a { color: var(--plain-primary); }
  a:hover { color: var(--plain-accent); }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td {
    border: 1px solid color-mix(in srgb, var(--plain-muted) 30%, transparent);
    padding: 6px 10px;
    text-align: left;
  }
  th {
    background: var(--plain-bg-light);
    color: var(--plain-text);
    font-family: var(--plain-title-font);
    font-weight: 600;
  }
  hr {
    border: none;
    border-top: 1px solid color-mix(in srgb, var(--plain-muted) 40%, transparent);
    margin: 1.5em 0;
  }`;
}

/**
 * Emit the `<link rel="stylesheet">` line(s) needed to load the theme's
 * fonts. Empty string when nothing in the theme is hosted on Google
 * Fonts (system stacks, custom self-hosted faces).
 */
function renderFontsLink(theme: Theme): string {
  const url = buildGoogleFontsUrl([
    theme.typography.bodyFont,
    theme.typography.titleFont,
    theme.typography.monoFont,
  ]);
  if (!url) return '';
  // Preconnect to Google's CDN to shave a roundtrip off the font load.
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${escapeAttr(url)}">
`;
}

// ── Node → HTML ────────────────────────────────────────────────────

function nodeToHtml(node: MarkdownNode | undefined | null, ctx?: RenderCtx): string {
  if (!node) return '';
  switch (node.type) {
    case 'heading': {
      const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
      return `<h${depth}>${childrenToHtml(node, ctx)}</h${depth}>`;
    }
    case 'paragraph':
      return `<p>${childrenToHtml(node, ctx)}</p>`;
    case 'text':
      return escapeHtml(node.value ?? '');
    case 'strong':
      return `<strong>${childrenToHtml(node, ctx)}</strong>`;
    case 'emphasis':
      return `<em>${childrenToHtml(node, ctx)}</em>`;
    case 'delete':
      return `<del>${childrenToHtml(node, ctx)}</del>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value ?? '')}</code>`;
    case 'code': {
      const lang = node.lang ? ` class="language-${escapeAttr(node.lang)}"` : '';
      return `<pre><code${lang}>${escapeHtml(node.value ?? '')}</code></pre>`;
    }
    case 'blockquote':
      return `<blockquote>${childrenToHtml(node, ctx)}</blockquote>`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const start =
        node.ordered && typeof node.start === 'number' && node.start !== 1
          ? ` start="${node.start}"`
          : '';
      return `<${tag}${start}>${childrenToHtml(node, ctx)}</${tag}>`;
    }
    case 'listItem':
      return `<li>${childrenToHtml(node, ctx)}</li>`;
    case 'link': {
      const original = node.url ?? '';
      const rewritten = ctx?.links?.get(original) ?? original;
      return `<a href="${escapeAttr(rewritten)}">${childrenToHtml(node, ctx)}</a>`;
    }
    case 'image': {
      const original = node.url ?? '';
      const resolved = ctx?.images?.get(original) ?? original;
      return `<img src="${escapeAttr(resolved)}" alt="${escapeAttr(node.alt ?? '')}" />`;
    }
    case 'thematicBreak':
      return '<hr />';
    case 'table':
      return tableToHtml(node, ctx);
    case 'inlineIcon': {
      // Render via FontAwesome's `fa-<family> fa-<name>` class pair.
      // The `<link>` to the FA CSS is injected into <head> by
      // `markdownDocToPlainHtml` when the doc contains any icon.
      const family = escapeAttr(node.family ?? 'solid');
      const name = escapeAttr(node.name ?? '');
      const token = escapeAttr(node.token ?? `${node.family}:${node.name}`);
      return `<i class="fa-${family} fa-${name}" data-icon="${token}" aria-hidden="true"></i>`;
    }
    case 'htmlBlock':
    case 'htmlInline':
      // Resized images and other authored HTML survive the round-trip
      // as parsed `htmlChildren` — rewriting `<img src>` through the
      // image map keeps the preview consistent with the markdown-image
      // path. Other tags pass through unmodified.
      return htmlChildrenToHtml(node.htmlChildren, ctx);
    default: {
      // Unknown / unhandled node — recurse into children if any so we
      // don't drop content (e.g. directives, footnotes).
      const withChildren = node as { children?: unknown; value?: unknown };
      if (Array.isArray(withChildren.children)) {
        return childrenToHtml(node as { children: MarkdownNode[] }, ctx);
      }
      if (typeof withChildren.value === 'string') {
        return escapeHtml(withChildren.value);
      }
      return '';
    }
  }
}

function childrenToHtml(
  node: { children?: MarkdownNode[]; value?: string },
  ctx?: RenderCtx,
): string {
  if (!node.children) return node.value ? escapeHtml(node.value) : '';
  return node.children.map((child) => nodeToHtml(child, ctx)).join('');
}

function tableToHtml(
  node: { children: { children: { children: MarkdownNode[]; isHeader?: boolean }[] }[] },
  ctx?: RenderCtx,
): string {
  const [headerRow, ...bodyRows] = node.children;
  const parts: string[] = ['<table>'];
  if (headerRow) {
    parts.push('<thead><tr>');
    for (const cell of headerRow.children) {
      parts.push(`<th>${childrenToHtml(cell, ctx)}</th>`);
    }
    parts.push('</tr></thead>');
  }
  if (bodyRows.length > 0) {
    parts.push('<tbody>');
    for (const row of bodyRows) {
      parts.push('<tr>');
      for (const cell of row.children) {
        parts.push(`<td>${childrenToHtml(cell, ctx)}</td>`);
      }
      parts.push('</tr>');
    }
    parts.push('</tbody>');
  }
  parts.push('</table>');
  return parts.join('');
}

function htmlChildrenToHtml(nodes: HtmlNode[] | undefined, ctx?: RenderCtx): string {
  if (!nodes || nodes.length === 0) return '';
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'htmlText') {
      // HtmlText already represents authored HTML — emit verbatim so
      // entity references the user wrote (e.g. `&amp;`) survive.
      out.push(node.value);
      continue;
    }
    if (node.type === 'htmlComment') {
      out.push(`<!--${node.value}-->`);
      continue;
    }
    // htmlElement
    const tag = node.tagName.toLowerCase();
    const attrs = { ...node.attributes };
    if (tag === 'img' && typeof attrs.src === 'string') {
      attrs.src = ctx?.images?.get(attrs.src) ?? attrs.src;
    }
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('');
    if (node.selfClosing) {
      out.push(`<${tag}${attrStr} />`);
    } else {
      out.push(`<${tag}${attrStr}>${htmlChildrenToHtml(node.children, ctx)}</${tag}>`);
    }
  }
  return out.join('');
}

// ── Escaping ───────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
