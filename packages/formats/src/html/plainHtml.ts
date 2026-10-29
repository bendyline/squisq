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

import {
  findBlockVideoEmbed,
  isSvgIslandLang,
  mediaKindForUrl,
  parseSvgIsland,
  parseTimeSeconds,
  sanitizeHtmlNodes,
  svgIslandDataUrl,
  svgSourceFromDataUrl,
  sanitizeUrl,
  videoEmbedFromIframe,
  videoEmbedIframeAttributes,
  type HtmlPolicy,
  type MarkdownDocument,
  type MarkdownNode,
  type HtmlNode,
  type MarkdownBlockNode,
  type MarkdownImage,
  type VideoEmbed,
  readFrontmatterThemeId,
} from '@bendyline/squisq/markdown';
import type { Theme, ThemeRegistry } from '@bendyline/squisq/schemas';
import { resolveFontFamily, buildGoogleFontsUrl } from '@bendyline/squisq/schemas';
import {
  isMediaAnnotationName,
  parseStandaloneAnnotation,
  resolveThemeForDoc,
} from '@bendyline/squisq/doc';
import { withoutBlockTags } from '../shared/blockTags.js';
import { FootnoteIndex, footnoteIds } from '../shared/footnotes.js';
import { imageSizeAttributes } from '../shared/images.js';

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
  /** Explicit caller-owned registry for non-document custom themes. */
  themeRegistry?: ThemeRegistry;
  /**
   * Optional FontAwesome CSS text to inline into the rendered page,
   * replacing the default cross-origin `<link>` to cdnjs. Required for
   * sandboxed iframe previews where tracking prevention or stricter
   * origin policies can silently drop cross-origin font fetches —
   * inlining keeps the icons resolvable purely from same-origin
   * resources. Hosts typically gather this string by scraping
   * `document.styleSheets` for `@font-face` rules whose family starts
   * with `"Font Awesome"`. A CDN `<link>` is emitted only when this option
   * is absent and {@link externalResources} is explicitly `allow`.
   */
  iconsCss?: string;
  /**
   * Whether this exporter may add remote font/icon stylesheets. Defaults to
   * `deny`, keeping the generated file self-contained. Authored links and
   * images are unaffected; bundle exporters are responsible for inlining or
   * rewriting those document resources.
   */
  externalResources?: 'deny' | 'allow';
  /**
   * Raw HTML policy. Defaults to `sanitize`, which removes unsafe tags,
   * event handlers, and executable URL schemes before emitting HTML.
   */
  htmlPolicy?: HtmlPolicy;
  /**
   * How a hosted video (a paragraph that is only a link to a YouTube, Vimeo,
   * Loom or Wistia page, or that provider's `<iframe>` embed
   * code) renders:
   *
   * - `player` (default) — the provider's player iframe;
   * - `poster` — a static card linking to the video's page (the provider's
   *   thumbnail where it serves one). For contexts where a player cannot run:
   *   a preview iframe sandboxed without `allow-scripts` (nested frames
   *   inherit the sandbox, so the player would load broken), or print.
   */
  videoEmbeds?: 'player' | 'poster';
  /**
   * Inline icons as SVG, keyed `family:name` (`solid:star`) — the `icons` that
   * `prepareMarkdownDocForPlainHtml` returns. An icon found here is drawn as
   * an inline `<svg>` in the text color and needs no Font Awesome stylesheet;
   * any other icon keeps its Font Awesome markup (see {@link iconsCss}).
   */
  icons?: ReadonlyMap<string, PlainHtmlIcon>;
}

/** One icon's outline: an SVG path in a `0 0 width height` box whose height is 1em. */
export interface PlainHtmlIcon {
  width: number;
  height: number;
  path: string;
}

/**
 * Internal render context — bundles the substitution maps so adding a
 * new one (e.g. `links`) doesn't require threading another parameter
 * through every node renderer.
 */
