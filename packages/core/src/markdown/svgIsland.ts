/**
 * SVG islands — a ```svg code fence that renders as a picture.
 *
 * The authored form is an ordinary fenced code block whose language is `svg`:
 *
 * ```markdown
 * ```svg
 * <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>
 * ```
 * ```
 *
 * The fence language is the durable block tag (it survives the Write-view
 * round-trip, where fence meta does not); `xml`, `html` and untagged fences
 * stay code, which is how an author shows SVG markup rather than a picture.
 *
 * The author's markup NEVER reaches a renderer. {@link parseSvgIsland} parses
 * it, keeps an allowlist of elements and attributes, validates every value,
 * and re-serializes the result as standalone XML; renderers show only that
 * output, as an image (`<img>`/`<image>` from {@link svgIslandDataUrl}). In a
 * browser, SVG loaded as an image runs with no script, no network and no
 * interaction, so the sanitizer is the second line of defence there — but
 * Office and EPUB readers render the exported SVG with their own engines, and
 * for them it is the only one. Hence the strict rules:
 *
 * - one `<svg>` root and nothing else (HTML "breakout" tags such as `<p>` close
 *   the svg in the HTML parser and land beside it, so any sibling rejects);
 * - elements outside the allowlist — `script`, `foreignObject`, any HTML —
 *   are dropped with their content; `<a>` is unwrapped; `<title>`, `<desc>`
 *   and `<style>` keep text only (title/desc are HTML integration points);
 * - attributes are looked up in a table that is both the allowlist and the
 *   case restorer (`viewBox`, `stroke-width`, `xlink:href`); an author's
 *   `xmlns*`, `xml:base` and unknown prefixed names (`foo:href` would become a
 *   real `xlink:href` once the output is re-parsed as XML) never survive;
 * - references stay inside the island: `href` is `#id` only (a raster
 *   `data:` URI for `<image>`), `url(…)` is `url(#id)` only, and CSS that
 *   could fetch or hide a token behind an escape (`@import`, `@font-face`,
 *   `image-set(`, `\75 rl(`) is dropped;
 * - size, depth and `<use>` fan-out are capped.
 */

import { fromHtml } from 'hast-util-from-html';
import { SVG_ISLAND_LIMITS } from './svgIslandLimits.js';
import type { MarkdownNode } from './types.js';

// ============================================
// Public types
// ============================================

/** Why a fence could not become an island. */
export type SvgIslandFailureReason = 'empty' | 'not-svg' | 'too-large' | 'too-deep' | 'parse';

/** Something the sanitizer removed, aggregated by kind and name. */
export interface SvgIslandDiagnostic {
  kind: 'element' | 'attribute' | 'style';
  /** `script`, `onload`, `style rule`, … */
  name: string;
  count: number;
}

/** A sanitized SVG island, ready to render as an image. */
export interface SvgIsland {
  /** Standalone SVG document (no XML prolog), safe to load as an image. */
  readonly markup: string;
  /** Intrinsic size in CSS pixels, always finite and positive. */
  readonly width: number;
  readonly height: number;
  /** `width / height`. */
  readonly aspectRatio: number;
  /** Accessible name: the root `aria-label`, else its first `<title>`. */
  readonly title?: string;
}

export type SvgIslandResult =
  | { ok: true; island: SvgIsland; diagnostics: readonly SvgIslandDiagnostic[] }
  | { ok: false; reason: SvgIslandFailureReason; message: string };

export interface ParseSvgIslandOptions {
  /**
   * Render a still: drop SMIL animation (writing a `fill="freeze"`
   * animation's end value onto its target, so the end state shows rather
   * than an invisible start state) and CSS animations/transitions. Used for
   * frame capture, where wall-clock animation would make frames
   * nondeterministic, and for reduced motion.
   */
  static?: boolean;
}

export interface SvgIslandMarkupOptions {
  /**
   * The surrounding text color. Set as the root `color` (unless the author
   * set one) so `currentColor` follows the page instead of defaulting to
   * black inside the image.
   */
  color?: string;
  /**
   * Also substitute `color` for every `currentColor` in attributes and CSS —
   * for renderers outside the browser (Office, EPUB readers) that may not
   * resolve `currentColor` from the root.
   */
  replaceCurrentColor?: boolean;
}

