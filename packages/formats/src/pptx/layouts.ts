/**
 * PPTX slide-layout inference — reads the layouts/masters a deck actually
 * uses and, per layout, either matches it to a close built-in Squisq
 * template (title, sectionHeader, twoColumn, leftFeature, …) or generates a
 * reusable `CustomTemplateDefinition` from its placeholder geometry.
 *
 * The classifier is a deterministic three-stage waterfall — the layout's
 * `type` attribute, then well-known layout names, then placeholder-set
 * geometry — biased toward *not* templating: a title over a single body
 * flows better as plain markdown, and only genuinely distinctive geometry
 * (side-by-side content, positioned picture placeholders) becomes a custom
 * template.
 *
 * Shared by the PPTX importer (`inferLayouts`) and the theme dialog's
 * `inspectPptxLayouts` — one implementation, two consumers.
 */

import type {
  CustomTemplateDefinition,
  CustomTemplateLayer,
  ImageLayer,
  Position,
  ShapeLayer,
  TextLayer,
  TextStyle,
} from '@bendyline/squisq/schemas';
import { getPartRelationships, getPartXml, openPackage } from '../ooxml/reader.js';
import type { OoxmlPackage } from '../ooxml/types.js';
import {
  CONTENT_TYPE_PPTX_SLIDE_LAYOUT,
  NS_DRAWINGML,
  NS_PML,
  NS_R,
  REL_SLIDE_LAYOUT,
  REL_SLIDE_MASTER,
} from '../ooxml/namespaces.js';
import { attrNS, baseDirOf, findRelByType, resolveTarget } from '../ooxml/readUtils.js';

// ── Public types ─────────────────────────────────────────────────────

