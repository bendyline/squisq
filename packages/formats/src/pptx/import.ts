/**
 * PPTX import — PresentationML (.pptx) → MarkdownDocument.
 *
 * Reuses the shared ooxml/ reader. Reads slide order from
 * `ppt/presentation.xml` (`<p:sldIdLst>`), resolves each slide part via
 * relationships, and converts each slide to: an H2 of the title placeholder
 * (or "Slide N"), the remaining text as a bullet list, and any slide tables
 * (`<a:tbl>`) as markdown tables. Text lives in the DrawingML namespace
 * (`a:p` / `a:r` / `a:t`) inside PresentationML shapes (`p:sp`).
 *
 * Theme + layout inference (default ON): the deck's theme part is compiled
 * into a Squisq custom theme and carried in the returned document's
 * frontmatter (`squisq-custom-themes` + `squisq-theme`); slide layouts are
 * classified against the built-in template set, distinctive ones become
 * `squisq-custom-templates` definitions, and each slide's heading is
 * annotated (`{[templateName …]}`) per its layout's verdict. Pass
 * `inferTheme: false` / `inferLayouts: false` for legacy plain imports.
 * Inference never fails an import — extraction errors degrade to plain
 * output with a console warning.
 */

import type {
  HeadingTemplateAnnotation,
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownImage,
  MarkdownListItem,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import type { CustomTemplateDefinition, Theme } from '@bendyline/squisq/schemas';
import {
  getPartBinary,
  getPartRelationships,
  getPartXml,
  openPackage,
  requireMainPartPath,
} from '../ooxml/reader.js';
import type { OoxmlOpenOptions } from '../ooxml/reader.js';
import type { OoxmlPackage } from '../ooxml/types.js';
import { NS_DRAWINGML, NS_PML, NS_R } from '../ooxml/namespaces.js';
import { attrNS, baseDirOf, resolveTarget } from '../ooxml/readUtils.js';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { buildContainer } from '../shared/container.js';
import { extToMime } from '../shared/images.js';
import type { ExtractedFileTheme } from '../infer/types.js';
import type { AnalyzedLayout, PptxLayoutInference } from './layouts.js';

/** Conventional main part path; the root `officeDocument` rel wins when present. */
const PPTX_MAIN_PART = 'ppt/presentation.xml';

export interface PptxImportOptions extends OoxmlOpenOptions {
  /**
   * Whether to extract embedded slide images into the document as image nodes
   * (referencing `images/imageN.ext`). When false, pictures are ignored so the
   * markdown never carries dangling image references with no backing container.
   * `pptxToContainer` forces this on. Default: false.
   */
  extractImages?: boolean;
  /**
   * Infer a Squisq theme from the deck's theme part (colors + fonts) and
   * carry it in the returned document's frontmatter (`squisq-custom-themes`
   * + `squisq-theme`). Default: true — pass false for a legacy import with
   * no frontmatter.
   */
  inferTheme?: boolean;
  /**
   * Derive custom layout templates from the deck's slide layouts/masters
   * (`squisq-custom-templates` frontmatter) and annotate slide headings
   * with matching built-in or generated templates. Default: true.
   */
  inferLayouts?: boolean;
}

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
  /** Layout analysis when `inferLayouts` is on. */
  inference?: PptxLayoutInference;
  /** Generated custom templates actually referenced by ≥1 slide annotation. */
  usedCustomTemplates: Map<string, CustomTemplateDefinition>;
}