export { SVG_ISLAND_LIMITS };

// ============================================
// Fence recognition
// ============================================

/** Whether a fence language marks an SVG island (`svg`, any case/padding). */
export function isSvgIslandLang(lang: string | null | undefined): boolean {
  return lang?.trim().toLowerCase() === 'svg';
}

/** Whether a markdown node is a ```svg fence. */
export function isSvgIslandFence(node: MarkdownNode): boolean {
  return node.type === 'code' && isSvgIslandLang(node.lang);
}

// ============================================
// Allowlists
// ============================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const ELEMENTS = [
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'switch',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'image',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
  'animate',
  'animateTransform',
  'animateMotion',
  'mpath',
  'set',
] as const;

/** Lowercased tag → canonical SVG tag (the HTML parser lowercases unknown case). */
const ELEMENT_BY_LOWER = new Map<string, string>(ELEMENTS.map((tag) => [tag.toLowerCase(), tag]));

const ANIMATION_ELEMENTS = new Set(['animate', 'animateTransform', 'animateMotion', 'set']);
/** Elements whose text children are content. */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textPath', 'title', 'desc', 'style']);
/** Integration points / raw text: text children only, never elements. */
const TEXT_ONLY_ELEMENTS = new Set(['title', 'desc', 'style']);
/** Elements that may carry `href`, and what it may point at. */
const LOCAL_HREF_ELEMENTS = new Set([
  'use',
  'textPath',
  'mpath',
  'feImage',
  'linearGradient',
  'radialGradient',
  'pattern',
  'filter',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
]);

const ATTRIBUTES = [
  // Core
  'id',
  'class',
  'style',
  'lang',
  'xml:lang',
  'xml:space',
  'role',
  'aria-label',
  'aria-hidden',
  'href',
  'xlink:href',
  'version',
  // Geometry & coordinate systems
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'dx',
  'dy',
  'width',
  'height',
  'd',
  'points',
  'pathLength',
  'transform',
  'transform-origin',
  'viewBox',
  'preserveAspectRatio',
  'overflow',
  'rotate',
  'textLength',
  'lengthAdjust',
  'startOffset',
  'method',
  'spacing',
  'side',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'orient',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  'filterUnits',
  'primitiveUnits',
  'requiredExtensions',
  'systemLanguage',
  // Presentation
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'display',
  'visibility',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'stop-color',
  'stop-opacity',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'text-decoration',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'writing-mode',
  'direction',
  'unicode-bidi',
  'shape-rendering',
  'text-rendering',
  'image-rendering',
  'color-interpolation',
  'color-interpolation-filters',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'paint-order',
  'vector-effect',
  // Filter primitives
  'in',
  'in2',
  'result',
  'stdDeviation',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'mode',
  'type',
  'values',
  'tableValues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'kernelMatrix',
  'order',
  'divisor',
  'bias',
  'targetX',
  'targetY',
  'edgeMode',
  'preserveAlpha',
  'kernelUnitLength',
  'surfaceScale',
  'specularConstant',
  'specularExponent',
  'diffuseConstant',
  'azimuth',
  'elevation',
  'pointsAtX',
  'pointsAtY',
  'pointsAtZ',
  'limitingConeAngle',
  'scale',
  'xChannelSelector',
  'yChannelSelector',
  'baseFrequency',
  'numOctaves',
  'seed',
  'stitchTiles',
  'radius',
  'z',
  // Animation
  'attributeName',
  'attributeType',
  'from',
  'to',
  'by',
  'begin',
  'dur',
  'end',
  'min',
  'max',
  'restart',
  'repeatCount',
  'repeatDur',
  'calcMode',
  'keyTimes',
  'keySplines',
  'keyPoints',
  'additive',
  'accumulate',
  'path',
] as const;

