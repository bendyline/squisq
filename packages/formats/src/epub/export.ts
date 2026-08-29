/**
 * EPUB 3 Export
 *
 * Converts a MarkdownDocument (or Doc) to an EPUB 3 file (.epub).
 *
 * An EPUB is a ZIP archive containing XHTML chapter files, images,
 * a package manifest (content.opf), and a navigation document (toc.xhtml).
 * Content is split into chapters at H1/H2 heading boundaries.
 *
 * Uses JSZip for packaging (already a dependency), escapeXml from the
 * OOXML utils, and image utilities from the HTML exporter.
 *
 * @example
 * ```ts
 * import { markdownDocToEpub } from '@bendyline/squisq-formats/epub';
 *
 * const epub = await markdownDocToEpub(markdownDoc, {
 *   title: 'My Book',
 *   author: 'Jane Doe',
 * });
 * ```
 */

import JSZip from 'jszip';
import type { Doc, AudioSegment, ThemeRegistry } from '@bendyline/squisq/schemas';
import { resolveFontFamily } from '@bendyline/squisq/schemas';
import { resolveThemeForDoc } from '@bendyline/squisq/doc';
import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownHeading,
  MarkdownParagraph,
  MarkdownListItem,
  MarkdownTable,
  MarkdownTableRow,
  MarkdownTableCell,
  MarkdownInlineIcon,
} from '@bendyline/squisq/markdown';
import { readFrontmatterThemeId, sanitizeUrl } from '@bendyline/squisq/markdown';
import { FootnoteIndex, footnoteIds } from '../shared/footnotes.js';
import { escapeXml } from '../ooxml/xmlUtils.js';
import { inferMimeType, extractFilename } from '../html/imageUtils.js';
import { extractPlainText } from '../shared/text.js';
import {
  collectInlineIconFamilies,
  fontAwesomeFaces,
  fontAwesomeGlyph,
  type FontAwesomeFontFace,
} from '../shared/fontAwesome.js';

// ── Public API ────────────────────────────────────────────────────

export interface EpubExportOptions {
  /** Cancel at bounded export checkpoints. */
  signal?: AbortSignal;
  /** Book title (default: 'Untitled') */
  title?: string;
  /** Author name */
  author?: string;
  /** Book description / summary */
  description?: string;
  /** BCP-47 language code (default: 'en') */
  language?: string;
  /** Publisher name */
  publisher?: string;
  /** Squisq theme ID for CSS styling */
  themeId?: string;
  /** Explicit caller-owned registry for non-document custom themes. */
  themeRegistry?: ThemeRegistry;
  /** Pre-resolved image data keyed by relative path as it appears in the markdown */
  images?: Map<string, ArrayBuffer>;
  /** Cover image data (JPEG or PNG) */
  coverImage?: ArrayBuffer;
  /**
   * Audio narration data keyed by segment src/name.
   * When provided alongside audioSegments, EPUB 3 Media Overlays (SMIL)
   * are generated for synchronized audio playback.
   */
  audio?: Map<string, ArrayBuffer>;
  /**
   * Audio segment metadata (from Doc.audio.segments).
   * Required together with `audio` to generate Media Overlays.
   * Each segment's duration and startTime are used to build SMIL timing.
   */
  audioSegments?: AudioSegment[];
  /** Total document duration in seconds (used for Media Overlay metadata) */
  totalDuration?: number;
}

/**
 * Convert a MarkdownDocument to an EPUB 3 file.
 *
 * Chapters are split at H1/H2 heading boundaries. All referenced images
 * (provided via `options.images`) are embedded in the archive.
 */
