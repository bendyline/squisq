/**
 * PPTX import — PresentationML (.pptx) → MarkdownDocument.
 *
 * Reuses the shared ooxml/ reader. Reads slide order from
 * `ppt/presentation.xml` (`<p:sldIdLst>`), resolves each slide part via
 * relationships, and converts each slide to: an H2 of the title placeholder
 * (or "Slide N"), the remaining text as a bullet list, and any slide tables
 * (`<a:tbl>`) as markdown tables. Text lives in the DrawingML namespace
 * (`a:p` / `a:r` / `a:t`) inside PresentationML shapes (`p:sp`).
 */

import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownImage,
  MarkdownListItem,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import { getPartBinary, getPartRelationships, getPartXml, openPackage } from '../ooxml/reader.js';
import type { OoxmlPackage } from '../ooxml/types.js';
import { NS_DRAWINGML, NS_PML, NS_R } from '../ooxml/namespaces.js';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';

export interface PptxImportOptions {
  /**
   * Whether to extract embedded slide images into the document as image nodes
   * (referencing `images/imageN.ext`). When false, pictures are ignored so the
   * markdown never carries dangling image references with no backing container.
   * `pptxToContainer` forces this on. Default: false.
   */
  extractImages?: boolean;
}

/** Maps a media file extension to its MIME type (mirrors docx import). */
const IMAGE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.emf': 'image/emf',
  '.wmf': 'image/wmf',
};

/**
 * Per-import mutable state used to collect embedded images across slides.
 * Mirrors the docx import context's `extractedImages` / `imageCounter`.
 */
interface ImportContext {
  pkg: OoxmlPackage;
  extractImages: boolean;
  /** Collected image files: `images/imageN.ext` → { data, mimeType } */
  extractedImages: Map<string, { data: ArrayBuffer; mimeType: string }>;
  imageCounter: number;
}

function attrNS(el: Element, ns: string, local: string, fallback: string): string | null {
  return el.getAttributeNS(ns, local) ?? el.getAttribute(fallback);
}

function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\//, '');
  const stack = baseDir ? baseDir.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg !== '.') stack.push(seg);
  }
  return stack.join('/');
}

async function orderedSlidePaths(pkg: OoxmlPackage): Promise<string[]> {
  const pres = await getPartXml(pkg, 'ppt/presentation.xml');
  if (!pres) return [];
  const rels = await getPartRelationships(pkg, 'ppt/presentation.xml');
  const relById = new Map(rels.map((r) => [r.id, r.target]));
  const out: string[] = [];
  const ids = pres.getElementsByTagNameNS(NS_PML, 'sldId');
  for (let i = 0; i < ids.length; i++) {
    const rid = attrNS(ids[i]!, NS_R, 'id', 'r:id');
    const target = rid ? relById.get(rid) : undefined;
    if (target) out.push(resolveTarget('ppt', target));
  }
  return out;
}

/** Concatenate the DrawingML text runs (`a:t`) inside a paragraph element. */
function paragraphText(para: Element): string {
  const ts = para.getElementsByTagNameNS(NS_DRAWINGML, 't');
  let s = '';
  for (let i = 0; i < ts.length; i++) s += ts[i]!.textContent ?? '';
  return s.trim();
}

function isTitleShape(sp: Element): boolean {
  const ph = sp.getElementsByTagNameNS(NS_PML, 'ph');
  if (!ph.length) return false;
  const type = ph[0]!.getAttribute('type');
  return type === 'title' || type === 'ctrTitle';
}

function tableToMarkdown(tbl: Element): MarkdownTable {
  const rows: MarkdownTableRow[] = [];
  const trs = tbl.getElementsByTagNameNS(NS_DRAWINGML, 'tr');
  for (let r = 0; r < trs.length; r++) {
    const tcs = trs[r]!.getElementsByTagNameNS(NS_DRAWINGML, 'tc');
    const cells: MarkdownTableCell[] = [];
    for (let c = 0; c < tcs.length; c++) {
      const paras = tcs[c]!.getElementsByTagNameNS(NS_DRAWINGML, 'p');
      const text = Array.from({ length: paras.length }, (_, i) => paragraphText(paras[i]!))
        .filter(Boolean)
        .join(' ');
      cells.push({
        type: 'tableCell',
        ...(r === 0 ? { isHeader: true } : {}),
        children: text ? [{ type: 'text', value: text }] : [],
      });
    }
    rows.push({ type: 'tableRow', children: cells });
  }
  return { type: 'table', children: rows };
}

/** Directory portion of a part path, e.g. `ppt/slides/slide1.xml` → `ppt/slides`. */
function baseDirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Extract every `<p:pic>` picture in a slide as an image node, reading the
 * `<a:blip r:embed>` relationship, resolving it to the media part, and copying
 * the bytes into `ctx.extractedImages` under `images/imageN.ext`.
 */