/**
 * The parser hands attributes back as hast property names (`strokeDashArray`,
 * `xLinkHref`, `className`); an author may also write an attribute in odd case
 * or without its prefix. Both normalize to the same key — lowercased, with
 * `-` and `:` removed — which maps to the one canonical attribute name. Every
 * value is then validated under that canonical name.
 */
function attributeKey(name: string): string {
  return name.toLowerCase().replace(/[-:]/g, '');
}

const ATTRIBUTE_BY_KEY = new Map<string, string>([
  ...ATTRIBUTES.map((name) => [attributeKey(name), name] as [string, string]),
  ['classname', 'class'],
]);

/** Free text — exempt from the CSS-value checks. */
const FREE_TEXT_ATTRIBUTES = new Set(['aria-label']);
/** Animation targets that would let an island rewrite a reference. */
const UNANIMATABLE = new Set(['href', 'xlink:href', 'style']);

const RASTER_DATA_URI_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/i;
const LOCAL_REF_RE = /^#[^\s"'<>()\\]+$/;
const URL_FUNCTION_RE = /url\s*\(/gi;
const LOCAL_URL_RE = /^url\(\s*(['"]?)#[^\s"'<>()\\]+\1\s*\)/i;
/** CSS functions that load resources, beyond `url(`. */
const FETCHING_FUNCTION_RE =
  /(?:^|[^a-z0-9_-])(?:-webkit-image-set|image-set|image|cross-fade|src|element|paint)\s*\(/i;
const FORBIDDEN_CSS_RE =
  /@import|@font-face|@namespace|@document|-moz-binding|behavior\s*:|expression\s*\(|javascript:/i;
/**
 * Any absolute URL. Nothing in an island legitimately names one, and other
 * engines' CSS parsers (Office, EPUB readers) may be laxer than a browser's
 * about what counts as `url(` — so a remote reference anywhere drops the value.
 */
const REMOTE_REF_RE = /[a-z][a-z0-9+.-]*:\/\//i;
/** Characters XML 1.0 forbids (C0 controls other than tab/newline/return, lone surrogates). */
// eslint-disable-next-line no-control-regex
const XML_INVALID_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const SAFE_COLOR_RE = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%a-z/+-]*\)|[a-z]{3,20})$/i;

// ============================================
// Sanitized tree
// ============================================

interface IslandElement {
  tag: string;
  attrs: [string, string][];
  children: IslandNode[];
}
type IslandNode = IslandElement | string;

/** The sanitized tree behind each island, for re-serialization with options. */
const ISLAND_TREES = new WeakMap<SvgIsland, IslandElement>();

class IslandLimitError extends Error {
  constructor(
    readonly reason: SvgIslandFailureReason,
    message: string,
  ) {
    super(message);
  }
}

class DiagnosticLog {
  private readonly counts = new Map<string, SvgIslandDiagnostic>();

  add(kind: SvgIslandDiagnostic['kind'], name: string): void {
    const key = `${kind}:${name}`;
    const existing = this.counts.get(key);
    if (existing) existing.count += 1;
    else this.counts.set(key, { kind, name, count: 1 });
  }

  list(): SvgIslandDiagnostic[] {
    return [...this.counts.values()];
  }
}

// ============================================
// Value checks
// ============================================

/** A value that is CSS-ish must not reference or fetch anything outside the island. */
function isSafeCssValue(value: string): boolean {
  if (value.includes('\\')) return false;
  if (FORBIDDEN_CSS_RE.test(value) || REMOTE_REF_RE.test(value)) return false;
  if (FETCHING_FUNCTION_RE.test(value)) return false;
  URL_FUNCTION_RE.lastIndex = 0;
  for (let match = URL_FUNCTION_RE.exec(value); match; match = URL_FUNCTION_RE.exec(value)) {
    if (!LOCAL_URL_RE.test(value.slice(match.index))) return false;
  }
  return true;
}

function cleanText(value: string): string {
  return value.replace(LONE_SURROGATE_RE, '�').replace(XML_INVALID_RE, '');
}

/** Split CSS into top-level statements, respecting strings and braces. */
function splitCssStatements(css: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth <= 0) {
        statements.push(css.slice(start, i + 1));
        start = i + 1;
        depth = 0;
      }
    } else if (ch === ';' && depth === 0) {
      statements.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  // An unterminated trailing statement (open brace or string) is dropped.
  if (depth === 0 && quote === null && css.slice(start).trim()) statements.push(css.slice(start));
  return statements.map((statement) => statement.trim()).filter(Boolean);
}