export interface EmuRect {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

/** Percent-of-slide rect, 0–100 per axis (2-decimal precision). */
export interface PctRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PlaceholderKind =
  | 'title'
  | 'subtitle'
  | 'text'
  | 'picture'
  | 'table'
  | 'chart'
  | 'other';

export interface PlaceholderTextStyle {
  fontSizePt?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  anchor?: 'top' | 'middle' | 'bottom';
}

export interface ExtractedPlaceholder {
  kind: PlaceholderKind;
  /** `p:ph@type` verbatim ('' when absent — spec default is body). */
  rawType: string;
  /** `p:ph@idx`, default 0. */
  idx: number;
  /** Geometry resolved through the layout→master inheritance chain. */
  rect: PctRect;
  inheritedFromMaster: boolean;
  vertical: boolean;
  textStyle?: PlaceholderTextStyle;
}

export interface ExtractedDecoration {
  shape: 'rect' | 'line';
  rect: PctRect;
  fill?: string;
  stroke?: string;
  strokeWidthPx?: number;
  borderRadius?: number;
}

export interface ExtractedSlideLayout {
  partPath: string;
  /** `p:cSld@name` ('' when absent). */
  name: string;
  /** `p:sldLayout@type` (ST_SlideLayoutType) when present. */
  typeAttr?: string;
  masterPath?: string;
  masterName?: string;
  /** Content placeholders — dt/ftr/sldNum/hdr chrome already excluded. */
  placeholders: ExtractedPlaceholder[];
  decorations: ExtractedDecoration[];
  /** Number of slides in this deck using this layout (0 = defined but unused). */
  slideCount: number;
}

/** Scheme-color hints for decoration fills, supplied by theme extraction. */
export interface PptxColorHints {
  text?: string;
  background?: string;
  /** `a:schemeClr@val` (accent1…, bg1, tx1, dk1, …) → resolved hex. */
  schemeColors?: Record<string, string>;
}

export type BuiltinParamSpec =
  | 'titleSubtitle'
  | 'comparisonPairs'
  | 'featureImage'
  | 'photoGridGate';

export type LayoutVerdict =
  | { kind: 'plain' }
  | { kind: 'skip' }
  | {
      kind: 'builtin';
      template: string;
      paramSpec?: BuiltinParamSpec;
      /** For `comparisonPairs`: placeholder idx lists per column, top-to-bottom. */
      columns?: { left: number[]; right: number[] };
    }
  | { kind: 'custom'; def: CustomTemplateDefinition };

export interface AnalyzedLayout {
  extracted: ExtractedSlideLayout;
  verdict: LayoutVerdict;
  /** Human-readable caveats: dropped regions, unsupported placeholders, … */
  notes: string[];
}

export interface PptxLayoutInference {
  slideSize: { cx: number; cy: number };
  layouts: AnalyzedLayout[];
  byLayoutPath: Map<string, AnalyzedLayout>;
  layoutPathBySlide: Map<string, string>;
  warnings: string[];
}

export interface AnalyzePptxLayoutsOptions {
  /** Also analyze layouts no slide references (default false). */
  includeUnused?: boolean;
  colors?: PptxColorHints;
  /** Cap on generated custom templates (default 12); excess downgrades to plain. */
  maxTemplates?: number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_SLIDE_SIZE = { cx: 12192000, cy: 6858000 };
const CHROME_PH_TYPES = new Set(['dt', 'ftr', 'sldNum', 'hdr']);
const MAX_INFERRED_TEMPLATES = 12;
const MAX_DECORATIONS = 4;
/** Decorative rects smaller than this share of the slide are clutter. */
const MIN_DECORATION_AREA_PCT = 2;

/** Default rects mirroring the exporter's slide proportions (percent). */
const DEFAULT_TITLE_RECT: PctRect = { x: 5, y: 4, w: 90, h: 16.7 };
const DEFAULT_BODY_RECT: PctRect = { x: 5, y: 23.3, w: 90, h: 66 };

const DEFAULT_TITLE_PT = 44;
const DEFAULT_SUBTITLE_PT = 24;
const DEFAULT_BODY_PT = 22;

// ── Small helpers ────────────────────────────────────────────────────

function firstPml(parent: Element | Document, local: string): Element | null {
  const els = parent.getElementsByTagNameNS(NS_PML, local);
  return els.length > 0 ? els[0]! : null;
}

function firstDml(parent: Element | Document, local: string): Element | null {
  const els = parent.getElementsByTagNameNS(NS_DRAWINGML, local);
  return els.length > 0 ? els[0]! : null;
}

function intAttr(el: Element | null, name: string): number | undefined {
  const raw = el?.getAttribute(name);
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function pct(value: number, total: number): number {
  const raw = (value / total) * 100;
  const clamped = Math.max(-10, Math.min(110, raw));
  return Math.round(clamped * 100) / 100;
}

function emuToPct(rect: EmuRect, sldSz: { cx: number; cy: number }): PctRect {
  return {
    x: pct(rect.x, sldSz.cx),
    y: pct(rect.y, sldSz.cy),
    w: pct(rect.cx, sldSz.cx),
    h: pct(rect.cy, sldSz.cy),
  };
}

/** Read `a:xfrm` (off + ext) under a shape's `p:spPr`. Degenerate extents count as missing. */
function readXfrm(sp: Element): EmuRect | null {
  const spPr = firstPml(sp, 'spPr');
  if (!spPr) return null;
  const xfrm = firstDml(spPr, 'xfrm');
  if (!xfrm) return null;
  const off = firstDml(xfrm, 'off');
  const ext = firstDml(xfrm, 'ext');
  const x = intAttr(off, 'x');
  const y = intAttr(off, 'y');
  const cx = intAttr(ext, 'cx');
  const cy = intAttr(ext, 'cy');
  if (x === undefined || y === undefined || cx === undefined || cy === undefined) return null;
  if (cx <= 0 || cy <= 0) return null;
  return { x, y, cx, cy };
}

function placeholderKind(rawType: string): PlaceholderKind {
  switch (rawType) {
    case 'title':
    case 'ctrTitle':
      return 'title';
    case 'subTitle':
      return 'subtitle';
    case '':
    case 'body':
    case 'obj':
      return 'text';
    case 'pic':
    case 'clipArt':
    case 'media':
      return 'picture';
    case 'tbl':
      return 'table';
    case 'chart':
    case 'dgm':
      return 'chart';
    default:
      return 'other';
  }
}

/** Collapse a ph type onto the master-matching base type (ECMA-376 inheritance). */
function basePhType(rawType: string): string {
  switch (rawType) {
    case 'ctrTitle':
      return 'title';
    case '':
    case 'subTitle':
    case 'obj':
    case 'pic':
    case 'clipArt':
    case 'media':
    case 'tbl':
    case 'chart':
    case 'dgm':
      return 'body';
    default:
      return rawType;
  }
}

function parseLvl1Style(container: Element): PlaceholderTextStyle | undefined {
  const lvl1 = firstDml(container, 'lvl1pPr');
  if (!lvl1) return undefined;
  const style: PlaceholderTextStyle = {};
  const algn = lvl1.getAttribute('algn');
  if (algn === 'ctr') style.align = 'center';
  else if (algn === 'r') style.align = 'right';
  else if (algn === 'l') style.align = 'left';
  const defRPr = firstDml(lvl1, 'defRPr');
  const sz = intAttr(defRPr, 'sz');
  if (sz !== undefined && sz > 0) style.fontSizePt = sz / 100;
  const b = defRPr?.getAttribute('b');
  if (b === '1' || b === 'true') style.bold = true;
  else if (b === '0' || b === 'false') style.bold = false;
  return Object.keys(style).length > 0 ? style : undefined;
}

function mergeTextStyle(
  primary: PlaceholderTextStyle | undefined,
  fallback: PlaceholderTextStyle | undefined,
): PlaceholderTextStyle | undefined {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    fontSizePt: primary.fontSizePt ?? fallback.fontSizePt,
    bold: primary.bold ?? fallback.bold,
    align: primary.align ?? fallback.align,
    anchor: primary.anchor ?? fallback.anchor,
  };
}

// ── Master placeholder index ─────────────────────────────────────────

interface MasterEntry {
  rect: EmuRect | null;
  style?: PlaceholderTextStyle;
}

interface MasterIndex {
  name: string;
  exact: Map<string, MasterEntry>;
  baseIdx: Map<string, MasterEntry>;
  base: Map<string, MasterEntry>;
  titleStyle?: PlaceholderTextStyle;
  bodyStyle?: PlaceholderTextStyle;
}

async function readMasterIndex(pkg: OoxmlPackage, masterPath: string): Promise<MasterIndex> {
  const index: MasterIndex = { name: '', exact: new Map(), baseIdx: new Map(), base: new Map() };
  const doc = await getPartXml(pkg, masterPath);
  if (!doc) return index;

  index.name = firstPml(doc, 'cSld')?.getAttribute('name')?.trim() ?? '';

  const txStyles = firstPml(doc, 'txStyles');
  if (txStyles) {
    const titleStyle = firstPml(txStyles, 'titleStyle');
    const bodyStyle = firstPml(txStyles, 'bodyStyle');
    if (titleStyle) index.titleStyle = parseLvl1Style(titleStyle);
    if (bodyStyle) index.bodyStyle = parseLvl1Style(bodyStyle);
  }

  const shapes = doc.getElementsByTagNameNS(NS_PML, 'sp');
  for (let i = 0; i < shapes.length; i++) {
    const sp = shapes[i]!;
    const ph = firstPml(sp, 'ph');
    if (!ph) continue;
    const rawType = ph.getAttribute('type') ?? '';
    const idx = intAttr(ph, 'idx') ?? 0;
    const entry: MasterEntry = { rect: readXfrm(sp) };
    const txBody = firstPml(sp, 'txBody');
    const lstStyle = txBody ? firstDml(txBody, 'lstStyle') : null;
    if (lstStyle) entry.style = parseLvl1Style(lstStyle);

    const typeKey = `${rawType || 'body'}:${idx}`;
    if (!index.exact.has(typeKey)) index.exact.set(typeKey, entry);
    const base = basePhType(rawType);
    const baseIdxKey = `${base}:${idx}`;
    if (!index.baseIdx.has(baseIdxKey)) index.baseIdx.set(baseIdxKey, entry);
    if (!index.base.has(base)) index.base.set(base, entry);
  }
  return index;
}

// ── Layout extraction ────────────────────────────────────────────────

function resolveFillColor(solidFill: Element, hints: PptxColorHints): string | undefined {
  const srgb = firstDml(solidFill, 'srgbClr');
  const srgbVal = srgb?.getAttribute('val');
  if (srgbVal && /^[0-9a-fA-F]{6}$/.test(srgbVal)) return `#${srgbVal.toLowerCase()}`;
  const scheme = firstDml(solidFill, 'schemeClr');
  const schemeVal = scheme?.getAttribute('val');
  if (schemeVal && hints.schemeColors?.[schemeVal]) return hints.schemeColors[schemeVal];
  return undefined;
}

/** Direct child element of `parent` with the given DrawingML local name. */
function directDmlChild(parent: Element, local: string): Element | null {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child && child.nodeType === 1 && (child as Element).localName === local) {
      const el = child as Element;
      if (el.namespaceURI === NS_DRAWINGML) return el;
    }
  }
  return null;
}

