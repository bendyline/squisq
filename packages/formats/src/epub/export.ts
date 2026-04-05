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
import type { Doc, AudioSegment } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
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
} from '@bendyline/squisq/markdown';
import { escapeXml } from '../ooxml/xmlUtils.js';
import { inferMimeType, extractFilename } from '../html/imageUtils.js';

// ── Public API ────────────────────────────────────────────────────

export interface EpubExportOptions {
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
  const fmTitle = doc.frontmatter?.title;
  const fmAuthor = doc.frontmatter?.author;
  const title = options.title ?? (typeof fmTitle === 'string' ? fmTitle : 'Untitled');
  const author = options.author ?? (typeof fmAuthor === 'string' ? fmAuthor : '');
  const language = options.language ?? 'en';
  const description = options.description ?? '';
  const publisher = options.publisher ?? '';
  const uuid = crypto.randomUUID();

  // Split document into chapters
  const chapters = splitIntoChapters(doc.children);

  // Collect images referenced in the document, deduplicating filenames
  const imageEntries = collectDocImages(doc.children);
  const resolvedImages = new Map<string, { data: ArrayBuffer; mime: string; filename: string }>();
  if (options.images) {
    const usedNames = new Set<string>();
    for (const src of imageEntries) {
      const data = options.images.get(src);
      if (data) {
        let filename = extractFilename(src);
        // Deduplicate: if two paths share a basename (e.g. a/hero.png and b/hero.png)
        if (usedNames.has(filename)) {
          const dot = filename.lastIndexOf('.');
          const base = dot > 0 ? filename.slice(0, dot) : filename;
          const ext = dot > 0 ? filename.slice(dot) : '';
          let counter = 2;
          while (usedNames.has(`${base}-${counter}${ext}`)) counter++;
          filename = `${base}-${counter}${ext}`;
        }
        usedNames.add(filename);
        resolvedImages.set(src, { data, mime: inferMimeType(filename), filename });
      }
    }
  }

  // Generate theme CSS
  const css = generateStylesheet(options.themeId);

  // Build the ZIP
  const zip = new JSZip();

  // mimetype must be first entry, stored (not compressed)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.file('META-INF/container.xml', CONTAINER_XML);

  // OEBPS/styles.css
  zip.file('OEBPS/styles.css', css);