const ANIMATION_DECLARATION_RE = /(?:^|[;{\s])(?:animation|transition)[a-z-]*\s*:[^;{}]*;?/gi;

function stripCssMotion(css: string): string {
  return css.replace(ANIMATION_DECLARATION_RE, (match) => (/^[;{\s]/.test(match) ? match[0]! : ''));
}

/**
 * Sanitize a stylesheet (or a `style` attribute's declarations): comments go,
 * then any statement that could fetch, escape or bind is dropped whole.
 */
function sanitizeCss(css: string, isStatic: boolean, log: DiagnosticLog): string {
  const uncommented = cleanText(css).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
  const kept: string[] = [];
  for (const statement of splitCssStatements(uncommented)) {
    if (!isSafeCssValue(statement)) {
      log.add('style', 'style rule');
      continue;
    }
    if (isStatic && /^@(?:-[a-z]+-)?keyframes\b/i.test(statement)) continue;
    kept.push(isStatic ? stripCssMotion(statement) : statement);
  }
  return kept.join('\n');
}

/** Normalize a hast property value (string, number, boolean, list) to text. */
function propertyText(name: string, value: unknown): string | null {
  if (value === null || value === undefined || value === false) return null;
  if (value === true) return '';
  if (Array.isArray(value)) return value.join(name === 'systemLanguage' ? ', ' : ' ');
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return null;
}

/**
 * Validate one attribute; returns the value to keep, or null to drop it.
 * Dropping is logged only when it matters (handlers, references, styles) —
 * editor metadata such as `inkscape:label` or `data-name` drops silently.
 */
function sanitizeAttribute(
  tag: string,
  name: string,
  value: string,
  isStatic: boolean,
  log: DiagnosticLog,
): string | null {
  const text = cleanText(value);
  if (name === 'href' || name === 'xlink:href') {
    const ref = text.trim();
    if (tag === 'image' && RASTER_DATA_URI_RE.test(ref)) return ref;
    if (LOCAL_HREF_ELEMENTS.has(tag) && LOCAL_REF_RE.test(ref)) return ref;
    log.add('attribute', name);
    return null;
  }
  if (name === 'style') {
    const css = sanitizeCss(text, isStatic, log);
    return css.trim() ? css : null;
  }
  if (name === 'attributeName') {
    const target = ATTRIBUTE_BY_KEY.get(attributeKey(text.trim()));
    if (!target || UNANIMATABLE.has(target)) {
      log.add('attribute', 'attributeName');
      return null;
    }
    return target;
  }
  if (FREE_TEXT_ATTRIBUTES.has(name)) return text;
  if (!isSafeCssValue(text)) {
    log.add('attribute', name);
    return null;
  }
  return text;
}

// ============================================
// Parse → sanitize
// ============================================

interface HastLike {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastLike[];
}

/** A frozen animation's end value, to be written onto its parent. */
interface Freeze {
  name: string;
  value: string;
}

interface SanitizeState {
  isStatic: boolean;
  log: DiagnosticLog;
  elements: number;
}

/**
 * Strip a leading BOM, XML declaration, comments and DOCTYPE (with its
 * internal subset — Illustrator writes one). The HTML parser would end a
 * DOCTYPE at the first `>` inside `[…]` and leave `]>` behind as text.
 * Bounded: at most 16 prolog items.
 */
function stripProlog(source: string): string {
  let rest = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < 16; i++) {
    rest = rest.trimStart();
    let end = -1;
    if (rest.startsWith('<?')) {
      end = rest.indexOf('?>');
      if (end >= 0) end += 2;
    } else if (rest.startsWith('<!--')) {
      end = rest.indexOf('-->', 4);
      if (end >= 0) end += 3;
    } else if (/^<!doctype/i.test(rest)) {
      const gt = rest.indexOf('>');
      const bracket = rest.indexOf('[');
      if (bracket >= 0 && (gt < 0 || bracket < gt)) {
        const close = rest.indexOf(']', bracket);
        const afterClose = close >= 0 ? rest.indexOf('>', close) : -1;
        end = afterClose >= 0 ? afterClose + 1 : -1;
      } else {
        end = gt >= 0 ? gt + 1 : -1;
      }
    } else {
      break;
    }
    if (end < 0) break;
    rest = rest.slice(end);
  }
  return rest;
}

function textContent(node: HastLike): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textContent).join('');
}