function extractDecoration(
  sp: Element,
  sldSz: { cx: number; cy: number },
  pxPerPt: number,
  hints: PptxColorHints,
): ExtractedDecoration | null {
  const rectEmu = readXfrm(sp);
  if (!rectEmu) return null;
  const spPr = firstPml(sp, 'spPr');
  if (!spPr) return null;
  const prst = firstDml(spPr, 'prstGeom')?.getAttribute('prst');

  if (prst === 'line' || prst === 'straightConnector1') {
    const ln = directDmlChild(spPr, 'ln');
    const lnFill = ln ? directDmlChild(ln, 'solidFill') : null;
    const stroke = lnFill ? resolveFillColor(lnFill, hints) : undefined;
    if (!stroke) return null;
    const wEmu = intAttr(ln, 'w');
    const strokeWidthPx = wEmu
      ? Math.max(1, Math.min(40, Math.round((wEmu / 12700) * pxPerPt)))
      : 2;
    return { shape: 'line', rect: emuToPct(rectEmu, sldSz), stroke, strokeWidthPx };
  }

  if (prst === 'rect' || prst === 'roundRect') {
    const solidFill = directDmlChild(spPr, 'solidFill');
    const fill = solidFill ? resolveFillColor(solidFill, hints) : undefined;
    if (!fill) return null;
    const areaPct = ((rectEmu.cx * rectEmu.cy) / (sldSz.cx * sldSz.cy)) * 100;
    if (areaPct < MIN_DECORATION_AREA_PCT) return null;
    return {
      shape: 'rect',
      rect: emuToPct(rectEmu, sldSz),
      fill,
      ...(prst === 'roundRect' ? { borderRadius: 8 } : {}),
    };
  }

  return null;
}