  // OEBPS/images/*
  for (const [, img] of resolvedImages) {
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
    coverFilename = isPng ? 'cover.png' : 'cover.jpg';
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

  if (hasAudio) {
    for (const seg of audioSegments) {
      const data = audioMap.get(seg.src) ?? audioMap.get(seg.name);
      if (data) {
        const filename = extractFilename(seg.src);
        const finalName = filename.includes('.') ? filename : `${filename}.mp3`;
        zip.file(`OEBPS/audio/${finalName}`, data);
        const info = { filename: finalName, mime: inferMimeType(finalName) };
        segmentAudioFiles.push(info);
        allAudioFiles.push(info);
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
    const xhtml = renderChapterXhtml(chap.nodes, title, resolvedImages, audioInfo !== null);
    zip.file(`OEBPS/chapters/${filename}`, xhtml);

    let smilFilename: string | undefined;
    if (audioInfo) {
      smilFilename = `${id}.smil`;
      const smil = generateSmil(filename, audioInfo, chap.nodes);
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
  return heading.children.map(inlineToText).join('');
}

function inlineToText(node: MarkdownInlineNode): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'emphasis':
    case 'strong':
    case 'delete':
      return node.children.map(inlineToText).join('');
    case 'inlineCode':
      return node.value;
    case 'link':
      return node.children.map(inlineToText).join('');
    case 'image':
      return node.alt ?? '';
    case 'break':
      return ' ';
    default:
      return '';
  }
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
    if (
      node.type === 'image' &&
      node.url &&
      !node.url.startsWith('data:')
    ) {
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

function renderChapterXhtml(
  nodes: MarkdownBlockNode[],
  bookTitle: string,
  images: ImageMap,
  addIds = false,
): string {
  let elementCounter = 0;
  const nextId = () => `p${++elementCounter}`;
  const body = nodes.map((n) => blockToXhtml(n, images, addIds ? nextId : undefined)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
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
}

function blockToXhtml(node: MarkdownBlockNode, images: ImageMap, nextId?: () => string): string {
  const idAttr = nextId ? ` id="${nextId()}"` : '';

  switch (node.type) {
    case 'heading': {
      const tag = `h${node.depth}`;
      return `<${tag}${idAttr}>${inlinesToXhtml(node.children, images)}</${tag}>`;
    }

    case 'paragraph':
      return `<p${idAttr}>${inlinesToXhtml(node.children, images)}</p>`;

    case 'blockquote':
      return `<blockquote${idAttr}>\n${node.children.map((c) => blockToXhtml(c, images, nextId)).join('\n')}\n</blockquote>`;

    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const startAttr =
        node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : '';
      const items = node.children.map((item) => listItemToXhtml(item, images)).join('\n');
      return `<${tag}${idAttr}${startAttr}>\n${items}\n</${tag}>`;
    }

    case 'code': {
      const langAttr = node.lang ? ` class="language-${escapeXml(node.lang)}"` : '';
      return `<pre${idAttr}><code${langAttr}>${escapeXml(node.value)}</code></pre>`;
    }

    case 'thematicBreak':
      return `<hr${idAttr}/>`;

    case 'table':
      return tableToXhtml(node as MarkdownTable, images, idAttr);

    case 'htmlBlock':
      // Strip HTML tags for XHTML safety — raw HTML may not be well-formed XML
      return `<p${idAttr}>${escapeXml(node.rawHtml.replace(/<[^>]+>/g, ''))}</p>`;

    case 'math':
      return `<p${idAttr} class="math">${escapeXml(node.value)}</p>`;

    default:
      return '';
  }
}

function listItemToXhtml(item: MarkdownListItem, images: ImageMap): string {
  const content = item.children.map((c) => blockToXhtml(c, images)).join('\n');
  // Unwrap single <p> inside <li> for cleaner output
  const unwrapped =
    item.children.length === 1 && item.children[0].type === 'paragraph'
      ? inlinesToXhtml((item.children[0] as MarkdownParagraph).children, images)
      : content;
  return `<li>${unwrapped}</li>`;
}

function tableToXhtml(table: MarkdownTable, images: ImageMap, idAttr = ''): string {
  const rows = table.children;
  if (rows.length === 0) return `<table${idAttr}></table>`;

  const headerRow = rows[0];
  const bodyRows = rows.slice(1);
  const align = table.align ?? [];

  function cellToXhtml(cell: MarkdownTableCell, tag: 'th' | 'td', colIndex: number): string {
    const a = align[colIndex];
    const style = a ? ` style="text-align: ${a}"` : '';
    return `<${tag}${style}>${inlinesToXhtml(cell.children, images)}</${tag}>`;
  }

  const thead = `<thead><tr>${headerRow.children.map((c, i) => cellToXhtml(c, 'th', i)).join('')}</tr></thead>`;
  const tbody =
    bodyRows.length > 0
      ? `<tbody>${bodyRows.map((row: MarkdownTableRow) => `<tr>${row.children.map((c, i) => cellToXhtml(c, 'td', i)).join('')}</tr>`).join('')}</tbody>`
      : '';

  return `<table${idAttr}>${thead}${tbody}</table>`;
}

function inlinesToXhtml(nodes: MarkdownInlineNode[], images: ImageMap): string {
  return nodes.map((n) => inlineToXhtml(n, images)).join('');
}

function inlineToXhtml(node: MarkdownInlineNode, images: ImageMap): string {
  switch (node.type) {
    case 'text':
      return escapeXml(node.value);

    case 'strong':
      return `<strong>${inlinesToXhtml(node.children, images)}</strong>`;

    case 'emphasis':
      return `<em>${inlinesToXhtml(node.children, images)}</em>`;

    case 'delete':
      return `<del>${inlinesToXhtml(node.children, images)}</del>`;

    case 'inlineCode':
      return `<code>${escapeXml(node.value)}</code>`;

    case 'link': {
      const titleAttr = node.title ? ` title="${escapeXml(node.title)}"` : '';
      return `<a href="${escapeXml(node.url)}"${titleAttr}>${inlinesToXhtml(node.children, images)}</a>`;
    }

    case 'image': {
      const alt = escapeXml(node.alt ?? '');
      const resolved = images.get(node.url);
      const src = resolved ? `../images/${resolved.filename}` : escapeXml(node.url);
      return `<img src="${src}" alt="${alt}"/>`;
    }

    case 'break':
      return '<br/>';

    case 'inlineMath':
      return `<span class="math">${escapeXml(node.value)}</span>`;

    case 'htmlInline':
      // Strip tags for XHTML safety
      return escapeXml(node.rawHtml.replace(/<[^>]+>/g, ''));

    default:
      return '';
  }
}

// ── SMIL Media Overlays ───────────────────────────────────────────

/**
 * Generate an EPUB 3 Media Overlay (SMIL) file for a chapter.
 * Maps block-level elements to audio clip ranges for synchronized narration.
 */
function generateSmil(
  chapterFilename: string,
  audioInfo: ChapterAudioInfo,
  nodes: MarkdownBlockNode[],
): string {
  // Count block elements to match the IDs generated by blockToXhtml.
  // Must mirror blockToXhtml's recursion: each block gets an ID,
  // blockquote children recurse (they pass nextId), but list items do not.
  let elementCount = 0;
  function countBlocks(node: MarkdownBlockNode): void {
    elementCount++;
    if (node.type === 'blockquote') node.children.forEach(countBlocks);
  }
  nodes.forEach(countBlocks);

  if (elementCount === 0) elementCount = 1;

  // Distribute audio duration evenly across elements (best effort without word-level timing)
  const clipDuration = audioInfo.duration / elementCount;
  const pars: string[] = [];

  for (let i = 0; i < elementCount; i++) {
    const clipStart = formatTime(audioInfo.clipStart + i * clipDuration, true);
    const clipEnd = formatTime(audioInfo.clipStart + (i + 1) * clipDuration, true);
    pars.push(
      `    <par id="par-${i + 1}">` +
        `\n      <text src="${chapterFilename}#p${i + 1}"/>` +
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
  } = params;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const hasOverlays = chapters.some((c) => c.smilFilename);

  // Manifest items
  const manifestItems: string[] = [
    '    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '    <item id="css" href="styles.css" media-type="text/css"/>',
  ];

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

  // Audio files in manifest
  if (audioFiles) {
    const usedAudioNames = new Set<string>();
    for (const af of audioFiles) {
      if (usedAudioNames.has(af.filename)) continue;
      usedAudioNames.add(af.filename);
      const audioId = `audio-${af.filename.replace(/[^a-zA-Z0-9]/g, '-')}`;
      manifestItems.push(
        `    <item id="${audioId}" href="audio/${escapeXml(af.filename)}" media-type="${af.mime}"/>`,
      );
    }
  }

  const usedFilenames = new Set<string>();
  for (const [, img] of images) {
    if (usedFilenames.has(img.filename)) continue;
    usedFilenames.add(img.filename);
    const imgId = `img-${img.filename.replace(/[^a-zA-Z0-9]/g, '-')}`;
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

function generateStylesheet(themeId?: string): string {
  let themeVars = '';
  if (themeId) {
    const theme = resolveTheme(themeId);
    themeVars = `
  --epub-bg: ${theme.colors.background};
  --epub-text: ${theme.colors.text};
  --epub-primary: ${theme.colors.primary};
  --epub-heading-font: ${theme.typography.titleFontFamily};
  --epub-body-font: ${theme.typography.bodyFontFamily};`;
  }

  return `/* Squisq EPUB Stylesheet */
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