function getAttr(element: IslandElement, name: string): string | undefined {
  return element.attrs.find(([attr]) => attr === name)?.[1];
}

function setAttr(element: IslandElement, name: string, value: string): void {
  const at = element.attrs.findIndex(([attr]) => attr === name);
  if (at >= 0) element.attrs[at] = [name, value];
  else element.attrs.push([name, value]);
}

function sanitizeElement(
  node: HastLike,
  canonical: string,
  depth: number,
  state: SanitizeState,
): IslandElement {
  if (depth > SVG_ISLAND_LIMITS.maxDepth) {
    throw new IslandLimitError('too-deep', 'The SVG is nested too deeply to render.');
  }
  state.elements += 1;
  if (state.elements > SVG_ISLAND_LIMITS.maxElements) {
    throw new IslandLimitError('too-large', 'The SVG has too many elements to render.');
  }

  const element: IslandElement = { tag: canonical, attrs: [], children: [] };
  for (const [prop, raw] of Object.entries(node.properties ?? {})) {
    if (/^on/i.test(prop)) {
      state.log.add('attribute', prop.toLowerCase());
      continue;
    }
    const name = ATTRIBUTE_BY_KEY.get(attributeKey(prop));
    if (!name || getAttr(element, name) !== undefined) continue;
    const text = propertyText(prop, raw);
    if (text === null) continue;
    const value = sanitizeAttribute(canonical, name, text, state.isStatic, state.log);
    if (value !== null) element.attrs.push([name, value]);
  }

  if (TEXT_ONLY_ELEMENTS.has(canonical)) {
    const text = textContent(node);
    const content = canonical === 'style' ? sanitizeCss(text, state.isStatic, state.log) : text;
    if (content.trim()) element.children.push(cleanText(content));
    return element;
  }

  const freezes: Freeze[] = [];
  element.children = sanitizeChildren(node.children ?? [], canonical, depth, state, freezes);
  for (const freeze of freezes) {
    const value = sanitizeAttribute(canonical, freeze.name, freeze.value, true, state.log);
    if (value !== null) setAttr(element, freeze.name, value);
  }
  return element;
}

function sanitizeChildren(
  children: HastLike[],
  parentTag: string,
  depth: number,
  state: SanitizeState,
  freezes: Freeze[],
): IslandNode[] {
  const out: IslandNode[] = [];
  for (const child of children) {
    if (child.type === 'text') {
      // Text renders only inside text content; elsewhere it is formatting.
      if (TEXT_ELEMENTS.has(parentTag) && child.value) out.push(cleanText(child.value));
      continue;
    }
    if (child.type !== 'element' || !child.tagName) continue;
    if (child.tagName.toLowerCase() === 'a') {
      // Links do nothing in an image; keep what they wrap. (An animation
      // inside one targeted the link itself, so its freeze has no home.)
      out.push(...sanitizeChildren(child.children ?? [], parentTag, depth + 1, state, []));
      continue;
    }
    const canonical = ELEMENT_BY_LOWER.get(child.tagName.toLowerCase());
    if (!canonical) {
      state.log.add('element', child.tagName);
      continue;
    }
    if (state.isStatic && ANIMATION_ELEMENTS.has(canonical)) {
      const freeze = frozenEndValue(child, canonical);
      if (freeze) freezes.push(freeze);
      continue;
    }
    out.push(sanitizeElement(child, canonical, depth + 1, state));
  }
  return out;
}