async function orderedSlidePaths(pkg: OoxmlPackage, mainPart: string): Promise<string[]> {
  const pres = await getPartXml(pkg, mainPart);
  if (!pres) {
    throw new Error(`Invalid PPTX package: presentation part "${mainPart}" could not be parsed.`);
  }
  const rels = await getPartRelationships(pkg, mainPart);
  const relById = new Map(rels.map((r) => [r.id, r.target]));
  const out: string[] = [];
  const ids = pres.getElementsByTagNameNS(NS_PML, 'sldId');
  for (let i = 0; i < ids.length; i++) {
    const rid = attrNS(ids[i]!, NS_R, 'id', 'r:id');
    const target = rid ? relById.get(rid) : undefined;
    if (target) out.push(resolveTarget(baseDirOf(mainPart), target));
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
    const mimeType = extToMime(ext);

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

// ── Layout-verdict annotation building ───────────────────────────────

/** One non-title text shape on a slide, with its placeholder identity. */
interface SlideTextEntry {
  rawType: string;
  idx: number;
  texts: string[];
}

/** Annotation params live on a single heading line — flatten whitespace. */
function cleanParamText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Turn a slide's layout verdict into a heading annotation, downgrading to
 * plain when the slide lacks the content the template needs (a bare
 * annotation without its essential params renders an empty card in the
 * player path, which never derives inputs for annotated blocks).
 */
function buildSlideAnnotation(
  analyzed: AnalyzedLayout | undefined,
  entries: SlideTextEntry[],
  images: MarkdownImage[],
  ctx: ImportContext,
): { annotation?: HeadingTemplateAnnotation; omitted: Set<SlideTextEntry> } {
  const omitted = new Set<SlideTextEntry>();
  if (!analyzed) return { omitted };
  const verdict = analyzed.verdict;

  if (verdict.kind === 'custom') {
    ctx.usedCustomTemplates.set(verdict.def.name, verdict.def);
    return { annotation: { template: verdict.def.name }, omitted };
  }
  if (verdict.kind !== 'builtin') return { omitted };

  switch (verdict.paramSpec) {
    case 'titleSubtitle': {
      const sub = entries.find((e) => e.rawType === 'subTitle');
      const subtitle = sub ? cleanParamText(sub.texts.join(' ')) : '';
      // The subtitle moves into the card; keep it out of the bullets.
      if (sub && subtitle) omitted.add(sub);
      return {
        annotation: {
          template: verdict.template,
          ...(subtitle ? { params: { subtitle } } : {}),
        },
        omitted,
      };
    }
    case 'comparisonPairs': {
      if (!verdict.columns) return { omitted };
      const textAt = (idx: number | undefined): string[] =>
        idx === undefined ? [] : (entries.find((e) => e.idx === idx)?.texts ?? []);
      const side = (idxs: number[]): string => {
        const header = cleanParamText(textAt(idxs[0])[0] ?? '');
        const body = cleanParamText(textAt(idxs[1])[0] ?? '');
        return header ? (body ? `${header}|${body}` : header) : '';
      };
      const left = side(verdict.columns.left);
      const right = side(verdict.columns.right);
      // twoColumn requires both labels — a bare annotation renders nothing.
      if (!left || !right) return { omitted };
      return { annotation: { template: 'twoColumn', params: { left, right } }, omitted };
    }
    case 'featureImage': {
      const image = images[0];
      if (!image) return { omitted };
      const params: Record<string, string> = { imageSrc: image.url };
      if (image.alt && image.alt !== 'Image') params.imageAlt = cleanParamText(image.alt);
      return { annotation: { template: verdict.template, params }, omitted };
    }
    case 'photoGridGate': {
      if (images.length < 2) return { omitted };
      return {
        annotation: {
          template: 'photoGrid',
          params: { images: images.map((i) => i.url).join(',') },
        },
        omitted,
      };
    }
    default:
      return { annotation: { template: verdict.template }, omitted };
  }
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
  const entries: SlideTextEntry[] = [];
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
      continue;
    }
    const phs = sp.getElementsByTagNameNS(NS_PML, 'ph');
    const rawType = phs.length ? (phs[0]!.getAttribute('type') ?? '') : '';
    const idxRaw = phs.length ? phs[0]!.getAttribute('idx') : null;
    const idx = idxRaw ? parseInt(idxRaw, 10) || 0 : 0;
    entries.push({ rawType, idx, texts });
  }

  // Images are extracted before annotation building so feature/photoGrid
  // params can reference their container paths; they still land after the
  // bullet list in the output, unchanged.
  const images = ctx.extractImages ? await extractSlideImages(doc, path, ctx) : [];

  const layoutPath = ctx.inference?.layoutPathBySlide.get(path);
  const analyzed = layoutPath ? ctx.inference?.byLayoutPath.get(layoutPath) : undefined;
  const { annotation, omitted } = buildSlideAnnotation(analyzed, entries, images, ctx);

  out.push({
    type: 'heading',
    depth: 2,
    children: [{ type: 'text', value: title || `Slide ${index + 1}` }],
    ...(annotation ? { templateAnnotation: annotation } : {}),
  });

  const bullets = entries.filter((e) => !omitted.has(e)).flatMap((e) => e.texts);
  if (bullets.length > 0) {
    const items: MarkdownListItem[] = bullets.map((text) => ({
      type: 'listItem',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
    }));
    out.push({ type: 'list', ordered: false, children: items });
  }

  // Embedded pictures land after the bullet list and before any tables.
  for (const image of images) {
    out.push({ type: 'paragraph', children: [image] });
  }

  const tbls = doc.getElementsByTagNameNS(NS_DRAWINGML, 'tbl');
  for (let t = 0; t < tbls.length; t++) out.push(tableToMarkdown(tbls[t]!));

  return out;
}