export async function markdownDocToEpub(
  doc: MarkdownDocument,
  options: EpubExportOptions = {},
): Promise<ArrayBuffer> {
  options.signal?.throwIfAborted();
  const fmTitle = doc.frontmatter?.title;
  const fmAuthor = doc.frontmatter?.author;
  const title = options.title ?? (typeof fmTitle === 'string' ? fmTitle : 'Untitled');
  const author = options.author ?? (typeof fmAuthor === 'string' ? fmAuthor : '');
  const language = options.language ?? 'en';
  const description = options.description ?? '';
  const publisher = options.publisher ?? '';
  const uuid = createEpubUuid();
  const embeddedIconFonts = fontAwesomeFaces(collectInlineIconFamilies(doc));

  // Split document into chapters
  const chapters = splitIntoChapters(doc.children);
  // One index for the whole book: footnote numbers must not restart per chapter,
  // and a definition often sits in a different chapter from its citation.
  const footnoteIndex = new FootnoteIndex(doc);
  const citedAnywhere = new Set<string>();
  collectCitedIdentifiers(doc.children, citedAnywhere);
  const uncitedFootnotes = footnoteIndex
    .ordered()
    .filter((fn) => fn.definition && !citedAnywhere.has(fn.identifier))
    .map((fn) => fn.identifier);

  // Collect images referenced in the document, deduplicating filenames
  const imageEntries = collectDocImages(doc.children);
  const resolvedImages = new Map<string, { data: ArrayBuffer; mime: string; filename: string }>();
  const usedImageNames = new Set<string>();
  if (options.images) {
    let imageIndex = 0;
    for (const src of imageEntries) {
      if ((imageIndex++ & 63) === 0) options.signal?.throwIfAborted();
      const data = options.images.get(src);
      if (data) {
        const filename = uniqueFilename(safeArchiveBasename(src, 'image'), usedImageNames);
        usedImageNames.add(filename);
        resolvedImages.set(src, { data, mime: inferMimeType(filename), filename });
      }
    }
  }

  // Generate theme CSS — honor an explicit themeId, else the doc's frontmatter
  // theme (`squisq-theme` / legacy), mirroring the other export formats.
  const css = generateStylesheet(
    options.themeId ?? readFrontmatterThemeId(doc.frontmatter),
    doc,
    options.themeRegistry,
    embeddedIconFonts,
  );

  // Build the ZIP
  const zip = new JSZip();

  // mimetype must be first entry, stored (not compressed)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.file('META-INF/container.xml', CONTAINER_XML);

  // OEBPS/styles.css
  zip.file('OEBPS/styles.css', css);

  // OEBPS/fonts/* — only the Font Awesome faces used by this book.
  for (const face of embeddedIconFonts) {
    zip.file(`OEBPS/fonts/${face.fileStem}.otf`, face.data);
  }

  // OEBPS/images/*
  for (const [, img] of resolvedImages) {
    options.signal?.throwIfAborted();
    zip.file(`OEBPS/images/${img.filename}`, img.data);
  }

  // Cover image — detect PNG vs JPEG from magic bytes.
  // When provided, generates a cover.xhtml page in the spine so e-readers
  // (especially Kindle) display the cover as both thumbnail and first page.
  let coverFilename: string | undefined;
  if (options.coverImage) {
    const bytes = new Uint8Array(options.coverImage);
    const isPng =
      bytes.length >= 4 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47;
    coverFilename = uniqueFilename(isPng ? 'cover.png' : 'cover.jpg', usedImageNames);
    usedImageNames.add(coverFilename);
    zip.file(`OEBPS/images/${coverFilename}`, options.coverImage);

    // Generate cover XHTML page — full-bleed image, no margins
    const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>Cover</title>
  <style>
    body { margin: 0; padding: 0; text-align: center; }
    img { max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>
  <img src="../images/${escapeXml(coverFilename)}" alt="Cover"/>
</body>
</html>`;
    zip.file('OEBPS/chapters/cover.xhtml', coverXhtml);
  }

  // ── Audio narration ──────────────────────────────────────────────
  const audioMap = options.audio;
  const audioSegments = options.audioSegments;
  const hasAudio = audioMap && audioSegments && audioSegments.length > 0;
  // Per-segment audio file info, indexed by segment index (null if data missing)
  const segmentAudioFiles: ({ filename: string; mime: string } | null)[] = [];
  const allAudioFiles: { filename: string; mime: string }[] = [];
  const audioFilenameBySource = new Map<string, string>();
  const usedAudioFilenames = new Set<string>();

  if (hasAudio) {
    for (const seg of audioSegments) {
      const data = audioMap.get(seg.src) ?? audioMap.get(seg.name);
      if (data) {
        const sourceKey = seg.src || seg.name;
        let finalName = audioFilenameBySource.get(sourceKey);
        let isNewFile = false;
        if (!finalName) {
          const basename = safeArchiveBasename(sourceKey || 'narration', 'narration');
          const withExtension = basename.includes('.') ? basename : `${basename}.mp3`;
          finalName = uniqueFilename(withExtension, usedAudioFilenames);
          audioFilenameBySource.set(sourceKey, finalName);
          usedAudioFilenames.add(finalName);
          zip.file(`OEBPS/audio/${finalName}`, data);
          isNewFile = true;
        }
        const info = { filename: finalName, mime: inferMimeType(finalName) };
        segmentAudioFiles.push(info);
        if (isNewFile) allAudioFiles.push(info);
      } else {
        segmentAudioFiles.push(null);
      }
    }
  }

  // Build chapter-to-audio mapping for SMIL overlays
  const chapterAudio: (ChapterAudioInfo | null)[] = [];
  if (hasAudio && allAudioFiles.length > 0) {
    if (chapters.length !== audioSegments.length) {
      console.warn(
        `EPUB: ${chapters.length} chapters but ${audioSegments.length} audio segments — ` +
          `extra chapters will reuse the last segment's audio`,
      );
    }
    for (let i = 0; i < chapters.length; i++) {
      const segIdx = Math.min(i, audioSegments.length - 1);
      const seg = audioSegments[segIdx];
      const audioFile = segmentAudioFiles[segIdx];
      if (audioFile) {
        chapterAudio.push({
          audioFilename: audioFile.filename,
          clipStart: 0,
          clipEnd: seg.duration,
          duration: seg.duration,
        });
      } else {
        chapterAudio.push(null);
      }
    }
  }

  // OEBPS/chapters/*.xhtml + optional SMIL overlays
  const chapterFiles: ChapterFileInfo[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const chap = chapters[i];
    const num = String(i + 1).padStart(3, '0');
    const id = `chapter-${num}`;
    const filename = `${id}.xhtml`;
    const audioInfo = chapterAudio[i] ?? null;

    // Render XHTML with element IDs for SMIL references when audio is present
    // A definition nobody cites has no chapter to belong to; park the leftovers
    // in the final chapter so the content still reaches the reader.
    const isLastChapter = i === chapters.length - 1;
    const { xhtml, ids } = renderChapterXhtml(
      chap.nodes,
      title,
      resolvedImages,
      audioInfo !== null,
      footnoteIndex,
      isLastChapter ? uncitedFootnotes : [],
    );
    zip.file(`OEBPS/chapters/${filename}`, xhtml);

    let smilFilename: string | undefined;
    if (audioInfo) {
      smilFilename = `${id}.smil`;
      const smil = generateSmil(filename, audioInfo, ids);
      zip.file(`OEBPS/chapters/${smilFilename}`, smil);
    }

    chapterFiles.push({
      id,
      filename,
      title: chap.title,
      smilFilename,
      duration: audioInfo?.duration,
    });
  }

  // OEBPS/toc.xhtml (EPUB 3 nav)
  zip.file('OEBPS/toc.xhtml', generateTocXhtml(chapterFiles, title));

  // OEBPS/content.opf
  zip.file(
    'OEBPS/content.opf',
    generateContentOpf({
      uuid,
      title,
      author,
      language,
      description,
      publisher,
      chapters: chapterFiles,
      images: resolvedImages,
      coverFilename,
      audioFiles: allAudioFiles,
      totalDuration: options.totalDuration,
      iconFonts: embeddedIconFonts,
    }),
  );

  const blob = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    // mimetype was already set to STORE above; JSZip respects per-file options
  });

  return blob;
}

