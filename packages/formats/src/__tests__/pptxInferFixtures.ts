/**
 * Programmatic OOXML fixtures for theme/layout inference tests: themed PPTX
 * decks (theme + master + layouts + slides, fully wired relationships) plus
 * minimal themed DOCX/XLSX packages. Built with the package's own writer —
 * no binary fixtures checked in.
 */

import {
  CONTENT_TYPE_DOCX_DOCUMENT,
  CONTENT_TYPE_PPTX_PRESENTATION,
  CONTENT_TYPE_PPTX_SLIDE,
  CONTENT_TYPE_PPTX_SLIDE_LAYOUT,
  CONTENT_TYPE_PPTX_SLIDE_MASTER,
  CONTENT_TYPE_PPTX_THEME,
  CONTENT_TYPE_XLSX_WORKBOOK,
  NS_DRAWINGML,
  NS_PML,
  NS_R,
  NS_WML,
  REL_OFFICE_DOCUMENT,
  REL_SLIDE,
  REL_SLIDE_LAYOUT,
  REL_SLIDE_MASTER,
  REL_THEME,
} from '../ooxml/namespaces';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';

export const SLDSZ = { cx: 12192000, cy: 6858000 };

// ── Theme XML ────────────────────────────────────────────────────────

export interface ThemeXmlOptions {
  name?: string;
  dk1?: string; // inner color XML, e.g. '<a:srgbClr val="111111"/>'
  lt1?: string;
  dk2?: string;
  lt2?: string;
  accents?: string[]; // hex values without '#', accent1..N (missing slots omitted)
  hlink?: string;
  majorFont?: string;
  minorFont?: string;
  omitFontScheme?: boolean;
}

export function buildThemeXml(opts: ThemeXmlOptions = {}): string {
  const accents = opts.accents ?? ['4472c4', 'ed7d31', 'a5a5a5', 'ffc000', '5b9bd5', '70ad47'];
  const accentXml = accents
    .map((hex, i) => `<a:accent${i + 1}><a:srgbClr val="${hex}"/></a:accent${i + 1}>`)
    .join('');
  const fontScheme = opts.omitFontScheme
    ? ''
    : `<a:fontScheme name="Test">` +
      `<a:majorFont><a:latin typeface="${opts.majorFont ?? 'Playfair Display'}"/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="${opts.minorFont ?? 'Aptos'}"/></a:minorFont>` +
      `</a:fontScheme>`;
  return (
    xmlDeclaration() +
    `<a:theme xmlns:a="${NS_DRAWINGML}" name="${opts.name ?? 'Fixture Theme'}">` +
    `<a:themeElements>` +
    `<a:clrScheme name="Test">` +
    `<a:dk1>${opts.dk1 ?? '<a:srgbClr val="1a1a2e"/>'}</a:dk1>` +
    `<a:lt1>${opts.lt1 ?? '<a:srgbClr val="fdfdf8"/>'}</a:lt1>` +
    `<a:dk2>${opts.dk2 ?? '<a:srgbClr val="30304a"/>'}</a:dk2>` +
    `<a:lt2>${opts.lt2 ?? '<a:srgbClr val="efefe4"/>'}</a:lt2>` +
    accentXml +
    `<a:hlink>${opts.hlink ?? '<a:srgbClr val="0563c1"/>'}</a:hlink>` +
    `<a:folHlink><a:srgbClr val="954f72"/></a:folHlink>` +
    `</a:clrScheme>` +
    fontScheme +
    `</a:themeElements>` +
    `</a:theme>`
  );
}

// ── PresentationML fragments ─────────────────────────────────────────

export interface PhSpOptions {
  /** ph@type; omit for a plain body placeholder. */
  type?: string;
  idx?: number;
  /** EMU geometry; omit xfrm entirely when absent. */
  rect?: { x: number; y: number; cx: number; cy: number };
  /** a:lvl1pPr defRPr attributes, e.g. 'sz="4400" b="1"'. */
  lvl1DefRPr?: string;
  /** ph@orient value (e.g. 'vert'). */
  orient?: string;
}