/**
 * Static mode: an animation that holds its end value (`fill="freeze"`) is
 * replaced by that value on its parent, so a fade-in shows the shape rather
 * than leaving it at opacity 0. Everything else simply disappears, leaving
 * the base value — which is what a non-frozen animation shows once it ends.
 */
function frozenEndValue(node: HastLike, tag: string): Freeze | null {
  const props = node.properties ?? {};
  if (tag !== 'animate' && tag !== 'set') return null;
  if (propertyText('fill', props.fill)?.trim() !== 'freeze') return null;
  // An animation aimed elsewhere by href would need the target resolved.
  if (props.href !== undefined || props.xLinkHref !== undefined) return null;
  const targetName = propertyText('attributeName', props.attributeName);
  const name = targetName ? ATTRIBUTE_BY_KEY.get(attributeKey(targetName.trim())) : undefined;
  if (!name || UNANIMATABLE.has(name)) return null;
  let value = propertyText('to', props.to);
  if (value === null && tag === 'animate') {
    const values = propertyText('values', props.values)
      ?.split(';')
      .map((part) => part.trim())
      .filter(Boolean);
    value = values && values.length > 0 ? values[values.length - 1]! : null;
  }
  return value === null ? null : { name, value };
}

/**
 * `<use>` multiplies what renders without adding parsed elements, so a few
 * nested uses can expand into millions of shapes. Count the expanded tree
 * (memoized per element) and reject cycles.
 */
function checkUseExpansion(root: IslandElement): void {
  const byId = new Map<string, IslandElement>();
  const index = (element: IslandElement): void => {
    const id = getAttr(element, 'id');
    if (id && !byId.has(id)) byId.set(id, element);
    for (const child of element.children) if (typeof child !== 'string') index(child);
  };
  index(root);

  const limit = SVG_ISLAND_LIMITS.maxExpandedElements;
  const sizes = new Map<IslandElement, number>();
  const visiting = new Set<IslandElement>();
  const expandedSize = (element: IslandElement): number => {
    const known = sizes.get(element);
    if (known !== undefined) return known;
    if (visiting.has(element)) {
      throw new IslandLimitError('too-large', 'The SVG has a circular <use> reference.');
    }
    visiting.add(element);
    let total = 1;
    for (const child of element.children) {
      if (typeof child !== 'string') total += expandedSize(child);
    }
    if (element.tag === 'use') {
      const ref = getAttr(element, 'href') ?? getAttr(element, 'xlink:href');
      const target = ref ? byId.get(ref.slice(1)) : undefined;
      if (target) total += expandedSize(target);
    }
    visiting.delete(element);
    if (total > limit) {
      throw new IslandLimitError('too-large', 'The SVG expands to too many shapes to render.');
    }
    sizes.set(element, total);
    return total;
  };
  expandedSize(root);
}

// ============================================
// Size
// ============================================

const PX_PER_UNIT: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};
const LENGTH_RE = /^\s*\+?(\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|pt|pc|in|cm|mm)?\s*$/i;

/** An absolute length in CSS pixels; undefined for `%`, `em` and junk. */
function lengthPx(value: string | undefined): number | undefined {
  const match = value ? LENGTH_RE.exec(value) : null;
  if (!match) return undefined;
  const px = Number(match[1]) * PX_PER_UNIT[(match[2] ?? '').toLowerCase()]!;
  return Number.isFinite(px) && px > 0 ? px : undefined;
}

function parseViewBox(value: string | undefined): { width: number; height: number } | undefined {
  const parts = value
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!parts || parts.length !== 4 || !parts.every(Number.isFinite)) return undefined;
  const [, , width, height] = parts as [number, number, number, number];
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function roundSize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Always give the root numeric `width`/`height` (an SVG with no intrinsic size
 * cannot be drawn to a canvas in Firefox, and Office/EPUB need one) and a
 * `viewBox` (so it scales to whatever box a renderer gives it).
 */