/**
 * Convert a squisq Doc to an EPUB 3 file.
 *
 * Convenience wrapper: Doc → MarkdownDocument → EPUB.
 * When the Doc has audio segments and `options.audio` is provided,
 * EPUB 3 Media Overlays are generated for narrated playback.
 */
export async function docToEpub(doc: Doc, options: EpubExportOptions = {}): Promise<ArrayBuffer> {
  const { docToMarkdown } = await import('@bendyline/squisq/doc');
  const markdownDoc = docToMarkdown(doc);

  // Thread audio segment metadata from the Doc into options
  const epubOptions: EpubExportOptions = { ...options };
  if (doc.audio?.segments?.length && !epubOptions.audioSegments) {
    epubOptions.audioSegments = doc.audio.segments;
  }
  if (doc.duration && !epubOptions.totalDuration) {
    epubOptions.totalDuration = doc.duration;
  }

  return markdownDocToEpub(markdownDoc, epubOptions);
}

// ── Chapter Splitting ─────────────────────────────────────────────

interface Chapter {
  title: string;
  nodes: MarkdownBlockNode[];
}

interface ChapterFileInfo {
  id: string;
  filename: string;
  title: string;
  smilFilename?: string;
  duration?: number;
}

interface ChapterAudioInfo {
  audioFilename: string;
  clipStart: number;
  clipEnd: number;
  duration: number;
}

function splitIntoChapters(nodes: MarkdownBlockNode[]): Chapter[] {
  const chapters: Chapter[] = [];
  let currentNodes: MarkdownBlockNode[] = [];
  let currentTitle = 'Untitled';

  for (const node of nodes) {
    if (node.type === 'heading' && node.depth <= 2) {
      // Flush previous chapter
      if (currentNodes.length > 0) {
        chapters.push({ title: currentTitle, nodes: currentNodes });
      }
      currentTitle = extractHeadingText(node);
      currentNodes = [node];
    } else {
      currentNodes.push(node);
    }
  }

  // Flush remaining
  if (currentNodes.length > 0) {
    chapters.push({ title: currentTitle, nodes: currentNodes });
  }

  // If no chapters were created, wrap everything as one
  if (chapters.length === 0) {
    chapters.push({ title: 'Untitled', nodes: [] });
  }

  return chapters;
}