function warnInferenceFailure(step: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`pptx import: ${step} failed; importing without it — ${message}`);
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
    usedCustomTemplates: new Map(),
  };

  const inferTheme = options.inferTheme !== false;
  const inferLayouts = options.inferLayouts !== false;

  // All inference modules load lazily so a plain import stays light, and
  // every inference step degrades to a warning rather than failing the import.
  let extraction: ExtractedFileTheme | null = null;
  if (inferTheme || inferLayouts) {
    try {
      const { extractPptxTheme } = await import('../infer/extract.js');
      extraction = await extractPptxTheme(pkg);
    } catch (err: unknown) {
      warnInferenceFailure('theme extraction', err);
    }
  }

  let theme: Theme | undefined;
  if (inferTheme && extraction) {
    try {
      const { compileExtractedTheme } = await import('../infer/mapTheme.js');
      theme = compileExtractedTheme(extraction).theme;
    } catch (err: unknown) {
      warnInferenceFailure('theme compilation', err);
    }
  }

  if (inferLayouts) {
    try {
      const { analyzePptxLayouts } = await import('./layouts.js');
      const { colorHintsFromExtraction } = await import('../infer/mapTheme.js');
      ctx.inference = await analyzePptxLayouts(pkg, {
        colors: extraction ? colorHintsFromExtraction(extraction) : {},
      });
    } catch (err: unknown) {
      warnInferenceFailure('layout inference', err);
    }
  }

  const paths = await orderedSlidePaths(pkg, requireMainPartPath(pkg, PPTX_MAIN_PART, 'PPTX'));
  const children: MarkdownBlockNode[] = [];
  for (let i = 0; i < paths.length; i++) {
    children.push(...(await convertSlide(paths[i]!, i, ctx)));
  }
  const doc: MarkdownDocument = { type: 'document', children };

  const frontmatter: Record<string, unknown> = {};
  if (theme || ctx.usedCustomTemplates.size > 0) {
    const {
      writeCustomThemesToFrontmatter,
      writeCustomTemplatesToFrontmatter,
      FRONTMATTER_CUSTOM_THEMES_KEY,
      FRONTMATTER_CUSTOM_TEMPLATES_KEY,
    } = await import('@bendyline/squisq/doc');
    if (theme) {
      const payload = writeCustomThemesToFrontmatter([theme]);
      if (payload) {
        frontmatter[FRONTMATTER_CUSTOM_THEMES_KEY] = payload;
        // The doc-level selector `resolveThemeForDoc` reads — activates the
        // inferred theme without any global registration.
        frontmatter['squisq-theme'] = theme.id;
      }
    }
    if (ctx.usedCustomTemplates.size > 0) {
      const payload = writeCustomTemplatesToFrontmatter([...ctx.usedCustomTemplates.values()]);
      if (payload) frontmatter[FRONTMATTER_CUSTOM_TEMPLATES_KEY] = payload;
    }
  }
  if (Object.keys(frontmatter).length > 0) doc.frontmatter = frontmatter;

  return { doc, ctx };
}

export async function pptxToMarkdownDoc(
  data: ArrayBuffer | Blob,
  options: PptxImportOptions = {},
): Promise<MarkdownDocument> {
  const pkg = await openPackage(data, options);
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
  const pkg = await openPackage(data, options);
  const { doc, ctx } = await importDocument(pkg, { ...options, extractImages: true });

  return buildContainer(stringifyMarkdown(doc), ctx.extractedImages);
}