interface RenderCtx {
  images?: Map<string, string>;
  links?: Map<string, string>;
  htmlPolicy: HtmlPolicy;
  videoEmbeds?: 'player' | 'poster';
  icons?: ReadonlyMap<string, PlainHtmlIcon>;
  /** Set once an icon is drawn as SVG, so its CSS ships. */
  usesSvgIcons?: boolean;
  /** Set once an icon needs Font Awesome's own stylesheet. */
  usesFontIcons?: boolean;
  /** The theme's text color, which an SVG island's `currentColor` follows. */
  textColor?: string;
  /**
   * Footnote numbering for the document being rendered. Undefined for the
   * fragment helpers that render a node with no document around it — a
   * reference then falls back to printing its identifier rather than a number.
   */
  footnotes?: FootnoteIndex;
  /** Set once an audio or video player is emitted, so its CSS ships. */
  usesMediaPlayers?: boolean;
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
  const { title, body, fontsLink, iconsLink, themedCss, featureCss } = renderPlainHtml(
    doc,
    options,
  );
  // A <style> element is an HTML raw-text context: `</style>` closes it even
  // when those bytes occur inside a quoted CSS value. Escape every literal
  // less-than sign as a CSS code point so caller-owned theme values cannot
  // break back into HTML. This is a final output-boundary defense in addition
  // to theme validation and font-family quoting.
  const safeCss = escapeStyleText(`${themedCss}\n${featureCss}`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${fontsLink}${iconsLink}<style>
${safeCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * The pieces of a plain HTML page that belong to the document itself, for a
 * host that places the document inside a page of its own (see
 * `applyHtmlPageTemplate`).
 */
export interface PlainHtmlParts {
  /** The `title` option, unescaped. */
  title: string;
  /** The rendered document body, footnotes included. */
  bodyHtml: string;
  /**
   * `<head>` markup for the CSS the body's own constructs need — feature
   * sections, video embeds, SVG islands, icons — and nothing that styles the
   * page around them: no theme typography, colors, fonts, or `body` rules.
   */
  featureHeadHtml: string;
}

/**
 * Render a document's body and the functional CSS it depends on, without the
 * page shell or theme stylesheet `markdownDocToPlainHtml` wraps around them.
 * The theme (when one resolves) still informs body rendering, such as the
 * color an SVG island's `currentColor` follows.
 */
export function markdownDocToPlainHtmlParts(
  doc: MarkdownDocument,
  options: PlainHtmlExportOptions = {},
): PlainHtmlParts {
  const { title, body, iconsLink, featureCss } = renderPlainHtml(doc, options);
  return {
    title,
    bodyHtml: body,
    featureHeadHtml: `${iconsLink}<style data-squisq>\n${escapeStyleText(featureCss)}\n</style>\n`,
  };
}

interface RenderedPlainHtml {
  title: string;
  body: string;
  fontsLink: string;
  iconsLink: string;
  /** Theme (or default) page CSS, unescaped. */
  themedCss: string;
  /** CSS for the document's own constructs, unescaped. */
  featureCss: string;
}

function renderPlainHtml(
  doc: MarkdownDocument,
  options: PlainHtmlExportOptions,
): RenderedPlainHtml {
  const {
    title = 'Document',
    images,
    links,
    themeId,
    iconsCss,
    htmlPolicy = 'sanitize',
    externalResources = 'deny',
    videoEmbeds,
    icons,
  } = options;
  // Fall back chain for theme: explicit `theme` → explicit `themeId`
  // option → doc frontmatter `themeId`. Hosts whose export dialog
  // tracks themes by id can pass `themeId` straight through; authored
  // docs with `themeId: warm-earth` in frontmatter get styled
  // automatically when neither is supplied.
  // Resolution is doc-scoped via `resolveThemeForDoc`, so an inline
  // `squisq-custom-themes` id resolves here with no global registration —
  // and `readFrontmatterThemeId` picks up the editor's canonical
  // `squisq-theme` key. Stays undefined when nothing selects a theme so
  // un-themed exports render unstyled (unchanged behavior).
  const resolveId = themeId ?? readFrontmatterThemeId(doc.frontmatter);
  const theme =
    options.theme ??
    (resolveId ? resolveThemeForDoc(doc, resolveId, options.themeRegistry) : undefined);
  const footnotes = new FootnoteIndex(doc);
  const ctx: RenderCtx = {
    images,
    links,
    htmlPolicy,
    footnotes,
    videoEmbeds,
    icons,
    textColor: theme?.colors.text,
  };
  // Block tags type content for the player; on a page they would print as
  // prose. Media tags stay: each becomes its file's player.
  const blocks = withoutBlockTags(doc, { keepMedia: true }).children;
  const body = renderTopLevel(blocks, ctx) + renderFootnotesSection(footnotes, ctx);
  const fontsLink = theme && externalResources === 'allow' ? renderFontsLink(theme) : '';
  // Resolve how to load FontAwesome — only when an icon was drawn with it
  // rather than as SVG. When the host supplies `iconsCss` (typical for
  // sandboxed iframe previews where cross-origin font fetches get blocked),
  // we inline it as a `<style>` block; otherwise we fall back to the
  // public cdnjs `<link>` after an external-resource opt-in.
  let iconsLink = '';
  if (ctx.usesFontIcons) {
    iconsLink = iconsCss
      ? `<style data-fa-inline>\n${escapeStyleText(iconsCss)}\n</style>\n`
      : externalResources === 'allow'
        ? FONT_AWESOME_LINK
        : '';
  }
  const themedCss = theme ? renderThemedCss(theme) : DEFAULT_CSS;
  const videoCss = docUsesVideoEmbeds(doc, htmlPolicy) ? `\n${VIDEO_EMBED_CSS}` : '';
  const svgCss = docUsesSvgIslands(doc) ? `\n${SVG_ISLAND_CSS}` : '';
  const mediaCss = ctx.usesMediaPlayers ? `\n${MEDIA_PLAYER_CSS}` : '';
  const iconCss = ctx.usesSvgIcons ? `\n${SVG_ICON_CSS}` : '';
  return {
    title,
    body,
    fontsLink,
    iconsLink,
    themedCss,
    featureCss: `${FEATURE_CSS}${videoCss}${svgCss}${mediaCss}${iconCss}`,
  };
}

function escapeStyleText(css: string): string {
  return css.replace(/</g, '\\3c ');
}

/**
 * Hosted FontAwesome Free CSS. Pinned to the same release as the editor's
 * local icon catalog and emitted only after an explicit external-resource opt-in.
 */
const FONT_AWESOME_LINK = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.3.1/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
`;

/** An icon drawn as SVG sits on the text like a glyph of the font would. */
const SVG_ICON_CSS = `  .squisq-icon { display: inline-block; height: 1em; vertical-align: -0.125em; overflow: visible; }`;

/**
 * Whether anything renders as a video player or poster — a top-level video
 * paragraph, or a provider `<iframe>` in raw HTML — so a document without
 * one ships none of its CSS.
 */
function docUsesVideoEmbeds(doc: MarkdownDocument, htmlPolicy: HtmlPolicy): boolean {
  const iframeIn = (nodes: readonly HtmlNode[]): boolean =>
    nodes.some(
      (node) =>
        node.type === 'htmlElement' &&
        (videoEmbedFromIframe(node) !== null || iframeIn(node.children)),
    );
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    const n = node as { type?: string; htmlChildren?: HtmlNode[]; children?: unknown[] };
    if (htmlPolicy !== 'strip' && Array.isArray(n.htmlChildren) && iframeIn(n.htmlChildren)) {
      return true;
    }
    return Array.isArray(n.children) && n.children.some(visit);
  };
  return doc.children.some(
    (node) => (node.type === 'paragraph' && findBlockVideoEmbed(node) !== null) || visit(node),
  );
}

/** Whether any ```svg fence, at any depth, is in the document. */
function docUsesSvgIslands(doc: MarkdownDocument): boolean {
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    const n = node as { type?: string; lang?: string | null; children?: unknown[] };
    if (n.type === 'code') return isSvgIslandLang(n.lang);
    return Array.isArray(n.children) && n.children.some(visit);
  };
  return visit(doc);
}

// ── Top-level walk with feature-section grouping ───────────────────

/**
 * Walk the document's top-level children, grouping headings that carry
 * a `leftFeature` / `rightFeature` template annotation with the body
 * blocks that follow them (up to the next sibling-or-higher heading).
 * Each group renders as a single `<section class="squisq-feature ...">`
 * with a media column and a text column — the plain-HTML analogue of
 * the SVG layer layout produced by `materializeBlockLayers` for the same templates.
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
    const html = topLevelBlockToHtml(node as MarkdownNode, ctx);
    if (html !== null) out.push(html);
  }
  return out.join('\n');
}

/**
 * A top-level block. Only at the top level is a paragraph that is nothing but
 * a link to a video page a player, or a paragraph that is nothing but an
 * `{[audio …]}` / `{[video …]}` tag a clip; inside a list or blockquote both
 * stay text. Null when the block renders as nothing.
 */
function topLevelBlockToHtml(node: MarkdownNode, ctx: RenderCtx | undefined): string | null {
  if (node?.type !== 'paragraph') return nodeToHtml(node, ctx);
  const video = findBlockVideoEmbed(node as MarkdownBlockNode);
  if (video) return videoEmbedToHtml(video.embed, video.title, ctx);
  // `{[audio src=…]}` schedules a clip on the player's timeline; a static
  // page has no timeline, so it gets the clip's own player instead.
  const tag = parseStandaloneAnnotation(node as MarkdownBlockNode);
  if (tag?.template && isMediaAnnotationName(tag.template)) {
    return mediaAnnotationToHtml(tag.template, tag.params, ctx);
  }
  return nodeToHtml(node, ctx);
}

/**
 * The document's footnotes as a trailing `<section>`, numbered in reference
 * order, each with a backlink to the marker that cites it.
 *
 * Definitions are pulled OUT of the document flow (`nodeToHtml` renders them as
 * nothing) because a GFM definition sits wherever the author wrote it, which is
 * rarely where a reader wants to read it.
 */
function renderFootnotesSection(footnotes: FootnoteIndex, ctx: RenderCtx): string {
  if (footnotes.isEmpty) return '';
  const items = footnotes.ordered().map((fn) => {
    const { def } = footnoteIds(fn.identifier);
    const body = fn.definition
      ? childrenToHtml(fn.definition as unknown as { children: MarkdownNode[] }, ctx)
      : '';
    // One backlink per citation, so a footnote cited three times can return the
    // reader to any of the three places that cited it.
    const backlinks = Array.from({ length: Math.max(fn.citations, 1) }, (_unused, i) => {
      const { ref } = footnoteIds(fn.identifier, i + 1);
      const label = fn.citations > 1 ? `↩${String.fromCharCode(0xfe0e)}${i + 1}` : '↩';
      return (
        `<a href="#${escapeAttr(ref)}" class="squisq-footnote-backref"` +
        ` aria-label="Back to reference ${fn.number}">${label}</a>`
      );
    }).join(' ');
    return `<li id="${escapeAttr(def)}">${body}${backlinks}</li>`;
  });
  const lines = [
    '',
    '<section class="squisq-footnotes" data-footnotes><hr>',
    '<ol>',
    ...items,
    '</ol>',
    '</section>',
  ];
  return lines.join('\n');
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

  const textHtml = [headingHtml, ...featured.remaining.map((n) => topLevelBlockToHtml(n, ctx))]
    .filter((s): s is string => !!s)
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
  const safeSrc = sanitizeUrl(resolved, 'media');
  if (!safeSrc) return '<div class="squisq-feature__media squisq-feature__media--empty"></div>';
  const attrs = [`src="${escapeAttr(safeSrc)}"`, `alt="${escapeAttr(img.alt)}"`];
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
 * For an `<img>` that stays raw HTML (one with a class or style) we drop
 * the block entirely.
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
      const img = kids[imgIdx] as MarkdownImage;
      const remainingKids = [...kids.slice(0, imgIdx), ...kids.slice(imgIdx + 1)].filter(
        (k) => !isBlankInline(k),
      );
      const replacement =
        remainingKids.length === 0
          ? null
          : ({ ...(b as object), children: remainingKids } as MarkdownNode);
      return {
        // A resized image parses with the size it was given in the editor.
        image: { src: img.url, alt: img.alt ?? '', width: img.width, height: img.height },
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

// The unthemed page sets its text colour, so it must set the background
// that colour was chosen against as well (WCAG failure F24). Relying on the
// browser's default canvas breaks wherever the page is embedded or viewed with
// a dark default: dark text on a dark background.
const DEFAULT_CSS = `  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 2em auto; padding: 0 1em; line-height: 1.6; color: #1f2937; background: #fff; }
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
  /* Blend the theme primary toward the body text color so links stay
     theme-flavored but read clearly on every theme's background — some
     themes (e.g. Gezellig) pick a mid-tone primary that's almost
     invisible on a dark page when used neat. Underline makes the link
     unambiguous independent of the color contrast. */
  a {
    color: color-mix(in srgb, var(--plain-primary) 65%, var(--plain-text));
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
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
    case 'superscript':
      return `<sup>${childrenToHtml(node, ctx)}</sup>`;
    case 'footnoteReference': {
      if (!ctx?.footnotes) {
        // Fragment rendering with no document around it: there is no numbering
        // to consult and no definitions section to link to.
        return `<sup class="squisq-footnote-ref">${escapeHtml(node.label ?? node.identifier)}</sup>`;
      }
      const { number, occurrence } = ctx.footnotes.cite(node.identifier);
      const { ref, def } = footnoteIds(node.identifier, occurrence);
      return (
        `<sup class="squisq-footnote-ref">` +
        `<a href="#${escapeAttr(def)}" id="${escapeAttr(ref)}">${number}</a></sup>`
      );
    }
    case 'footnoteDefinition':
      // Rendered by `renderFootnotesSection` at the end of the document, in
      // reference order. Emitting it in place would put an unmarked paragraph
      // wherever the author happened to write the definition.
      return '';
    case 'subscript':
      return `<sub>${childrenToHtml(node, ctx)}</sub>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value ?? '')}</code>`;
    case 'code': {
      if (isSvgIslandLang(node.lang)) {
        const island = svgIslandToHtml(node.value ?? '', ctx);
        if (island) return island;
      }
      const lang = node.lang ? ` class="language-${escapeAttr(node.lang)}"` : '';
      return `<pre class="squisq-code-block"><code${lang}>${escapeHtml(node.value ?? '')}</code></pre>`;
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
      const safeHref = sanitizeUrl(rewritten, 'link');
      if (!safeHref) return childrenToHtml(node, ctx);
      return `<a href="${escapeAttr(safeHref)}">${childrenToHtml(node, ctx)}</a>`;
    }
    case 'image': {
      const original = node.url ?? '';
      const resolved = ctx?.images?.get(original) ?? original;
      // Image syntax is markdown's only embed, so `![A clip](clip.mp4)` plays
      // rather than drawing a broken picture (as MarkdownRenderer does).
      const mediaKind = mediaKindForUrl(original);
      if (mediaKind) {
        const label = node.alt || node.title || undefined;
        return mediaPlayerHtml(mediaKind, resolved, label, ctx) ?? escapeHtml(node.alt ?? '');
      }
      const safeSrc = sanitizeUrl(resolved, 'media') ?? svgDataImageToHtmlSrc(resolved);
      if (!safeSrc) return escapeHtml(node.alt ?? '');
      return `<img src="${escapeAttr(safeSrc)}" alt="${escapeAttr(node.alt ?? '')}"${imageSizeAttributes(node)} />`;
    }
    case 'thematicBreak':
      return '<hr />';
    case 'table':
      return tableToHtml(node, ctx);
    case 'inlineIcon': {
      const token = escapeAttr(node.token ?? `${node.family}:${node.name}`);
      const svg = ctx?.icons?.get(`${node.family}:${node.name}`);
      if (svg) {
        ctx!.usesSvgIcons = true;
        const width = Number((svg.width / svg.height).toFixed(4));
        return (
          `<svg class="squisq-icon" viewBox="0 0 ${svg.width} ${svg.height}" width="${width}em"` +
          ` height="1em" fill="currentColor" aria-hidden="true" focusable="false"` +
          ` data-icon="${token}"><path d="${escapeAttr(svg.path)}"/></svg>`
        );
      }
      // Render via FontAwesome's `fa-<family> fa-<name>` class pair; the
      // renderer adds the FA stylesheet it needs to <head>.
      if (ctx) ctx.usesFontIcons = true;
      const family = escapeAttr(node.family ?? 'solid');
      const name = escapeAttr(node.name ?? '');
      return `<i class="fa-${family} fa-${name}" data-icon="${token}" aria-hidden="true"></i>`;
    }
    case 'htmlBlock':
    case 'htmlInline': {
      if (resolveHtmlPolicy(ctx) === 'strip') return '';
      // Pasted provider embed code renders as the same player a link
      // paragraph gets, not the snippet's fixed-size iframe and wrappers.
      const video = node.type === 'htmlBlock' ? findBlockVideoEmbed(node) : null;
      if (video) return videoEmbedToHtml(video.embed, video.title, ctx);
      // Resized images and other authored HTML survive the round-trip
      // as parsed `htmlChildren` — rewriting `<img src>` through the
      // image map keeps the preview consistent with the markdown-image
      // path. Other tags pass through unmodified.
      return htmlChildrenToHtml(resolveHtmlNodes(node.htmlChildren, ctx), ctx);
    }
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

function resolveHtmlPolicy(ctx: RenderCtx | undefined): HtmlPolicy {
  return ctx?.htmlPolicy ?? 'sanitize';
}

function resolveHtmlNodes(nodes: HtmlNode[] | undefined, ctx: RenderCtx | undefined): HtmlNode[] {
  if (!nodes || nodes.length === 0) return [];
  return resolveHtmlPolicy(ctx) === 'trusted' ? nodes : sanitizeHtmlNodes(nodes);
}

function htmlChildrenToHtml(nodes: HtmlNode[] | undefined, ctx?: RenderCtx): string {
  if (!nodes || nodes.length === 0) return '';
  const trusted = resolveHtmlPolicy(ctx) === 'trusted';
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'htmlText') {
      // HtmlText already represents authored HTML — emit verbatim so
      // entity references the user wrote (e.g. `&amp;`) survive.
      out.push(trusted ? node.value : escapeHtml(node.value));
      continue;
    }
    if (node.type === 'htmlComment') {
      if (trusted) out.push(`<!--${node.value}-->`);
      continue;
    }
    // htmlElement
    const tag = node.tagName.toLowerCase();
    if (tag === 'iframe') {
      // A provider player nested in authored HTML; under `trusted` an
      // unrecognized iframe still passes through verbatim, as before.
      const video = videoEmbedFromIframe(node);
      if (video) {
        out.push(videoEmbedToHtml(video.embed, video.title, ctx, true));
        continue;
      }
    }
    const attrs = { ...node.attributes };
    // Route media `src` attrs through the export's `ctx.images` URL
    // map (which is actually a generic media map — see header comment).
    // Without this, raw <video>/<audio> tags inserted by the recorder
    // ship as relative paths that resolve against the export host, not
    // the original ContentContainer.
    if (
      (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'source') &&
      typeof attrs.src === 'string'
    ) {
      attrs.src = ctx?.images?.get(attrs.src) ?? attrs.src;
    }
    if ((tag === 'video' || tag === 'audio') && typeof attrs.poster === 'string') {
      attrs.poster = ctx?.images?.get(attrs.poster) ?? attrs.poster;
    }
    if (!trusted) {
      if (typeof attrs.src === 'string') {
        const safeSrc = sanitizeUrl(attrs.src, 'media');
        if (!safeSrc) delete attrs.src;
        else attrs.src = safeSrc;
      }
      if (typeof attrs.poster === 'string') {
        const safePoster = sanitizeUrl(attrs.poster, 'media');
        if (!safePoster) delete attrs.poster;
        else attrs.poster = safePoster;
      }
      if (typeof attrs.href === 'string') {
        const safeHref = sanitizeUrl(attrs.href, 'link');
        if (!safeHref) delete attrs.href;
        else attrs.href = safeHref;
      }
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

// ── Video embeds ───────────────────────────────────────────────────

/**
 * A hosted video as HTML: the provider's player, or (`videoEmbeds: 'poster'`)
 * a static card linking to its page. The iframe's attributes come from core's
 * `videoEmbedIframeAttributes` — the same set the React renderer and the
 * sanitizer emit. `inline` swaps the `<figure>` for spans, for a player nested
 * in authored HTML where a figure would close an enclosing `<p>`.
 */
function videoEmbedToHtml(
  embed: VideoEmbed,
  title: string | null,
  ctx: RenderCtx | undefined,
  inline = false,
): string {
  const root = inline ? 'span' : 'figure';
  const orientation = embed.aspectRatio < 1 ? 'portrait' : 'landscape';
  const ratio = `aspect-ratio: ${embed.aspectRatio < 1 ? '9 / 16' : '16 / 9'}`;
  const watchUrl = escapeAttr(embed.watchUrl);
  let frame: string;
  if (ctx?.videoEmbeds === 'poster') {
    const label = title
      ? `Watch \u201c${title}\u201d on ${embed.providerName}`
      : `Watch on ${embed.providerName}`;
    const thumbnail = embed.thumbnailUrl
      ? `<img src="${escapeAttr(embed.thumbnailUrl)}" alt="" loading="lazy" />`
      : '';
    frame =
      `<a class="squisq-video-embed-frame squisq-video-embed-poster" href="${watchUrl}"` +
      ` style="${ratio}" aria-label="${escapeAttr(label)}">${thumbnail}` +
      `<span class="squisq-video-embed-play" aria-hidden="true"></span>` +
      `<span class="squisq-video-embed-provider" aria-hidden="true">${escapeHtml(embed.providerName)}</span></a>`;
  } else {
    const attrs = Object.entries(videoEmbedIframeAttributes(embed, title))
      .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`))
      .join('');
    frame = `<span class="squisq-video-embed-frame" style="${ratio}"><iframe${attrs}></iframe></span>`;
  }
  const caption =
    title && !inline
      ? `<figcaption class="squisq-video-embed-caption"><a href="${watchUrl}">${escapeHtml(title)}</a></figcaption>`
      : '';
  return (
    `<${root} class="squisq-video-embed" data-provider="${embed.provider}"` +
    ` data-orientation="${orientation}">${frame}${caption}</${root}>`
  );
}