async function extractLayout(
  pkg: OoxmlPackage,
  layoutPath: string,
  sldSz: { cx: number; cy: number },
  pxPerPt: number,
  hints: PptxColorHints,
  masterCache: Map<string, Promise<MasterIndex>>,
): Promise<ExtractedSlideLayout | null> {
  const doc = await getPartXml(pkg, layoutPath);
  if (!doc) return null;

  const name = firstPml(doc, 'cSld')?.getAttribute('name')?.trim() ?? '';
  const typeAttr = doc.documentElement?.getAttribute('type') ?? undefined;

  let masterPath: string | undefined;
  let master: MasterIndex | undefined;
  const layoutRels = await getPartRelationships(pkg, layoutPath);
  const masterRel = findRelByType(layoutRels, REL_SLIDE_MASTER);
  if (masterRel) {
    masterPath = resolveTarget(baseDirOf(layoutPath), masterRel.target);
    let cached = masterCache.get(masterPath);
    if (!cached) {
      cached = readMasterIndex(pkg, masterPath);
      masterCache.set(masterPath, cached);
    }
    master = await cached;
  }

  const placeholders: ExtractedPlaceholder[] = [];
  const decorations: ExtractedDecoration[] = [];

  const shapes = doc.getElementsByTagNameNS(NS_PML, 'sp');
  for (let i = 0; i < shapes.length; i++) {
    const sp = shapes[i]!;
    const ph = firstPml(sp, 'ph');

    if (!ph) {
      if (decorations.length < MAX_DECORATIONS) {
        const decoration = extractDecoration(sp, sldSz, pxPerPt, hints);
        if (decoration) decorations.push(decoration);
      }
      continue;
    }

    const rawType = ph.getAttribute('type') ?? '';
    if (CHROME_PH_TYPES.has(rawType)) continue;
    const idx = intAttr(ph, 'idx') ?? 0;
    const kind = placeholderKind(rawType);

    // Geometry: own xfrm → master by (type, idx) → by (base, idx) → by base → defaults.
    const own = readXfrm(sp);
    let rectEmu = own;
    let inheritedFromMaster = false;
    if (!rectEmu && master) {
      const base = basePhType(rawType);
      const entry =
        master.exact.get(`${rawType || 'body'}:${idx}`) ??
        master.baseIdx.get(`${base}:${idx}`) ??
        master.base.get(base);
      if (entry?.rect) {
        rectEmu = entry.rect;
        inheritedFromMaster = true;
      }
    }
    const rect = rectEmu
      ? emuToPct(rectEmu, sldSz)
      : kind === 'title'
        ? { ...DEFAULT_TITLE_RECT }
        : { ...DEFAULT_BODY_RECT };

    // Text style: layout lstStyle → master ph style → master txStyles.
    const txBody = firstPml(sp, 'txBody');
    const lstStyle = txBody ? firstDml(txBody, 'lstStyle') : null;
    let textStyle = lstStyle ? parseLvl1Style(lstStyle) : undefined;
    if (master) {
      const base = basePhType(rawType);
      const masterEntry =
        master.exact.get(`${rawType || 'body'}:${idx}`) ?? master.baseIdx.get(`${base}:${idx}`);
      textStyle = mergeTextStyle(textStyle, masterEntry?.style);
      textStyle = mergeTextStyle(
        textStyle,
        kind === 'title' || kind === 'subtitle' ? master.titleStyle : master.bodyStyle,
      );
    }

    const bodyPr = txBody ? firstDml(txBody, 'bodyPr') : null;
    const anchor = bodyPr?.getAttribute('anchor');
    if (anchor === 't' || anchor === 'ctr' || anchor === 'b') {
      textStyle = {
        ...(textStyle ?? {}),
        anchor: anchor === 't' ? 'top' : anchor === 'ctr' ? 'middle' : 'bottom',
      };
    }

    const orient = ph.getAttribute('orient');
    const vert = bodyPr?.getAttribute('vert');
    const vertical = orient === 'vert' || (!!vert && vert !== 'horz');

    placeholders.push({
      kind,
      rawType,
      idx,
      rect,
      inheritedFromMaster,
      vertical,
      ...(textStyle ? { textStyle } : {}),
    });
  }

  return {
    partPath: layoutPath,
    name,
    ...(typeAttr ? { typeAttr } : {}),
    ...(masterPath ? { masterPath } : {}),
    ...(master?.name ? { masterName: master.name } : {}),
    placeholders,
    decorations,
    slideCount: 0,
  };
}

// ── Geometry predicates ──────────────────────────────────────────────

function overlap1D(aStart: number, aLen: number, bStart: number, bLen: number): number {
  return Math.max(0, Math.min(aStart + aLen, bStart + bLen) - Math.max(aStart, bStart));
}

function sideBySide(a: PctRect, b: PctRect): boolean {
  const xOverlap = overlap1D(a.x, a.w, b.x, b.w);
  const yOverlap = overlap1D(a.y, a.h, b.y, b.h);
  return (
    xOverlap <= 0.15 * Math.min(a.w, b.w) &&
    yOverlap >= 0.5 * Math.min(a.h, b.h) &&
    a.w >= 25 &&
    b.w >= 25
  );
}

function stackedAbove(a: PctRect, b: PctRect): boolean {
  const xOverlap = overlap1D(a.x, a.w, b.x, b.w);
  const yOverlap = overlap1D(a.y, a.h, b.y, b.h);
  return yOverlap <= 0.15 * Math.min(a.h, b.h) && xOverlap >= 0.5 * Math.min(a.w, b.w) && a.y < b.y;
}

function fullBleed(p: PctRect): boolean {
  return p.w >= 85 && p.h >= 80;
}

function nearEqualWidth(a: PctRect, b: PctRect): boolean {
  return Math.abs(a.w - b.w) <= 0.15 * Math.max(a.w, b.w);
}

function rectsOverlap(a: PctRect, b: PctRect): boolean {
  return overlap1D(a.x, a.w, b.x, b.w) > 2 && overlap1D(a.y, a.h, b.y, b.h) > 2;
}

function centerX(r: PctRect): number {
  return r.x + r.w / 2;
}

// ── Classifier ───────────────────────────────────────────────────────

type Directive =
  | { kind: 'plain' }
  | { kind: 'skip' }
  | { kind: 'builtin'; template: string; paramSpec?: BuiltinParamSpec }
  | { kind: 'feature-by-geometry' }
  | { kind: 'comparison' }
  | { kind: 'custom-two-column' }
  | { kind: 'custom-caption' }
  | { kind: 'custom-generic' }
  | { kind: 'by-geometry' };

const PLAIN_LAYOUT_TYPES = new Set([
  'titleOnly',
  'tx',
  'obj',
  'objOnly',
  'objTx',
  'txOverObj',
  'objOverTx',
  'tbl',
  'chart',
  'dgm',
  'txAndChart',
  'chartAndTx',
  'vertTitleAndTxOverChart',
  'txAndTwoObj',
  'twoObjAndTx',
  'twoObjOverTx',
  'objAndTwoObj',
  'twoObjAndObj',
  'fourObj',
  'vertTx',
  'vertTitleAndTx',
  'clipArtAndVertTx',
]);