/** A placeholder `p:sp` for a layout/master/slide part. */
export function phSp(opts: PhSpOptions, id = 2): string {
  const typeAttr = opts.type ? ` type="${opts.type}"` : '';
  const idxAttr = opts.idx !== undefined ? ` idx="${opts.idx}"` : '';
  const orientAttr = opts.orient ? ` orient="${opts.orient}"` : '';
  const xfrm = opts.rect
    ? `<a:xfrm><a:off x="${opts.rect.x}" y="${opts.rect.y}"/>` +
      `<a:ext cx="${opts.rect.cx}" cy="${opts.rect.cy}"/></a:xfrm>`
    : '';
  const lstStyle = opts.lvl1DefRPr
    ? `<a:lstStyle><a:lvl1pPr><a:defRPr ${opts.lvl1DefRPr}/></a:lvl1pPr></a:lstStyle>`
    : `<a:lstStyle/>`;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="ph${id}"/><p:cNvSpPr/>` +
    `<p:nvPr><p:ph${typeAttr}${idxAttr}${orientAttr}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrm}</p:spPr>` +
    `<p:txBody><a:bodyPr/>${lstStyle}<a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`
  );
}

export interface LayoutXmlOptions {
  name?: string;
  type?: string;
  /** Raw p:sp strings (use phSp / decorSp). */
  shapes?: string[];
}

export function layoutXml(opts: LayoutXmlOptions = {}): string {
  const typeAttr = opts.type ? ` type="${opts.type}"` : '';
  return (
    xmlDeclaration() +
    `<p:sldLayout xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}"${typeAttr}>` +
    `<p:cSld${opts.name !== undefined ? ` name="${opts.name}"` : ''}><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    (opts.shapes ?? []).join('') +
    `</p:spTree></p:cSld></p:sldLayout>`
  );
}

export interface SlideTextShape {
  phType?: string;
  phIdx?: number;
  texts: string[];
}

/** A slide with a title shape plus arbitrary placeholder text shapes. */
export function slideXml(title: string | null, shapes: SlideTextShape[] = []): string {
  const titleSp = title
    ? `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>`
    : '';
  const bodySps = shapes
    .map((s) => {
      const typeAttr = s.phType ? ` type="${s.phType}"` : '';
      const idxAttr = s.phIdx !== undefined ? ` idx="${s.phIdx}"` : '';
      const paras = s.texts.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('');
      return (
        `<p:sp><p:nvSpPr><p:nvPr><p:ph${typeAttr}${idxAttr}/></p:nvPr></p:nvSpPr>` +
        `<p:txBody>${paras}</p:txBody></p:sp>`
      );
    })
    .join('');
  return (
    xmlDeclaration() +
    `<p:sld xmlns:p="${NS_PML}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}"><p:cSld><p:spTree>` +
    titleSp +
    bodySps +
    `</p:spTree></p:cSld></p:sld>`
  );
}

// ── Whole-deck builder ───────────────────────────────────────────────

export interface FixtureSlide {
  xml: string;
  /** Index into `layouts`; omit for a slide with no layout relationship. */
  layoutIndex?: number;
  /** Extra relationships for this slide (e.g. image embeds). */
  rels?: Array<{ id: string; type: string; target: string }>;
  /** Binary media parts referenced by `rels`, keyed by package path. */
  media?: Array<{ path: string; data: Uint8Array; contentType: string }>;
}

export interface ThemedPptxOptions {
  themeXml?: string | null; // null = omit the theme part entirely
  /** Attribute string for <p:clrMap …/>; default light mapping. */
  clrMapAttrs?: string;
  /** Raw p:sp strings placed in the master's spTree (for inheritance tests). */
  masterShapes?: string[];
  layouts?: string[]; // layout part XMLs (layoutXml())
  slides?: FixtureSlide[];
  sldSz?: { cx: number; cy: number };
}

export async function buildThemedPptx(opts: ThemedPptxOptions = {}): Promise<ArrayBuffer> {
  const pkg = createPackage();
  const slides = opts.slides ?? [{ xml: slideXml('My Title', [{ texts: ['First bullet'] }]) }];
  const layouts = opts.layouts ?? [];
  const sldSz = opts.sldSz ?? SLDSZ;

  const sldIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('');
  pkg.addPart(
    'ppt/presentation.xml',
    `${xmlDeclaration()}<p:presentation xmlns:p="${NS_PML}" xmlns:r="${NS_R}">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${sldIds}</p:sldIdLst>` +
      `<p:sldSz cx="${sldSz.cx}" cy="${sldSz.cy}"/>` +
      `</p:presentation>`,
    CONTENT_TYPE_PPTX_PRESENTATION,
  );
  pkg.addRelationship('', {
    id: 'rId1',
    type: REL_OFFICE_DOCUMENT,
    target: 'ppt/presentation.xml',
  });
  pkg.addRelationship('ppt/presentation.xml', {
    id: 'rIdM1',
    type: REL_SLIDE_MASTER,
    target: 'slideMasters/slideMaster1.xml',
  });

  // Master (carries the clrMap + optional inheritable placeholder geometry).
  const layoutIds = layouts
    .map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rIdL${i + 1}"/>`)
    .join('');
  pkg.addPart(
    'ppt/slideMasters/slideMaster1.xml',
    `${xmlDeclaration()}<p:sldMaster xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}">` +
      `<p:cSld name="Fixture Master"><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      (opts.masterShapes ?? []).join('') +
      `</p:spTree></p:cSld>` +
      `<p:clrMap ${opts.clrMapAttrs ?? 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"'}` +
      ` accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4"` +
      ` accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
      `<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>` +
      `</p:sldMaster>`,
    CONTENT_TYPE_PPTX_SLIDE_MASTER,
  );

  if (opts.themeXml !== null) {
    pkg.addPart('ppt/theme/theme1.xml', opts.themeXml ?? buildThemeXml(), CONTENT_TYPE_PPTX_THEME);
    pkg.addRelationship('ppt/slideMasters/slideMaster1.xml', {
      id: 'rIdT1',
      type: REL_THEME,
      target: '../theme/theme1.xml',
    });
  }

  layouts.forEach((xml, i) => {
    const path = `ppt/slideLayouts/slideLayout${i + 1}.xml`;
    pkg.addPart(path, xml, CONTENT_TYPE_PPTX_SLIDE_LAYOUT);
    pkg.addRelationship('ppt/slideMasters/slideMaster1.xml', {
      id: `rIdL${i + 1}`,
      type: REL_SLIDE_LAYOUT,
      target: `../slideLayouts/slideLayout${i + 1}.xml`,
    });
    pkg.addRelationship(path, {
      id: 'rIdM1',
      type: REL_SLIDE_MASTER,
      target: '../slideMasters/slideMaster1.xml',
    });
  });

  slides.forEach((slide, i) => {
    const path = `ppt/slides/slide${i + 1}.xml`;
    pkg.addPart(path, slide.xml, CONTENT_TYPE_PPTX_SLIDE);
    pkg.addRelationship('ppt/presentation.xml', {
      id: `rIdS${i + 1}`,
      type: REL_SLIDE,
      target: `slides/slide${i + 1}.xml`,
    });
    if (slide.layoutIndex !== undefined) {
      pkg.addRelationship(path, {
        id: 'rIdLo1',
        type: REL_SLIDE_LAYOUT,
        target: `../slideLayouts/slideLayout${slide.layoutIndex + 1}.xml`,
      });
    }
    for (const rel of slide.rels ?? []) pkg.addRelationship(path, rel);
    for (const media of slide.media ?? []) {
      pkg.addBinaryPart(media.path, media.data, media.contentType);
    }
  });

  return pkg.toArrayBuffer();
}

// ── DOCX / XLSX minimal themed packages ──────────────────────────────

export async function buildThemedDocx(themeXml?: string): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    'word/document.xml',
    `${xmlDeclaration()}<w:document xmlns:w="${NS_WML}"><w:body>` +
      `<w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
    CONTENT_TYPE_DOCX_DOCUMENT,
  );
  pkg.addPart('word/theme/theme1.xml', themeXml ?? buildThemeXml(), CONTENT_TYPE_PPTX_THEME);
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' });
  pkg.addRelationship('word/document.xml', {
    id: 'rId2',
    type: REL_THEME,
    target: 'theme/theme1.xml',
  });
  return pkg.toArrayBuffer();
}

export async function buildThemedXlsx(themeXml?: string): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheets/></workbook>`,
    CONTENT_TYPE_XLSX_WORKBOOK,
  );
  pkg.addPart('xl/theme/theme1.xml', themeXml ?? buildThemeXml(), CONTENT_TYPE_PPTX_THEME);
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId2',
    type: REL_THEME,
    target: 'theme/theme1.xml',
  });
  return pkg.toArrayBuffer();
}