/** Player / poster layout. Colors are fixed: a video frame is always dark. */
const VIDEO_EMBED_CSS = `  .squisq-video-embed { display: block; max-width: 720px; margin: 1.25em 0; }
  .squisq-video-embed[data-orientation="portrait"] { max-width: 340px; }
  .squisq-video-embed-frame { position: relative; display: block; overflow: hidden; border-radius: 6px; background: #000; }
  .squisq-video-embed-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .squisq-video-embed-poster img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .squisq-video-embed-play { position: absolute; left: 50%; top: 50%; width: 64px; height: 44px; margin: -22px 0 0 -32px; border-radius: 12px; background: rgba(0, 0, 0, 0.72); }
  .squisq-video-embed-play::after { content: ''; position: absolute; left: 26px; top: 12px; border-style: solid; border-width: 10px 0 10px 16px; border-color: transparent transparent transparent #fff; }
  .squisq-video-embed-provider { position: absolute; left: 12px; bottom: 10px; color: #fff; font-size: 0.8em; font-weight: 600; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8); }
  .squisq-video-embed-caption { margin-top: 0.4em; font-size: 0.875em; opacity: 0.8; }`;

// ── Audio and video files ──────────────────────────────────────────

/** A native player for a media file, or null when its URL is not safe to load. */
function mediaPlayerHtml(
  kind: 'audio' | 'video',
  src: string,
  label: string | undefined,
  ctx: RenderCtx | undefined,
): string | null {
  const safeSrc = sanitizeUrl(src, 'media');
  if (!safeSrc) return null;
  if (ctx) ctx.usesMediaPlayers = true;
  const aria = label ? ` aria-label="${escapeAttr(label)}"` : '';
  return `<${kind} class="squisq-media" src="${escapeAttr(safeSrc)}" controls preload="metadata"${aria}></${kind}>`;
}

