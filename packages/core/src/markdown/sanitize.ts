import type { HtmlElement, HtmlNode } from './types.js';

export type HtmlPolicy = 'strip' | 'sanitize' | 'trusted';

export type UrlKind = 'link' | 'media';

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const SAFE_MEDIA_SCHEMES = new Set(['http', 'https', 'blob']);

const SAFE_DATA_MEDIA_RE =
  /^data:(?:image\/(?!svg\+xml)[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+);/i;

const SAFE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'audio',
]);

const DROP_WITH_CONTENT_TAGS = new Set([
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'option',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
]);

const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'role']);

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  audio: new Set(['src', 'controls', 'preload', 'muted', 'loop']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span']),
  data: new Set(['value']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
  li: new Set(['value']),
  ol: new Set(['start', 'type']),
  q: new Set(['cite']),
  source: new Set(['src', 'type', 'media']),
  td: new Set(['colspan', 'rowspan', 'align']),
  th: new Set(['colspan', 'rowspan', 'align', 'scope']),
  time: new Set(['datetime']),
  track: new Set(['src', 'kind', 'label', 'srclang', 'default']),
  video: new Set([
    'src',
    'poster',
    'width',
    'height',
    'controls',
    'preload',
    'muted',
    'loop',
    'playsinline',
  ]),
};

const SAFE_ATTR_NAME_RE = /^[a-z][a-z0-9:_.-]*$/;
const SAFE_OL_TYPES = new Set(['1', 'a', 'A', 'i', 'I']);
const SAFE_PRELOAD_VALUES = new Set(['none', 'metadata', 'auto']);
const SAFE_TRACK_KINDS = new Set(['subtitles', 'captions', 'descriptions', 'chapters', 'metadata']);

/**
 * Sanitize a URL for a rendered link or media attribute.
 *
 * Relative URLs are allowed. Absolute URLs are restricted to schemes that
 * cannot execute script in a document context. Media URLs additionally allow
 * `blob:` and image/audio/video `data:` URLs because Squisq uses both for
 * browser-local media previews and self-contained exports.
 */
export function sanitizeUrl(url: string | null | undefined, kind: UrlKind = 'link'): string | null {
  if (typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  const compact = stripUrlSchemeNoise(trimmed);
  const colon = compact.indexOf(':');
  const firstPathChar = firstIndexOfAny(compact, ['/', '?', '#']);
  const hasScheme = colon >= 0 && (firstPathChar < 0 || colon < firstPathChar);

  if (!hasScheme) return trimmed;

  const scheme = compact.slice(0, colon).toLowerCase();
  if (kind === 'media') {
    if (scheme === 'data') return SAFE_DATA_MEDIA_RE.test(compact) ? trimmed : null;
    return SAFE_MEDIA_SCHEMES.has(scheme) ? trimmed : null;
  }

  return SAFE_LINK_SCHEMES.has(scheme) ? trimmed : null;
}

/**
 * Return a sanitized copy of an HtmlNode tree. The original parsed tree is left
 * untouched so markdown stringify can still preserve source fidelity.
 */
export function sanitizeHtmlNodes(nodes: HtmlNode[]): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of nodes) {
    out.push(...sanitizeHtmlNode(node));
  }
  return out;
}

function sanitizeHtmlNode(node: HtmlNode): HtmlNode[] {
  switch (node.type) {
    case 'htmlText':
      return [node];
    case 'htmlComment':
      return [];
    case 'htmlElement':
      return sanitizeHtmlElement(node);
  }
}

function sanitizeHtmlElement(node: HtmlElement): HtmlNode[] {
  const tag = node.tagName.toLowerCase();

  if (DROP_WITH_CONTENT_TAGS.has(tag)) return [];

  const children = sanitizeHtmlNodes(node.children);
  if (!SAFE_TAGS.has(tag)) return children;

  return [
    {
      type: 'htmlElement',
      tagName: tag,
      attributes: sanitizeAttrs(tag, node.attributes),
      children,
      selfClosing: node.selfClosing,
    },
  ];
}

function sanitizeAttrs(tag: string, attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(attrs)) {
    const name = rawName.toLowerCase();
    if (!isAllowedAttr(tag, name)) continue;

    const value = String(rawValue);
    const safeValue = sanitizeAttrValue(tag, name, value);
    if (safeValue === null) continue;
    out[name] = safeValue;
  }
  if (tag === 'a' && out.target === '_blank') {
    out.rel = ensureRelTokens(out.rel, ['noopener', 'noreferrer']);
  }
  return out;
}

function isAllowedAttr(tag: string, name: string): boolean {
  if (!SAFE_ATTR_NAME_RE.test(name)) return false;
  if (name.startsWith('on')) return false;
  if (name.startsWith('aria-') || name.startsWith('data-')) return true;
  if (GLOBAL_ATTRS.has(name)) return true;
  return TAG_ATTRS[tag]?.has(name) ?? false;
}

function sanitizeAttrValue(tag: string, name: string, value: string): string | null {
  if (name === 'href') return sanitizeUrl(value, 'link');
  if (name === 'src' || name === 'poster') return sanitizeUrl(value, 'media');
  if (
    (name === 'width' ||
      name === 'height' ||
      name === 'span' ||
      name === 'colspan' ||
      name === 'rowspan' ||
      name === 'value') &&
    !isNonNegativeInteger(value)
  ) {
    return null;
  }
  if (name === 'start' && !isInteger(value)) return null;
  if (name === 'type' && tag === 'ol' && !SAFE_OL_TYPES.has(value)) return null;
  if (name === 'preload' && !SAFE_PRELOAD_VALUES.has(value)) return null;
  if (name === 'kind' && tag === 'track' && !SAFE_TRACK_KINDS.has(value)) return null;
  if (name === 'align' && value !== 'left' && value !== 'right' && value !== 'center') return null;
  if (name === 'target')
    return value === '_blank' || value === '_self' || value === '_parent' || value === '_top'
      ? value
      : null;
  if (name === 'rel') return sanitizeRel(value);
  return value;
}

function sanitizeRel(value: string): string {
  return relTokens(value).join(' ');
}

function ensureRelTokens(value: string | undefined, required: string[]): string {
  const tokens = new Set(value ? relTokens(value) : []);
  for (const token of required) tokens.add(token);
  return Array.from(tokens).join(' ');
}

function relTokens(value: string): string[] {
  const tokens = value
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => /^[a-z0-9_-]+$/.test(token));
  return Array.from(new Set(tokens));
}

function isInteger(value: string): boolean {
  return /^-?\d+$/.test(value.trim());
}

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function firstIndexOfAny(value: string, needles: string[]): number {
  let result = -1;
  for (const needle of needles) {
    const index = value.indexOf(needle);
    if (index >= 0 && (result < 0 || index < result)) result = index;
  }
  return result;
}

function stripUrlSchemeNoise(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || char.trim() === '') continue;
    out += char;
  }
  return out;
}