async function extractSlideImages(
  doc: Document,
  slidePath: string,
  ctx: ImportContext,
): Promise<MarkdownImage[]> {
  const rels = await getPartRelationships(ctx.pkg, slidePath);
  const relById = new Map(rels.map((r) => [r.id, r.target]));
  const baseDir = baseDirOf(slidePath);

  const images: MarkdownImage[] = [];
  const pics = doc.getElementsByTagNameNS(NS_PML, 'pic');
  for (let i = 0; i < pics.length; i++) {
    const pic = pics[i]!;
    const blips = pic.getElementsByTagNameNS(NS_DRAWINGML, 'blip');
    if (!blips.length) continue;
    const embed = attrNS(blips[0]!, NS_R, 'embed', 'r:embed');
    if (!embed) continue;
    const target = relById.get(embed);
    if (!target) continue;

    const mediaPath = resolveTarget(baseDir, target);
    const data = await getPartBinary(ctx.pkg, mediaPath);
    if (!data) continue;

    const dot = mediaPath.lastIndexOf('.');
    const ext = dot !== -1 ? mediaPath.slice(dot).toLowerCase() : '.png';
    const mimeType = IMAGE_MIME_MAP[ext] ?? 'application/octet-stream';

    ctx.imageCounter++;
    const imagePath = `images/image${ctx.imageCounter}${ext}`;
    ctx.extractedImages.set(imagePath, { data, mimeType });

    // Alt text from the picture's non-visual properties (descr, then name).
    const cNvPrs = pic.getElementsByTagNameNS(NS_PML, 'cNvPr');
    const alt =
      (cNvPrs.length ? cNvPrs[0]!.getAttribute('descr') || cNvPrs[0]!.getAttribute('name') : '') ||
      'Image';

    images.push({ type: 'image', url: imagePath, alt });
  }
  return images;
}

async function convertSlide(
  path: string,
  index: number,
  ctx: ImportContext,
): Promise<MarkdownBlockNode[]> {
  const pkg = ctx.pkg;
  const doc = await getPartXml(pkg, path);
  if (!doc) return [];
  const out: MarkdownBlockNode[] = [];

  let title = '';
  const bullets: string[] = [];
  const shapes = doc.getElementsByTagNameNS(NS_PML, 'sp');
  for (let s = 0; s < shapes.length; s++) {
    const sp = shapes[s]!;
    const txBody = sp.getElementsByTagNameNS(NS_PML, 'txBody');
    if (!txBody.length) continue;
    const paras = txBody[0]!.getElementsByTagNameNS(NS_DRAWINGML, 'p');
    const texts: string[] = [];
    for (let p = 0; p < paras.length; p++) {
      const t = paragraphText(paras[p]!);
      if (t) texts.push(t);
    }
    if (texts.length === 0) continue;
    if (isTitleShape(sp) && !title) {
      title = texts.join(' ');
    } else {
      bullets.push(...texts);
    }
  }

  out.push({
    type: 'heading',
    depth: 2,
    children: [{ type: 'text', value: title || `Slide ${index + 1}` }],
  });

  if (bullets.length > 0) {
    const items: MarkdownListItem[] = bullets.map((text) => ({
      type: 'listItem',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
    }));
    out.push({ type: 'list', ordered: false, children: items });
  }

  // Embedded pictures land after the bullet list and before any tables.
  if (ctx.extractImages) {
    const images = await extractSlideImages(doc, path, ctx);
    for (const image of images) {
      out.push({ type: 'paragraph', children: [image] });
    }
  }

  const tbls = doc.getElementsByTagNameNS(NS_DRAWINGML, 'tbl');
  for (let t = 0; t < tbls.length; t++) out.push(tableToMarkdown(tbls[t]!));

  return out;
}

async function importDocument(
  pkg: OoxmlPackage,
  options: PptxImportOptions,
): Promise<{ doc: MarkdownDocument; ctx: ImportContext }> {
  const ctx: ImportContext = {
    pkg,
    extractImages: options.extractImages ?? false,
    extractedImages: new Map(),
    imageCounter: 0,
  };
  const paths = await orderedSlidePaths(pkg);
  const children: MarkdownBlockNode[] = [];
  for (let i = 0; i < paths.length; i++) {
    children.push(...(await convertSlide(paths[i]!, i, ctx)));
  }
  return { doc: { type: 'document', children }, ctx };
}

export async function pptxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options: PptxImportOptions = {},
): Promise<MarkdownDocument> {
  const pkg = await openPackage(data);
  const { doc } = await importDocument(pkg, options);
  return doc;
}

/**
 * Convert a .pptx file to a ContentContainer with markdown + extracted images.
 *
 * The container holds the primary markdown document plus every embedded slide
 * image under `images/` (e.g. `images/image1.png`). Image extraction is always
 * forced on here so the markdown's image references resolve inside the
 * container. Mirrors `docxToContainer`.
 */
export async function pptxToContainer(
  data: ArrayBuffer | Blob,
  options: PptxImportOptions = {},
): Promise<ContentContainer> {
  const pkg = await openPackage(data);
  const { doc, ctx } = await importDocument(pkg, { ...options, extractImages: true });

  const container = new MemoryContentContainer();
  await container.writeDocument(stringifyMarkdown(doc));

  for (const [path, { data: imageData, mimeType }] of ctx.extractedImages) {
    await container.writeFile(path, new Uint8Array(imageData), mimeType);
  }

  return container;
}