/**
 * A standalone `{[audio …]}` / `{[video …]}` tag as its file's player, its
 * `clipStart`/`clipEnd` window kept as a media fragment. Null — the tag
 * renders as nothing — when it names no playable file.
 */
function mediaAnnotationToHtml(
  template: string,
  params: Record<string, string>,
  ctx: RenderCtx | undefined,
): string | null {
  if (!params.src) return null;
  // The same rule `markdownToDoc` applies: only `video` is a video clip.
  const kind = template === 'video' ? 'video' : 'audio';
  let src = ctx?.images?.get(params.src) ?? params.src;
  const start = parseTimeSeconds(params.clipStart ?? '');
  const end = parseTimeSeconds(params.clipEnd ?? '');
  if ((start !== null || end !== null) && !src.includes('#')) {
    src += `#t=${start ?? ''}${end !== null ? `,${end}` : ''}`;
  }
  const player = mediaPlayerHtml(kind, src, undefined, ctx);
  return player ? `<figure class="squisq-media-clip">${player}</figure>` : null;
}

/** Players fill the column; a video never overflows it. */
const MEDIA_PLAYER_CSS = `  .squisq-media-clip { margin: 1.25em 0; }
  video.squisq-media { display: block; width: 100%; max-width: 720px; height: auto; border-radius: 6px; }
  audio.squisq-media { display: block; width: 100%; max-width: 480px; }`;