function stage1(typeAttr: string | undefined): Directive | null {
  if (!typeAttr || typeAttr === 'cust') return null;
  if (typeAttr === 'title')
    return { kind: 'builtin', template: 'title', paramSpec: 'titleSubtitle' };
  if (typeAttr === 'secHead') return { kind: 'builtin', template: 'sectionHeader' };
  if (typeAttr === 'blank') return { kind: 'skip' };
  if (PLAIN_LAYOUT_TYPES.has(typeAttr)) return { kind: 'plain' };
  if (typeAttr === 'picTx') return { kind: 'feature-by-geometry' };
  if (typeAttr === 'clipArtAndTx' || typeAttr === 'mediaAndTx') {
    return { kind: 'builtin', template: 'leftFeature', paramSpec: 'featureImage' };
  }
  if (typeAttr === 'txAndClipArt' || typeAttr === 'txAndMedia') {
    return { kind: 'builtin', template: 'rightFeature', paramSpec: 'featureImage' };
  }
  if (
    typeAttr === 'twoColTx' ||
    typeAttr === 'twoObj' ||
    typeAttr === 'txAndObj' ||
    typeAttr === 'objAndTx'
  ) {
    return { kind: 'custom-two-column' };
  }
  if (typeAttr === 'twoTxTwoObj') return { kind: 'comparison' };
  // Unknown/future type values fall through to name + geometry stages.
  return null;
}

const WELL_KNOWN_NAMES: Record<string, Directive> = {
  'title slide': { kind: 'builtin', template: 'title', paramSpec: 'titleSubtitle' },
  'section header': { kind: 'builtin', template: 'sectionHeader' },
  'two content': { kind: 'custom-two-column' },
  comparison: { kind: 'comparison' },
  'content with caption': { kind: 'custom-caption' },
  'picture with caption': { kind: 'feature-by-geometry' },
  'title and content': { kind: 'plain' },
  'title only': { kind: 'plain' },
  blank: { kind: 'skip' },
  'vertical title and text': { kind: 'plain' },
  'title and vertical text': { kind: 'plain' },
};

function stage2(name: string): Directive | null {
  return WELL_KNOWN_NAMES[name.trim().toLowerCase()] ?? null;
}

function contentPlaceholders(layout: ExtractedSlideLayout): ExtractedPlaceholder[] {
  return layout.placeholders.filter((p) => p.kind !== 'title' && p.kind !== 'subtitle');
}

function stage3(layout: ExtractedSlideLayout): Directive {
  if (layout.placeholders.some((p) => p.vertical)) return { kind: 'plain' };
  const hasTitle = layout.placeholders.some((p) => p.kind === 'title');
  const content = contentPlaceholders(layout);
  if (content.length === 0) return hasTitle ? { kind: 'plain' } : { kind: 'skip' };

  const texts = content.filter((p) => p.kind === 'text');
  const pictures = content.filter((p) => p.kind === 'picture');
  const others = content.filter((p) => p.kind !== 'text' && p.kind !== 'picture');

  if (pictures.length === 0 && others.length === 0) {
    if (texts.length === 1) return { kind: 'plain' };
    if (texts.length === 2 && sideBySide(texts[0]!.rect, texts[1]!.rect)) {
      return nearEqualWidth(texts[0]!.rect, texts[1]!.rect)
        ? { kind: 'custom-two-column' }
        : { kind: 'custom-caption' };
    }
    if (texts.length === 4 && findComparisonColumns(texts)) return { kind: 'comparison' };
    return { kind: 'plain' };
  }

  if (pictures.length === 1 && others.length === 0) {
    if (texts.length === 0) {
      return fullBleed(pictures[0]!.rect)
        ? { kind: 'builtin', template: 'imageWithCaption', paramSpec: 'featureImage' }
        : { kind: 'custom-generic' };
    }
    return { kind: 'feature-by-geometry' };
  }

  if (
    pictures.length >= 2 &&
    pictures.length <= 4 &&
    texts.length === 0 &&
    others.length === 0 &&
    pictures.every((a, i) => pictures.every((b, j) => i === j || !rectsOverlap(a.rect, b.rect)))
  ) {
    return { kind: 'builtin', template: 'photoGrid', paramSpec: 'photoGridGate' };
  }

  return { kind: 'plain' };
}

/**
 * Detect the Comparison shape: 4 texts forming two side-by-side columns of a
 * short header over a taller body. Returns placeholder idx lists per column,
 * or null when the rects don't form that shape.
 */
function findComparisonColumns(
  texts: ExtractedPlaceholder[],
): { left: number[]; right: number[] } | null {
  if (texts.length !== 4) return null;
  const sorted = [...texts].sort((a, b) => centerX(a.rect) - centerX(b.rect));
  const leftPair = [sorted[0]!, sorted[1]!];
  const rightPair = [sorted[2]!, sorted[3]!];
  const columnWidth = (pair: ExtractedPlaceholder[]) =>
    Math.abs(centerX(pair[0]!.rect) - centerX(pair[1]!.rect));
  if (columnWidth(leftPair) > 10 || columnWidth(rightPair) > 10) return null;
  if (centerX(rightPair[0]!.rect) - centerX(leftPair[1]!.rect) <= 10) return null;

  const orderColumn = (pair: ExtractedPlaceholder[]): number[] | null => {
    const byY = [...pair].sort((a, b) => a.rect.y - b.rect.y);
    const header = byY[0]!;
    const body = byY[1]!;
    if (header.rect.h > 20 || header.rect.y + header.rect.h > body.rect.y + 2) return null;
    return [header.idx, body.idx];
  };
  const left = orderColumn(leftPair);
  const right = orderColumn(rightPair);
  return left && right ? { left, right } : null;
}

// ── Custom template generation ───────────────────────────────────────

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