function extractHeadingText(heading: MarkdownHeading): string {
  return extractPlainText(heading.children);
}

// ── Image Collection ──────────────────────────────────────────────

function collectDocImages(nodes: MarkdownBlockNode[]): Set<string> {
  const images = new Set<string>();

  function walkBlock(node: MarkdownBlockNode): void {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        node.children.forEach(walkInline);
        break;
      case 'blockquote':
        node.children.forEach(walkBlock);
        break;
      case 'list':
        node.children.forEach((item) => item.children.forEach(walkBlock));
        break;
      case 'table':
        node.children.forEach((row) =>
          row.children.forEach((cell) => cell.children.forEach(walkInline)),
        );
        break;
      default:
        break;
    }
  }

  function walkInline(node: MarkdownInlineNode): void {
    if (node.type === 'image' && node.url && !node.url.startsWith('data:')) {
      images.add(node.url);
    }
    if ('children' in node && Array.isArray(node.children)) {
      (node.children as MarkdownInlineNode[]).forEach(walkInline);
    }
  }

  nodes.forEach(walkBlock);
  return images;
}

// ── XHTML Rendering ───────────────────────────────────────────────

type ImageMap = Map<string, { data: ArrayBuffer; mime: string; filename: string }>;

/**
 * Render one chapter's XHTML, reporting the element IDs actually emitted.
 *
 * The ID list is returned rather than recomputed by the SMIL generator on
 * purpose: any second traversal that has to predict which nodes render an ID
 * is a copy of this function's logic, and the two WILL drift (they did — SMIL
 * counted nodes that `blockToXhtml` renders as nothing, producing `<text>`
 * refs to IDs that exist nowhere in the XHTML, which fails epubcheck).
 * Reporting the real IDs makes the drift unrepresentable.
 */
/**
 * A chapter's footnotes as an EPUB 3 `<aside epub:type="footnotes">`.
 *
 * Definitions render to '' where they stand (see `blockToXhtml`) and reappear
 * here, so the note sits at the end of the chapter that cites it rather than
 * wherever the markdown author happened to write it. Numbering comes from the
 * DOCUMENT-wide index, so a note first cited in chapter 3 keeps its number.
 */
/** Every footnote identifier the prose actually cites, at any depth. */
function collectCitedIdentifiers(nodes: readonly unknown[], into: Set<string>): void {
  for (const raw of nodes) {
    const node = raw as { type?: string; identifier?: string; children?: unknown[] };
    if (node?.type === 'footnoteReference' && node.identifier) into.add(node.identifier);
    if (Array.isArray(node?.children)) collectCitedIdentifiers(node.children, into);
  }
}

function renderFootnotesXhtml(identifiers: readonly string[], ctx: EpubRenderCtx): string {
  const index = ctx.footnotes;
  if (!index || identifiers.length === 0) return '';
  const seen = new Set<string>();
  const notes = index
    .ordered()
    .filter(
      (fn) =>
        identifiers.includes(fn.identifier) && !seen.has(fn.identifier) && seen.add(fn.identifier),
    );
  if (notes.length === 0) return '';
  const items = notes.map((fn) => {
    const { def } = footnoteIds(fn.identifier);
    const body = fn.definition
      ? fn.definition.children.map((c) => blockToXhtml(c, ctx)).join('')
      : '';
    return (
      `<li id="${escapeXml(def)}" epub:type="footnote">` +
      `<span class="squisq-footnote-num">${fn.number}.</span> ${body}</li>`
    );
  });
  return (
    `\n<aside class="squisq-footnotes" epub:type="footnotes"><hr/>\n<ol>\n` +
    items.join('\n') +
    `\n</ol>\n</aside>`
  );
}