function sizeRoot(root: IslandElement): { width: number; height: number } {
  const viewBox = parseViewBox(getAttr(root, 'viewBox'));
  let width = lengthPx(getAttr(root, 'width'));
  let height = lengthPx(getAttr(root, 'height'));
  if (!width || !height) {
    if (viewBox) {
      if (width) height = (width * viewBox.height) / viewBox.width;
      else if (height) width = (height * viewBox.width) / viewBox.height;
      else ({ width, height } = viewBox);
    } else {
      width ??= 300;
      height ??= 150;
    }
  }
  width = roundSize(width!);
  height = roundSize(height!);
  setAttr(root, 'width', String(width));
  setAttr(root, 'height', String(height));
  if (!viewBox) setAttr(root, 'viewBox', `0 0 ${width} ${height}`);
  return { width, height };
}

function islandTitle(root: IslandElement): string | undefined {
  const label = getAttr(root, 'aria-label');
  const titleElement = root.children.find(
    (child): child is IslandElement => typeof child !== 'string' && child.tag === 'title',
  );
  const raw = label ?? (titleElement?.children.join('') || undefined);
  const title = raw?.replace(/\s+/g, ' ').trim().slice(0, 200);
  return title || undefined;
}

// ============================================
// Serialize
// ============================================

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

function usesXlink(element: IslandElement): boolean {
  if (element.attrs.some(([name]) => name.startsWith('xlink:'))) return true;
  return element.children.some((child) => typeof child !== 'string' && usesXlink(child));
}

interface SerializeOptions {
  color?: string;
  replaceCurrentColor?: boolean;
}

function serializeElement(
  element: IslandElement,
  options: SerializeOptions,
  root: boolean,
): string {
  const recolor = (value: string): string =>
    options.replaceCurrentColor && options.color
      ? value.replace(/currentcolor/gi, options.color)
      : value;
  let attrs = '';
  if (root) {
    attrs += ` xmlns="${SVG_NS}"`;
    if (usesXlink(element)) attrs += ` xmlns:xlink="${XLINK_NS}"`;
    if (options.color && getAttr(element, 'color') === undefined) {
      attrs += ` color="${escapeAttr(options.color)}"`;
    }
  }
  for (const [name, value] of element.attrs) attrs += ` ${name}="${escapeAttr(recolor(value))}"`;
  if (element.children.length === 0) return `<${element.tag}${attrs}/>`;
  const body = element.children
    .map((child) =>
      typeof child === 'string'
        ? escapeText(element.tag === 'style' ? recolor(child) : child)
        : serializeElement(child, options, false),
    )
    .join('');
  return `<${element.tag}${attrs}>${body}</${element.tag}>`;
}

// ============================================
// Public API
// ============================================

function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < value.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function failure(reason: SvgIslandFailureReason, message: string): SvgIslandResult {
  return Object.freeze({ ok: false as const, reason, message });
}

function parseUncached(source: string, isStatic: boolean): SvgIslandResult {
  if (!source.trim()) return failure('empty', 'The SVG fence is empty.');
  const max = SVG_ISLAND_LIMITS.maxSourceBytes;
  if (source.length > max || utf8Length(source) > max) {
    return failure('too-large', 'The SVG is too large to render.');
  }

  let tree: HastLike;
  try {
    tree = fromHtml(stripProlog(source), { fragment: true }) as unknown as HastLike;
  } catch (err: unknown) {
    return err instanceof RangeError
      ? failure('too-deep', 'The SVG is nested too deeply to render.')
      : failure('parse', 'The SVG could not be read.');
  }

  let rootNode: HastLike | undefined;
  for (const child of tree.children ?? []) {
    if (child.type === 'comment' || child.type === 'doctype') continue;
    if (child.type === 'text' && !(child.value ?? '').trim()) continue;
    if (child.type === 'element' && child.tagName === 'svg' && !rootNode) {
      rootNode = child;
      continue;
    }
    return failure('not-svg', 'An SVG fence must hold one <svg> element and nothing else.');
  }
  if (!rootNode) {
    return failure('not-svg', 'An SVG fence must hold one <svg> element and nothing else.');
  }

  const state: SanitizeState = { isStatic, log: new DiagnosticLog(), elements: 0 };
  let root: IslandElement;
  try {
    root = sanitizeElement(rootNode, 'svg', 0, state);
    checkUseExpansion(root);
  } catch (err: unknown) {
    if (err instanceof IslandLimitError) return failure(err.reason, err.message);
    if (err instanceof RangeError) {
      return failure('too-deep', 'The SVG is nested too deeply to render.');
    }
    throw err;
  }

  const { width, height } = sizeRoot(root);
  const title = islandTitle(root);
  const island: SvgIsland = Object.freeze({
    markup: serializeElement(root, {}, true),
    width,
    height,
    aspectRatio: width / height,
    ...(title ? { title } : {}),
  });
  ISLAND_TREES.set(island, root);
  return Object.freeze({
    ok: true as const,
    island,
    diagnostics: Object.freeze(state.log.list()),
  });
}