function pctPosition(rect: PctRect): Position {
  return { x: `${rect.x}%`, y: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` };
}

interface GeneratorContext {
  hints: PptxColorHints;
  pxPerPt: number;
  viewport: { width: number; height: number };
  notes: string[];
}

function fontPx(pt: number | undefined, defaultPt: number, pxPerPt: number): number {
  const sizePt = pt && pt > 0 ? pt : defaultPt;
  return Math.max(16, Math.min(140, Math.round(sizePt * pxPerPt)));
}

function textLayerFor(
  id: string,
  ph: ExtractedPlaceholder,
  text: string,
  role: 'title' | 'subtitle' | 'body',
  gen: GeneratorContext,
): TextLayer {
  const defaultPt =
    role === 'title'
      ? DEFAULT_TITLE_PT
      : role === 'subtitle'
        ? DEFAULT_SUBTITLE_PT
        : DEFAULT_BODY_PT;
  const style: TextStyle = {
    fontSize: fontPx(ph.textStyle?.fontSizePt, defaultPt, gen.pxPerPt),
    color: gen.hints.text ?? '#1a1a1a',
    lineHeight: role === 'title' ? 1.15 : 1.4,
    ...(role === 'title'
      ? { fontWeight: ph.textStyle?.bold === false ? 'normal' : 'bold' }
      : ph.textStyle?.bold
        ? { fontWeight: 'bold' }
        : {}),
    ...(ph.textStyle?.align ? { textAlign: ph.textStyle.align } : {}),
    ...(ph.textStyle?.anchor ? { verticalAlign: ph.textStyle.anchor } : {}),
  };
  return { id, type: 'text', position: pctPosition(ph.rect), content: { text, style } };
}

function imageLayerFor(id: string, ph: ExtractedPlaceholder, imageIndex: number): ImageLayer {
  // {image:N} is 0-based; a layer whose token resolves to no image is
  // dropped whole at render time, so picture placeholders degrade cleanly
  // on slides without pictures.
  return {
    id,
    type: 'image',
    position: pctPosition(ph.rect),
    content: { src: `{image:${imageIndex}}`, alt: `{image:${imageIndex}}`, fit: 'cover' },
  };
}

function decorationLayers(layout: ExtractedSlideLayout): ShapeLayer[] {
  return layout.decorations.map((d, i) => ({
    id: `decor-${i + 1}`,
    type: 'shape' as const,
    position: pctPosition(d.rect),
    content:
      d.shape === 'line'
        ? { shape: 'line' as const, stroke: d.stroke, strokeWidth: d.strokeWidthPx ?? 2 }
        : {
            shape: 'rect' as const,
            fill: d.fill,
            ...(d.borderRadius ? { borderRadius: d.borderRadius } : {}),
          },
  }));
}

function titlePlaceholder(layout: ExtractedSlideLayout): ExtractedPlaceholder | undefined {
  return layout.placeholders.find((p) => p.kind === 'title');
}

/** Synthetic title placeholder used when a layout omits one but a template needs it. */
function defaultTitlePlaceholder(): ExtractedPlaceholder {
  return {
    kind: 'title',
    rawType: 'title',
    idx: 0,
    rect: { ...DEFAULT_TITLE_RECT },
    inheritedFromMaster: false,
    vertical: false,
  };
}

function buildTwoColumnDef(
  layout: ExtractedSlideLayout,
  gen: GeneratorContext,
): CustomTemplateLayer[] {
  const texts = contentPlaceholders(layout).filter((p) => p.kind === 'text');
  let left: ExtractedPlaceholder;
  let right: ExtractedPlaceholder;
  const sorted = [...texts].sort((a, b) => a.rect.x - b.rect.x);
  if (sorted.length >= 2 && sideBySide(sorted[0]!.rect, sorted[sorted.length - 1]!.rect)) {
    left = sorted[0]!;
    right = sorted[sorted.length - 1]!;
  } else {
    // Geometry unavailable (defaulted rects) — synthesize equal columns
    // inside the standard body area with a 4% gutter.
    left = {
      ...defaultTitlePlaceholder(),
      kind: 'text',
      rawType: 'body',
      rect: { x: 5, y: 23.3, w: 43, h: 66 },
    };
    right = { ...left, rect: { x: 52, y: 23.3, w: 43, h: 66 } };
  }

  const gap = Math.max(0, Math.round((right.rect.x - (left.rect.x + left.rect.w)) * 100) / 100);
  const layers: CustomTemplateLayer[] = [...decorationLayers(layout)];
  const title = titlePlaceholder(layout) ?? defaultTitlePlaceholder();
  layers.push(textLayerFor('title', title, '{title}', 'title', gen));
  const itemLayer: CustomTemplateLayer = {
    ...textLayerFor('column', left, '{item}', 'body', gen),
    // gap is in percentage points because the layer's width is a %-string;
    // the repeat resolver offsets clones by width + gap in the same unit.
    repeat: { source: 'listItems', direction: 'row', gap, max: 2 },
  };
  layers.push(itemLayer);
  return layers;
}

function buildCaptionDef(
  layout: ExtractedSlideLayout,
  gen: GeneratorContext,
): CustomTemplateLayer[] {
  const texts = contentPlaceholders(layout).filter((p) => p.kind === 'text');
  const byWidth = [...texts].sort((a, b) => b.rect.w - a.rect.w);
  const wide = byWidth[0];
  const narrow = byWidth[1];
  const layers: CustomTemplateLayer[] = [...decorationLayers(layout)];
  const title = titlePlaceholder(layout) ?? defaultTitlePlaceholder();
  layers.push(textLayerFor('title', title, '{title}', 'title', gen));
  if (wide) layers.push(textLayerFor('body', wide, '{content}', 'body', gen));
  if (narrow) {
    // Empty pipe-default: the caption region stays invisible until the
    // author fills it via `{[name caption="…"]}`.
    layers.push(textLayerFor('caption', narrow, '{attr:caption|}', 'body', gen));
  }
  return layers;
}

function buildGenericDef(
  layout: ExtractedSlideLayout,
  gen: GeneratorContext,
): CustomTemplateLayer[] {
  const layers: CustomTemplateLayer[] = [...decorationLayers(layout)];
  const title = titlePlaceholder(layout);
  if (title) layers.push(textLayerFor('title', title, '{title}', 'title', gen));

  const content = contentPlaceholders(layout);
  const pictures = content
    .filter((p) => p.kind === 'picture')
    .sort((a, b) => a.idx - b.idx || a.rect.y - b.rect.y);
  pictures.forEach((ph, k) => layers.push(imageLayerFor(`image-${k}`, ph, k)));

  const texts = content.filter((p) => p.kind === 'text');
  if (texts.length > 0) layers.push(textLayerFor('body', texts[0]!, '{content}', 'body', gen));
  if (texts.length > 1) {
    gen.notes.push(
      `${texts.length - 1} additional text region(s) could not be bound — the token grammar has no per-region address; full text stays in the markdown body.`,
    );
  }
  const dropped = content.filter(
    (p) => p.kind === 'table' || p.kind === 'chart' || p.kind === 'other',
  );
  if (dropped.length > 0) {
    gen.notes.push(
      `${dropped.length} table/chart placeholder(s) dropped (content flows as markdown).`,
    );
  }
  return layers;
}

/**
 * Whether generated layers contain any content-bearing layer (something a
 * slide's title/body/images will bind to) beyond decorations.
 */
function hasContentLayer(layers: CustomTemplateLayer[]): boolean {
  return layers.some((l) => l.type === 'text' || l.type === 'image');
}

// ── Verdict resolution ───────────────────────────────────────────────

function resolveFeatureByGeometry(layout: ExtractedSlideLayout): LayoutVerdict {
  const content = contentPlaceholders(layout);
  const pic = content.find((p) => p.kind === 'picture');
  if (!pic) return { kind: 'plain' };
  const texts = content.filter((p) => p.kind === 'text');
  const beside = texts.find((t) => sideBySide(pic.rect, t.rect));
  if (beside) {
    const template = centerX(pic.rect) < centerX(beside.rect) ? 'leftFeature' : 'rightFeature';
    return { kind: 'builtin', template, paramSpec: 'featureImage' };
  }
  if (texts.some((t) => stackedAbove(pic.rect, t.rect)) || fullBleed(pic.rect)) {
    return { kind: 'builtin', template: 'imageWithCaption', paramSpec: 'featureImage' };
  }
  return { kind: 'builtin', template: 'leftFeature', paramSpec: 'featureImage' };
}

function classifyLayout(layout: ExtractedSlideLayout): Directive {
  return stage1(layout.typeAttr) ?? stage2(layout.name) ?? stage3(layout);
}

function resolveVerdict(
  layout: ExtractedSlideLayout,
  directive: Directive,
  gen: GeneratorContext,
  templateName: string,
): LayoutVerdict {
  switch (directive.kind) {
    case 'plain':
    case 'skip':
      return { kind: directive.kind };
    case 'builtin':
      return directive;
    case 'feature-by-geometry':
      return resolveFeatureByGeometry(layout);
    case 'comparison': {
      const texts = contentPlaceholders(layout).filter((p) => p.kind === 'text');
      const columns = findComparisonColumns(texts);
      // Without resolvable column geometry the importer can't attribute
      // slide texts to sides — and a bare {[twoColumn]} renders empty.
      if (!columns) return { kind: 'plain' };
      return { kind: 'builtin', template: 'twoColumn', paramSpec: 'comparisonPairs', columns };
    }
    case 'custom-two-column':
    case 'custom-caption':
    case 'custom-generic':
    case 'by-geometry': {
      const layers =
        directive.kind === 'custom-two-column'
          ? buildTwoColumnDef(layout, gen)
          : directive.kind === 'custom-caption'
            ? buildCaptionDef(layout, gen)
            : buildGenericDef(layout, gen);
      if (!hasContentLayer(layers)) return { kind: 'plain' };
      const def: CustomTemplateDefinition = {
        name: templateName,
        label: layout.name || 'Imported layout',
        description: `Imported from PowerPoint layout "${layout.name || templateName}"${
          layout.masterName ? ` (master "${layout.masterName}")` : ''
        }`,
        viewport: gen.viewport,
        layers,
      };
      return { kind: 'custom', def };
    }
  }
}

// ── Deck-level analysis ──────────────────────────────────────────────

async function readSlideSize(pkg: OoxmlPackage): Promise<{ cx: number; cy: number }> {
  const pres = await getPartXml(pkg, 'ppt/presentation.xml');
  const sldSz = pres ? firstPml(pres, 'sldSz') : null;
  const cx = intAttr(sldSz, 'cx');
  const cy = intAttr(sldSz, 'cy');
  if (cx && cy && cx > 0 && cy > 0) return { cx, cy };
  return { ...DEFAULT_SLIDE_SIZE };
}

async function orderedSlidePathsForLayouts(pkg: OoxmlPackage): Promise<string[]> {
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

function viewportFor(sldSz: { cx: number; cy: number }): { width: number; height: number } {
  if (sldSz.cy > sldSz.cx) {
    return { width: 1080, height: Math.round((1080 * sldSz.cy) / sldSz.cx) };
  }
  return { width: Math.round((1080 * sldSz.cx) / sldSz.cy), height: 1080 };
}

/**
 * Analyze the deck's slide layouts: extract placeholder geometry (with
 * master inheritance), classify each layout against the built-in template
 * set, and generate custom template definitions for the distinctive ones.
 */
export async function analyzePptxLayouts(
  pkg: OoxmlPackage,
  options: AnalyzePptxLayoutsOptions = {},
): Promise<PptxLayoutInference> {
  const warnings: string[] = [];
  const hints = options.colors ?? {};
  const maxTemplates = options.maxTemplates ?? MAX_INFERRED_TEMPLATES;

  const sldSz = await readSlideSize(pkg);
  const viewport = viewportFor(sldSz);
  const pxPerPt = viewport.height / (sldSz.cy / 12700);

  // Layouts used by slides, in first-use order, with usage counts.
  const slidePaths = await orderedSlidePathsForLayouts(pkg);
  const layoutPathBySlide = new Map<string, string>();
  const usage = new Map<string, number>();
  const orderedLayoutPaths: string[] = [];
  for (const slidePath of slidePaths) {
    const rels = await getPartRelationships(pkg, slidePath);
    const layoutRel = findRelByType(rels, REL_SLIDE_LAYOUT);
    if (!layoutRel) continue;
    const layoutPath = resolveTarget(baseDirOf(slidePath), layoutRel.target);
    layoutPathBySlide.set(slidePath, layoutPath);
    if (!usage.has(layoutPath)) orderedLayoutPaths.push(layoutPath);
    usage.set(layoutPath, (usage.get(layoutPath) ?? 0) + 1);
  }

  if (options.includeUnused) {
    const unused: string[] = [];
    for (const [partPath, contentType] of pkg.contentTypes.overrides) {
      if (contentType === CONTENT_TYPE_PPTX_SLIDE_LAYOUT && !usage.has(partPath)) {
        unused.push(partPath);
      }
    }
    unused.sort();
    orderedLayoutPaths.push(...unused);
  }

  // Extract + classify each layout.
  const masterCache = new Map<string, Promise<MasterIndex>>();
  const layouts: AnalyzedLayout[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < orderedLayoutPaths.length; i++) {
    const layoutPath = orderedLayoutPaths[i]!;
    const extracted = await extractLayout(pkg, layoutPath, sldSz, pxPerPt, hints, masterCache);
    if (!extracted) {
      warnings.push(`layout ${layoutPath} could not be read; its slides import plain`);
      continue;
    }
    extracted.slideCount = usage.get(layoutPath) ?? 0;

    // Unique slug for the (potential) custom template. Reserved up front so
    // two masters sharing a layout name get -2/-3 suffixes deterministically.
    const baseSlug = slugify(extracted.name) || `layout-${i + 1}`;
    let templateName = `pptx-${baseSlug}`;
    for (let n = 2; usedNames.has(templateName); n++) templateName = `pptx-${baseSlug}-${n}`;

    const notes: string[] = [];
    const gen: GeneratorContext = { hints, pxPerPt, viewport, notes };
    const directive = classifyLayout(extracted);
    const verdict = resolveVerdict(extracted, directive, gen, templateName);
    if (verdict.kind === 'custom') usedNames.add(templateName);
    layouts.push({ extracted, verdict, notes });
  }

  // Cap generated templates, keeping the most-used layouts.
  const customs = layouts.filter((l) => l.verdict.kind === 'custom');
  if (customs.length > maxTemplates) {
    const ranked = [...customs].sort((a, b) => b.extracted.slideCount - a.extracted.slideCount);
    for (const layout of ranked.slice(maxTemplates)) {
      layout.verdict = { kind: 'plain' };
      layout.notes.push('dropped: more inferred layouts than the template cap');
    }
    warnings.push(
      `deck defines ${customs.length} distinctive layouts; kept the ${maxTemplates} most used as custom templates`,
    );
  }

  const byLayoutPath = new Map(layouts.map((l) => [l.extracted.partPath, l]));
  return { slideSize: sldSz, layouts, byLayoutPath, layoutPathBySlide, warnings };
}

// ── Dialog-path inspection API ───────────────────────────────────────

export interface PptxLayoutSummary {
  layoutPath: string;
  name: string;
  masterName?: string;
  typeAttr?: string;
  slideCount: number;
  verdict: 'builtin' | 'custom' | 'plain' | 'skip';
  /** Set when verdict is 'builtin' — the close built-in alternative. */
  builtinTemplate?: string;
  /** Set when verdict is 'custom' — ready to save as a doc/library template. */
  customTemplate?: CustomTemplateDefinition;
  notes?: string[];
}

export type InspectPptxLayoutsOptions = AnalyzePptxLayoutsOptions;

/**
 * Inspect a deck's layouts without importing it — used by the theme dialog
 * to list what a PPTX would contribute (built-in matches shown as
 * informational rows; custom templates offered for confirmation).
 */
export async function inspectPptxLayouts(
  data: ArrayBuffer | Blob,
  options: InspectPptxLayoutsOptions = {},
): Promise<{ layouts: PptxLayoutSummary[]; slideSize: { cx: number; cy: number } }> {
  const pkg = await openPackage(data);
  const analysis = await analyzePptxLayouts(pkg, options);
  const layouts = analysis.layouts.map((l, i): PptxLayoutSummary => {
    const { extracted, verdict, notes } = l;
    return {
      layoutPath: extracted.partPath,
      name: extracted.name || `Layout ${i + 1}`,
      ...(extracted.masterName ? { masterName: extracted.masterName } : {}),
      ...(extracted.typeAttr ? { typeAttr: extracted.typeAttr } : {}),
      slideCount: extracted.slideCount,
      verdict: verdict.kind,
      ...(verdict.kind === 'builtin' ? { builtinTemplate: verdict.template } : {}),
      ...(verdict.kind === 'custom' ? { customTemplate: verdict.def } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
  return { layouts, slideSize: analysis.slideSize };
}