function renderChapterXhtml(
  nodes: MarkdownBlockNode[],
  bookTitle: string,
  images: ImageMap,
  addIds = false,
  footnotes?: FootnoteIndex,
  trailingFootnotes: readonly string[] = [],
): { xhtml: string; ids: string[] } {
  const ids: string[] = [];
  const nextId = () => {
    const id = `p${ids.length + 1}`;
    ids.push(id);
    return id;
  };
  const ctx: EpubRenderCtx = { images, footnotes, cited: new Set<string>() };
  const rendered = nodes.map((n) => blockToXhtml(n, ctx, addIds ? nextId : undefined)).join('\n');
  // Footnotes cited in THIS chapter, plus any the caller could not place.
  const body = rendered + renderFootnotesXhtml([...(ctx.cited ?? []), ...trailingFootnotes], ctx);
  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="../styles.css"/>
</head>
<body>
${body}
</body>
</html>`;
  return { xhtml, ids };
}

/**
 * What the XHTML renderers need threaded through the whole node walk.
 *
 * Was a bare `ImageMap`; footnotes need per-chapter citation state alongside
 * it, and widening the one threaded value beats adding a parallel parameter to
 * every renderer.
 */
interface EpubRenderCtx {
  images: ImageMap;
  /** Document-wide numbering, so numbers stay coherent across chapters. */
  footnotes?: FootnoteIndex;
  /** Identifiers cited while rendering the CURRENT chapter. */
  cited?: Set<string>;
}

function blockToXhtml(node: MarkdownBlockNode, ctx: EpubRenderCtx, nextId?: () => string): string {
  // Allocate the ID LAZILY — only the branches that actually emit `idAttr`
  // should consume one. Allocating eagerly here burned an ID for node types
  // that render to '' (footnoteDefinition, containerDirective, …), which is
  // what left the SMIL overlay pointing at IDs that were never written.
  let cached: string | undefined;
  const idAttr = (): string => {
    if (!nextId) return '';
    cached ??= ` id="${nextId()}"`;
    return cached;
  };

  switch (node.type) {
    case 'heading': {
      const tag = `h${node.depth}`;
      return `<${tag}${idAttr()}>${inlinesToXhtml(node.children, ctx)}</${tag}>`;
    }

    case 'paragraph':
      return `<p${idAttr()}>${inlinesToXhtml(node.children, ctx)}</p>`;

    case 'blockquote':
      return `<blockquote${idAttr()}>\n${node.children.map((c) => blockToXhtml(c, ctx, nextId)).join('\n')}\n</blockquote>`;

    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const startAttr =
        node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : '';
      const items = node.children.map((item) => listItemToXhtml(item, ctx)).join('\n');
      return `<${tag}${idAttr()}${startAttr}>\n${items}\n</${tag}>`;
    }

    case 'code': {
      const langAttr = node.lang ? ` class="language-${escapeXml(node.lang)}"` : '';
      return `<pre${idAttr()}><code${langAttr}>${escapeXml(node.value)}</code></pre>`;
    }

    case 'thematicBreak':
      return `<hr${idAttr()}/>`;

    case 'table':
      return tableToXhtml(node as MarkdownTable, ctx, idAttr());

    case 'htmlBlock':
      // Strip HTML tags for XHTML safety — raw HTML may not be well-formed XML
      return `<p${idAttr()}>${escapeXml(node.rawHtml.replace(/<[^>]+>/g, ''))}</p>`;

    case 'math':
      return `<p${idAttr()} class="math">${escapeXml(node.value)}</p>`;

    default:
      return '';
  }
}

function listItemToXhtml(item: MarkdownListItem, ctx: EpubRenderCtx): string {
  const content = item.children.map((c) => blockToXhtml(c, ctx)).join('\n');
  // Unwrap single <p> inside <li> for cleaner output
  const unwrapped =
    item.children.length === 1 && item.children[0].type === 'paragraph'
      ? inlinesToXhtml((item.children[0] as MarkdownParagraph).children, ctx)
      : content;
  return `<li>${unwrapped}</li>`;
}

function tableToXhtml(table: MarkdownTable, ctx: EpubRenderCtx, idAttr = ''): string {
  const rows = table.children;
  if (rows.length === 0) return `<table${idAttr}></table>`;

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);
  const align = table.align ?? [];

  function cellToXhtml(cell: MarkdownTableCell, tag: 'th' | 'td', colIndex: number): string {
    const a = align[colIndex];
    const style = a ? ` style="text-align: ${a}"` : '';
    return `<${tag}${style}>${inlinesToXhtml(cell.children, ctx)}</${tag}>`;
  }

  const thead = `<thead><tr>${headerRow.children.map((c, i) => cellToXhtml(c, 'th', i)).join('')}</tr></thead>`;
  const tbody =
    bodyRows.length > 0
      ? `<tbody>${bodyRows.map((row: MarkdownTableRow) => `<tr>${row.children.map((c, i) => cellToXhtml(c, 'td', i)).join('')}</tr>`).join('')}</tbody>`
      : '';

  return `<table${idAttr}>${thead}${tbody}</table>`;
}

function inlinesToXhtml(nodes: MarkdownInlineNode[], ctx: EpubRenderCtx): string {
  return nodes.map((n) => inlineToXhtml(n, ctx)).join('');
}

function inlineToXhtml(node: MarkdownInlineNode, ctx: EpubRenderCtx): string {
  switch (node.type) {
    case 'text':
      return escapeXml(node.value);

    case 'strong':
      return `<strong>${inlinesToXhtml(node.children, ctx)}</strong>`;

    case 'emphasis':
      return `<em>${inlinesToXhtml(node.children, ctx)}</em>`;

    case 'delete':
      return `<del>${inlinesToXhtml(node.children, ctx)}</del>`;

    case 'superscript':
      return `<sup>${inlinesToXhtml(node.children, ctx)}</sup>`;

    case 'footnoteReference': {
      if (!ctx.footnotes) return '';
      const { number, occurrence } = ctx.footnotes.cite(node.identifier);
      const { ref, def } = footnoteIds(node.identifier, occurrence);
      ctx.cited?.add(node.identifier);
      // `epub:type="noteref"` is what lets a reading system show the note as a
      // popup instead of jumping the reader to the end of the chapter.
      return (
        `<sup class="squisq-footnote-ref" epub:type="noteref">` +
        `<a href="#${escapeXml(def)}" id="${escapeXml(ref)}">${number}</a></sup>`
      );
    }

    case 'subscript':
      return `<sub>${inlinesToXhtml(node.children, ctx)}</sub>`;

    case 'inlineCode':
      return `<code>${escapeXml(node.value)}</code>`;

    case 'link': {
      const href = sanitizeUrl(node.url, 'link');
      if (!href) return inlinesToXhtml(node.children, ctx);
      const titleAttr = node.title ? ` title="${escapeXml(node.title)}"` : '';
      return `<a href="${escapeXml(href)}"${titleAttr}>${inlinesToXhtml(node.children, ctx)}</a>`;
    }

    case 'image': {
      const alt = escapeXml(node.alt ?? '');
      const resolved = ctx.images.get(node.url);
      const safeSrc = resolved ? `../images/${resolved.filename}` : sanitizeUrl(node.url, 'media');
      if (!safeSrc) return alt;
      const src = escapeXml(safeSrc);
      return `<img src="${src}" alt="${alt}"/>`;
    }

    case 'break':
      return '<br/>';

    case 'inlineMath':
      return `<span class="math">${escapeXml(node.value)}</span>`;

    case 'htmlInline':
      // Strip tags for XHTML safety
      return escapeXml(node.rawHtml.replace(/<[^>]+>/g, ''));

    case 'inlineIcon': {
      const icon = node as MarkdownInlineIcon;
      const glyph = fontAwesomeGlyph(icon.family, icon.name);
      return glyph
        ? `<span class="squisq-fa-${icon.family}">${escapeXml(glyph)}</span>`
        : escapeXml(`{[${icon.token}]}`);
    }

    default:
      return '';
  }
}

/**
 * Produce an EPUB identifier without assuming `crypto.randomUUID()` exists.
 * `randomUUID` is unavailable in older/non-secure browser contexts; use
 * `getRandomValues` when possible and retain a non-cryptographic last resort
 * because this UUID is an identifier, not a security token.
 */
function createEpubUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    let seed = Date.now() ^ Math.floor(Math.random() * 0x7fffffff);
    for (let i = 0; i < bytes.length; i++) {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      bytes[i] = seed & 0xff;
    }
  }
  // RFC 4122 version 4 / variant 1 bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Flatten an external path to a safe archive basename. */
function safeArchiveBasename(path: string, fallback: string): string {
  const filename = extractFilename(path.replace(/\\/g, '/'));
  const safe = Array.from(filename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === '\\' || character === '/' || codePoint < 0x20 || codePoint === 0x7f
      ? '_'
      : character;
  })
    .join('')
    .trim();
  return !safe || safe === '.' || safe === '..' ? fallback : safe;
}

/**
 * Derive an OPF manifest `id` from a filename that collides with no prior
 * manifest entry. The `<prefix>-` head keeps the result a valid XML NCName
 * (which may not start with a digit); `used` is mutated with the result.
 */
function uniqueManifestId(prefix: string, filename: string, used: Set<string>): string {
  const base = `${prefix}-${filename.replace(/[^a-zA-Z0-9]/g, '-')}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

/** Return a basename that does not collide with a prior archive member. */
function uniqueFilename(filename: string, used: ReadonlySet<string>): string {
  if (!used.has(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let suffix = 2;
  while (used.has(`${base}-${suffix}${ext}`)) suffix++;
  return `${base}-${suffix}${ext}`;
}

// ── SMIL Media Overlays ───────────────────────────────────────────

/**
 * Generate an EPUB 3 Media Overlay (SMIL) file for a chapter.
 * Maps block-level elements to audio clip ranges for synchronized narration.
 *
 * `elementIds` are the IDs `renderChapterXhtml` actually emitted — every
 * `<text src>` below therefore resolves to a real element by construction.
 * Do NOT re-derive them by walking the nodes again: epubcheck rejects a
 * fragment pointing at a nonexistent ID, and a node that renders to nothing
 * is exactly the case a second traversal gets wrong.
 */
function generateSmil(
  chapterFilename: string,
  audioInfo: ChapterAudioInfo,
  elementIds: readonly string[],
): string {
  // A chapter with no addressable elements gets no pars — emitting one that
  // referenced a nonexistent `#p1` is precisely the bug being fixed.
  if (elementIds.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq-1" epub:textref="${chapterFilename}">
    </seq>
  </body>
</smil>`;
  }

  // Distribute audio duration evenly across elements (best effort without word-level timing)
  const clipDuration = audioInfo.duration / elementIds.length;
  const pars: string[] = [];

  for (let i = 0; i < elementIds.length; i++) {
    const clipStart = formatTime(audioInfo.clipStart + i * clipDuration, true);
    const clipEnd = formatTime(audioInfo.clipStart + (i + 1) * clipDuration, true);
    pars.push(
      `    <par id="par-${i + 1}">` +
        `\n      <text src="${chapterFilename}#${escapeXml(elementIds[i]!)}"/>` +
        `\n      <audio src="../audio/${escapeXml(audioInfo.audioFilename)}" clipBegin="${clipStart}" clipEnd="${clipEnd}"/>` +
        `\n    </par>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq-1" epub:textref="${chapterFilename}">
${pars.join('\n')}
    </seq>
  </body>
</smil>`;
}

function formatTime(seconds: number, fractional = false): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sPart = fractional ? s.toFixed(3).padStart(6, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sPart}`;
}

// ── Package Documents ─────────────────────────────────────────────

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

interface OpfParams {
  uuid: string;
  title: string;
  author: string;
  language: string;
  description: string;
  publisher: string;
  chapters: ChapterFileInfo[];
  images: ImageMap;
  coverFilename?: string;
  audioFiles?: { filename: string; mime: string }[];
  totalDuration?: number;
  iconFonts: FontAwesomeFontFace[];
}

function generateContentOpf(params: OpfParams): string {
  const {
    uuid,
    title,
    author,
    language,
    description,
    publisher,
    chapters,
    images,
    coverFilename,
    audioFiles,
    totalDuration,
    iconFonts,
  } = params;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const hasOverlays = chapters.some((c) => c.smilFilename);

  // Manifest items
  const manifestItems: string[] = [
    '    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="css" href="styles.css" media-type="text/css"/>',
  ];

  for (const face of iconFonts) {
    manifestItems.push(
      `    <item id="font-${face.family}" href="fonts/${face.fileStem}.otf" media-type="font/otf"/>`,
    );
  }

  if (coverFilename) {
    const mime = inferMimeType(coverFilename);
    manifestItems.push(
      `    <item id="cover-image" href="images/${escapeXml(coverFilename)}" media-type="${mime}" properties="cover-image"/>`,
    );
    manifestItems.push(
      '    <item id="cover-page" href="chapters/cover.xhtml" media-type="application/xhtml+xml"/>',
    );
  }

  for (const chap of chapters) {
    const overlayAttr = chap.smilFilename ? ` media-overlay="${chap.id}-overlay"` : '';
    manifestItems.push(
      `    <item id="${chap.id}" href="chapters/${escapeXml(chap.filename)}" media-type="application/xhtml+xml"${overlayAttr}/>`,
    );
    if (chap.smilFilename) {
      manifestItems.push(
        `    <item id="${chap.id}-overlay" href="chapters/${escapeXml(chap.smilFilename)}" media-type="application/smil+xml"/>`,
      );
    }
  }

  // Manifest IDs are xml:id values — they MUST be unique across the whole
  // package. Deriving one by squashing every non-alphanumeric character to
  // '-' is lossy, so distinct filenames collapse onto the same ID
  // (`photo-1.png` and `photo 1.png` both yield `img-photo-1-png`),
  // producing a duplicate xml:id and an invalid OPF. Uniquify the derived
  // ID rather than pretend the mapping is injective.
  const usedManifestIds = new Set<string>(['cover-image', 'cover-page']);
  for (const chap of chapters) {
    usedManifestIds.add(chap.id);
    if (chap.smilFilename) usedManifestIds.add(`${chap.id}-overlay`);
  }

  // Audio files in manifest
  if (audioFiles) {
    const usedAudioNames = new Set<string>();
    for (const af of audioFiles) {
      if (usedAudioNames.has(af.filename)) continue;
      usedAudioNames.add(af.filename);
      const audioId = uniqueManifestId('audio', af.filename, usedManifestIds);
      manifestItems.push(
        `    <item id="${audioId}" href="audio/${escapeXml(af.filename)}" media-type="${af.mime}"/>`,
      );
    }
  }

  const usedFilenames = new Set<string>();
  for (const [, img] of images) {
    if (usedFilenames.has(img.filename)) continue;
    usedFilenames.add(img.filename);
    const imgId = uniqueManifestId('img', img.filename, usedManifestIds);
    manifestItems.push(
      `    <item id="${imgId}" href="images/${escapeXml(img.filename)}" media-type="${img.mime}"/>`,
    );
  }

  // Spine — cover page first (if present), then chapters
  const spineEntries: string[] = [];
  if (coverFilename) {
    spineEntries.push('    <itemref idref="cover-page"/>');
  }
  for (const chap of chapters) {
    spineEntries.push(`    <itemref idref="${chap.id}"/>`);
  }
  const spineItems = spineEntries.join('\n');

  // Metadata
  const metaParts = [
    `    <dc:identifier id="uid">urn:uuid:${uuid}</dc:identifier>`,
    `    <dc:title>${escapeXml(title)}</dc:title>`,
    `    <dc:language>${escapeXml(language)}</dc:language>`,
    `    <meta property="dcterms:modified">${modified}</meta>`,
  ];
  if (author) metaParts.push(`    <dc:creator>${escapeXml(author)}</dc:creator>`);
  if (description) metaParts.push(`    <dc:description>${escapeXml(description)}</dc:description>`);
  if (publisher) metaParts.push(`    <dc:publisher>${escapeXml(publisher)}</dc:publisher>`);

  // Media Overlay metadata
  if (hasOverlays && totalDuration) {
    metaParts.push(`    <meta property="media:duration">${formatTime(totalDuration)}</meta>`);
    metaParts.push('    <meta property="media:active-class">epub-media-overlay-active</meta>');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metaParts.join('\n')}
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;
}

function generateTocXhtml(chapters: ChapterFileInfo[], bookTitle: string): string {
  const navItems = chapters
    .map(
      (chap) =>
        `      <li><a href="chapters/${escapeXml(chap.filename)}">${escapeXml(chap.title)}</a></li>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;
}

// ── Stylesheet ────────────────────────────────────────────────────

function generateStylesheet(
  themeId: string | undefined,
  doc?: MarkdownDocument,
  registry?: ThemeRegistry,
  iconFonts: FontAwesomeFontFace[] = [],
): string {
  let themeVars = '';
  if (themeId) {
    const theme = resolveThemeForDoc(doc, themeId, registry);
    themeVars = `
  --epub-bg: ${theme.colors.background};
  --epub-text: ${theme.colors.text};
  --epub-primary: ${theme.colors.primary};
  --epub-heading-font: ${resolveFontFamily(theme.typography.titleFont, 'serif')};
  --epub-body-font: ${resolveFontFamily(theme.typography.bodyFont, 'sans-serif')};`;
  }

  const iconCss = iconFonts
    .map(
      (face) => `@font-face {
  font-family: '${face.typeface}';
  src: url('fonts/${face.fileStem}.otf') format('opentype');
  font-style: normal;
  font-weight: normal;
}

.squisq-fa-${face.family} {
  font-family: '${face.typeface}';
  font-style: normal;
  font-weight: normal;
}`,
    )
    .join('\n\n');

  return `/* Squisq EPUB Stylesheet */
${iconCss}
:root {${themeVars}
}

body {
  font-family: var(--epub-body-font, Georgia, 'Times New Roman', serif);
  color: var(--epub-text, #1a1a1a);
  line-height: 1.7;
  margin: 1em 2em;
  max-width: 40em;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--epub-heading-font, system-ui, sans-serif);
  color: var(--epub-primary, #1a1a1a);
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  line-height: 1.3;
}

h1 { font-size: 2em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }

p {
  margin: 0.8em 0;
}

a {
  color: var(--epub-primary, #2563eb);
}

img {
  max-width: 100%;
  height: auto;
}

pre {
  background: #f5f5f5;
  padding: 1em;
  overflow-x: auto;
  border-radius: 4px;
  font-size: 0.9em;
  line-height: 1.4;
}

code {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
}

p > code, li > code {
  background: #f0f0f0;
  padding: 0.1em 0.3em;
  border-radius: 3px;
}

blockquote {
  border-left: 3px solid var(--epub-primary, #d1d5db);
  margin: 1em 0;
  padding: 0.5em 1em;
  color: #4b5563;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

th, td {
  border: 1px solid #d1d5db;
  padding: 0.5em 0.75em;
  text-align: left;
}

th {
  background: #f3f4f6;
  font-weight: 600;
}

hr {
  border: none;
  border-top: 1px solid #d1d5db;
  margin: 2em 0;
}

ul, ol {
  margin: 0.8em 0;
  padding-left: 1.5em;
}

li {
  margin: 0.3em 0;
}

.math {
  font-family: 'Courier New', Courier, monospace;
  font-style: italic;
}

/* Media Overlay active highlight (narration sync) */
.epub-media-overlay-active {
  background-color: rgba(37, 99, 235, 0.12);
}
`;
}