const RESULT_CACHE = new Map<string, SvgIslandResult>();
const RESULT_CACHE_LIMIT = 48;
/** Larger sources are re-parsed rather than pinned in memory. */
const CACHEABLE_SOURCE_LENGTH = 128 * 1024;

/**
 * Parse and sanitize a ```svg fence body. Memoized (a small LRU), because
 * every materialization pass — slides, dashboard, page, exports — asks again.
 * Never throws.
 */
export function parseSvgIsland(
  source: string,
  options: ParseSvgIslandOptions = {},
): SvgIslandResult {
  if (typeof source !== 'string') return failure('empty', 'The SVG fence is empty.');
  const isStatic = options.static === true;
  if (source.length > CACHEABLE_SOURCE_LENGTH) return parseUncached(source, isStatic);
  const key = (isStatic ? 's:' : 'a:') + source;
  const cached = RESULT_CACHE.get(key);
  if (cached) {
    RESULT_CACHE.delete(key);
    RESULT_CACHE.set(key, cached);
    return cached;
  }
  const result = parseUncached(source, isStatic);
  RESULT_CACHE.set(key, result);
  if (RESULT_CACHE.size > RESULT_CACHE_LIMIT) {
    const oldest = RESULT_CACHE.keys().next().value;
    if (oldest !== undefined) RESULT_CACHE.delete(oldest);
  }
  return result;
}

/**
 * The island as an SVG document string, optionally colored for its
 * surroundings. A color that is not a plain CSS color is ignored.
 */
export function svgIslandMarkup(island: SvgIsland, options: SvgIslandMarkupOptions = {}): string {
  const color = options.color?.trim();
  const tree = ISLAND_TREES.get(island);
  if (!tree || !color || !SAFE_COLOR_RE.test(color)) return island.markup;
  return serializeElement(
    tree,
    { color, replaceCurrentColor: options.replaceCurrentColor === true },
    true,
  );
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    parts.push(
      BASE64[(n >> 18) & 63]! +
        BASE64[(n >> 12) & 63]! +
        (b === undefined ? '=' : BASE64[(n >> 6) & 63]!) +
        (c === undefined ? '=' : BASE64[n & 63]!),
    );
  }
  return parts.join('');
}

const DATA_URL_CACHE = new WeakMap<SvgIsland, Map<string, string>>();

/**
 * A `data:image/svg+xml;base64,…` URL of the island — the ONLY form a
 * renderer may show it in. Base64 keeps it ~1.34× the markup (percent
 * encoding can reach 9× for non-ASCII text).
 */
export function svgIslandDataUrl(island: SvgIsland, options: SvgIslandMarkupOptions = {}): string {
  const key = `${options.color ?? ''}|${options.replaceCurrentColor ? 1 : 0}`;
  let perIsland = DATA_URL_CACHE.get(island);
  const cached = perIsland?.get(key);
  if (cached) return cached;
  const url = `data:image/svg+xml;base64,${base64(new TextEncoder().encode(svgIslandMarkup(island, options)))}`;
  if (!perIsland) {
    perIsland = new Map();
    DATA_URL_CACHE.set(island, perIsland);
  }
  if (perIsland.size < 8) perIsland.set(key, url);
  return url;
}