/**
 * An SVG image inlined as a `data:` URL (an attachment, in a single-file
 * export): core's sanitized re-serialization of it, or null — show the alt
 * text — when it is not a usable SVG.
 */
function svgDataImageToHtmlSrc(url: string): string | null {
  const source = svgSourceFromDataUrl(url);
  const result = source === null ? null : parseSvgIsland(source);
  return result?.ok ? svgIslandDataUrl(result.island) : null;
}

/**
 * A ```svg fence as a picture: core's sanitized re-serialization as a data
 * URL in an `<img>` — never the author's markup inline. Null (render the
 * fence as code) when the markup is not a usable island.
 */
function svgIslandToHtml(source: string, ctx: RenderCtx | undefined): string | null {
  const result = parseSvgIsland(source);
  if (!result.ok) return null;
  const { island } = result;
  const src = svgIslandDataUrl(island, { color: ctx?.textColor });
  return (
    `<figure class="squisq-svg-island"><img src="${escapeAttr(src)}"` +
    ` alt="${escapeAttr(island.title ?? 'Illustration')}"` +
    ` width="${island.width}" height="${island.height}"></figure>`
  );
}

/** Intrinsic size, never wider than the column. */
const SVG_ISLAND_CSS = `  .squisq-svg-island { margin: 1.25em 0; }
  .squisq-svg-island img { display: block; max-width: 100%; height: auto; }`;

// ── Escaping ───────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
