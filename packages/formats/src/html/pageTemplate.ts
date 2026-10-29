/**
 * HTML Page Templates
 *
 * Places a rendered document inside a page of the author's own — a site
 * header, navigation, footer, and stylesheet — instead of the fixed shell
 * `markdownDocToPlainHtml` emits. A template is an ordinary HTML file that
 * marks where content goes with the HTML standard's `<slot>` element:
 *
 * - the one unnamed `<slot>` receives the document body;
 * - `<slot name="title">` receives the document title, and
 *   `<slot name="KEY">` the caller's value for `KEY` (typically a
 *   frontmatter field), inserted as text;
 * - a slot with no value is replaced by its children — the standard fallback
 *   content — so a template opened directly in a browser previews with its
 *   placeholders.
 *
 * `<slot/>` is accepted as an empty slot (the spelling Astro and JSX authors
 * use), although HTML itself has no self-closing `<slot>`.
 *
 * `<title>` cannot contain elements, so slots written inside it are matched
 * as text; a `<title>` without one is replaced by the document title.
 * Existing description and Open Graph / Twitter title and description
 * `<meta>` tags receive the document's values. Relative URLs in the template
 * are rewritten so they still resolve from the generated page's location.
 *
 * The template is scanned, never re-serialized: everything outside the
 * replaced ranges is emitted byte for byte, so its formatting, comments, and
 * scripts survive unchanged.
 */

import { normalizePath } from './plainHtmlBundle.js';

// ── Public Types ───────────────────────────────────────────────────

/** Marks the start of the injected document body in a templated page. */
export const HTML_PAGE_TEMPLATE_CONTENT_START = '<!-- squisq:content -->';
/** Marks the end of the injected document body in a templated page. */
export const HTML_PAGE_TEMPLATE_CONTENT_END = '<!-- /squisq:content -->';

export interface HtmlPageTemplateContent {
  /** Rendered document body. Inserted as-is; the caller sanitizes it. */
  bodyHtml: string;
  /**
   * Markup the body needs in `<head>`, such as
   * `PlainHtmlParts.featureHeadHtml`. Inserted before the template's own
   * stylesheets so the template's CSS cascades last.
   */
  headHtml?: string;
  /** Document title, as text. */
  title: string;
  /**
   * Text for named slots, keyed by slot name. `description` also fills
   * description `<meta>` tags. `title` comes from {@link title}.
   */
  values?: Readonly<Record<string, string | undefined>>;
}

export interface HtmlPageTemplateOptions {
  /**
   * Container-relative path of the template file: the location its relative
   * URLs were written against.
   */
  templatePath?: string;
  /**
   * Container-relative path of the page being generated. With
   * {@link templatePath}, relative URLs in the template are rewritten to
   * resolve from here.
   */
  outputPath?: string;
}

export interface HtmlPageTemplateIssue {
  message: string;
  /** 1-based line in the template. */
  line: number;
}

export interface HtmlPageTemplateInspection {
  /** True when the HTML has a `<slot>` outside any `<template>`. */
  isTemplate: boolean;
  /** Unnamed slots outside `<template>`; a usable template has exactly one. */
  defaultSlotCount: number;
  /** Distinct named slots, in document order. */
  namedSlots: string[];
  /** Problems that make {@link applyHtmlPageTemplate} refuse the template. */
  errors: HtmlPageTemplateIssue[];
}

/** Thrown by {@link applyHtmlPageTemplate} for a template it cannot use. */
export class HtmlPageTemplateError extends Error {
  readonly issues: readonly HtmlPageTemplateIssue[];

  constructor(issues: readonly HtmlPageTemplateIssue[]) {
    super(
      issues.length === 1
        ? `Invalid page template: ${describeIssue(issues[0])}`
        : `Invalid page template:\n${issues.map((issue) => `- ${describeIssue(issue)}`).join('\n')}`,
    );
    this.name = 'HtmlPageTemplateError';
    this.issues = issues;
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * True when `html` is a page template: it has a `<slot>` outside any
 * `<template>`. Outside a shadow tree a slot does nothing, so an ordinary
 * page has no reason to carry one.
 */
export function isHtmlPageTemplate(html: string): boolean {
  return scanHtml(html).some(isLightSlot);
}

/** Describe a template's slots and any problems that would prevent its use. */
export function inspectHtmlPageTemplate(html: string): HtmlPageTemplateInspection {
  return analyzeTemplate(html).inspection;
}

function analyzeTemplate(html: string): {
  tags: Tag[];
  slots: SlotRange[];
  inspection: HtmlPageTemplateInspection;
} {
  const tags = scanHtml(html);
  const { slots, issues } = collectSlots(tags);
  const lines = lineIndex(html);
  const errors = issues.map(({ message, offset }) => ({ message, line: lines(offset) }));
  const defaultSlots = slots.filter((slot) => slot.name === null);
  if (defaultSlots.length === 0) {
    errors.push({
      message: 'The template has no unnamed <slot> for the document content.',
      line: 1,
    });
  } else if (defaultSlots.length > 1) {
    for (const extra of defaultSlots.slice(1)) {
      errors.push({
        message: 'The template has more than one unnamed <slot>; the content can appear only once.',
        line: lines(extra.start),
      });
    }
  }
  const namedSlots: string[] = [];
  for (const slot of slots) {
    if (slot.name !== null && !namedSlots.includes(slot.name)) namedSlots.push(slot.name);
  }
  return {
    tags,
    slots,
    inspection: {
      isTemplate: tags.some(isLightSlot),
      defaultSlotCount: defaultSlots.length,
      namedSlots,
      errors: errors.sort((a, b) => a.line - b.line),
    },
  };
}

function isLightSlot(tag: Tag): boolean {
  return tag.kind === 'start' && tag.name === 'slot' && !tag.inert;
}

/**
 * Generate a page by filling `template`'s slots with `content`.
 *
 * @throws {HtmlPageTemplateError} when the template has no single unnamed
 *   slot, or its slots are unbalanced or nested.
 */
export function applyHtmlPageTemplate(
  template: string,
  content: HtmlPageTemplateContent,
  options: HtmlPageTemplateOptions = {},
): string {
  const { tags, slots, inspection } = analyzeTemplate(template);
  if (inspection.errors.length > 0) throw new HtmlPageTemplateError(inspection.errors);

  const values = content.values ?? {};
  const valueFor = (name: string): string | undefined =>
    name === 'title' ? content.title : values[name];
  const edits: Edit[] = [];

  // Slots: the unnamed one becomes the marked body; a named one becomes its
  // value as text, or its fallback children when it has no value.
  const replacements = new Set<Edit>();
  for (const slot of slots) {
    const value = slot.name === null ? undefined : valueFor(slot.name);
    if (slot.name === null || value !== undefined) {
      const replacement: Edit = {
        start: slot.start,
        end: slot.end,
        text:
          slot.name === null
            ? `${HTML_PAGE_TEMPLATE_CONTENT_START}\n${content.bodyHtml}\n${HTML_PAGE_TEMPLATE_CONTENT_END}`
            : escapeHtml(value ?? ''),
      };
      edits.push(replacement);
      replacements.add(replacement);
    } else {
      edits.push({ start: slot.start, end: slot.contentStart, text: '' });
      if (slot.end > slot.contentEnd)
        edits.push({ start: slot.contentEnd, end: slot.end, text: '' });
    }
  }

  // <title>: its slots are text, so fill them as text; otherwise replace it.
  const title = tags.find(
    (tag): tag is StartTag => tag.kind === 'start' && tag.name === 'title' && !tag.inert,
  );
  if (title?.text) {
    edits.push({
      start: title.text.start,
      end: title.text.end,
      text: fillTitleText(template.slice(title.text.start, title.text.end), valueFor),
    });
  }

  // Page metadata the template already declares.
  for (const tag of tags) {
    if (tag.kind !== 'start' || tag.name !== 'meta' || tag.inert) continue;
    const key = (attributeValue(tag, 'name') ?? attributeValue(tag, 'property'))?.toLowerCase();
    const value = key ? metaValue(key, content.title, values.description) : undefined;
    if (value === undefined) continue;
    const contentAttribute = tag.attributes.find((attribute) => attribute.name === 'content');
    const text = `content="${escapeAttr(value)}"`;
    if (contentAttribute) {
      edits.push({ start: contentAttribute.start, end: contentAttribute.end, text });
    } else {
      edits.push({ start: tag.closeStart, end: tag.closeStart, text: ` ${text}` });
    }
  }

  // Relative URLs, rewritten from the template's folder to the page's.
  const fromDir = options.templatePath === undefined ? null : posixDirname(options.templatePath);
  const toDir = options.outputPath === undefined ? null : posixDirname(options.outputPath);
  if (fromDir !== null && toDir !== null && fromDir !== toDir) {
    for (const tag of tags) {
      if (tag.kind !== 'start') continue;
      for (const attribute of tag.attributes) {
        if (attribute.value === null) continue;
        const rewrite = URL_ATTRIBUTES.has(attribute.name)
          ? rebaseUrl
          : SRCSET_ATTRIBUTES.has(attribute.name)
            ? rebaseSrcset
            : null;
        if (!rewrite) continue;
        const raw = template.slice(attribute.valueStart, attribute.valueEnd);
        const rebased = rewrite(raw, fromDir, toDir);
        if (rebased !== raw) {
          edits.push({ start: attribute.valueStart, end: attribute.valueEnd, text: rebased });
        }
      }
    }
  }

  // Head additions go before the template's own stylesheets.
  const headInsert = `${content.headHtml ?? ''}${title ? '' : `<title>${escapeHtml(content.title)}</title>\n`}`;
  if (headInsert) {
    const at = headInsertionPoint(tags);
    edits.push({ start: at, end: at, text: headInsert });
  }

  // Edits inside a replaced slot are moot: the slot's replacement wins. An
  // insertion exactly at either edge of the slot is outside it.
  const live = edits.filter(
    (edit) =>
      replacements.has(edit) ||
      ![...replacements].some((slot) =>
        edit.end > edit.start
          ? edit.start >= slot.start && edit.end <= slot.end
          : edit.start > slot.start && edit.start < slot.end,
      ),
  );
  return applyEdits(template, live);
}

/**
 * The document body a templated page carries between its content markers, or
 * null when `html` has none. Lets an importer skip the template's chrome.
 */
export function extractHtmlPageTemplateContent(html: string): string | null {
  const start = html.indexOf(HTML_PAGE_TEMPLATE_CONTENT_START);
  if (start < 0) return null;
  const from = start + HTML_PAGE_TEMPLATE_CONTENT_START.length;
  const end = html.lastIndexOf(HTML_PAGE_TEMPLATE_CONTENT_END);
  return end < from ? null : html.slice(from, end);
}

// ── Scanning ───────────────────────────────────────────────────────

interface ScannedAttribute {
  /** Lowercase name. */
  name: string;
  /** Raw (undecoded) value, or null for a bare attribute. */
  value: string | null;
  /** Offset of the attribute name. */
  start: number;
  /** Offset just past the attribute (its closing quote, if quoted). */
  end: number;
  valueStart: number;
  valueEnd: number;
}

interface StartTag {
  kind: 'start';
  /** Lowercase tag name. */
  name: string;
  start: number;
  end: number;
  /** Offset of the `>` (or `/>`) that closes the tag. */
  closeStart: number;
  selfClosing: boolean;
  attributes: ScannedAttribute[];
  /** Text content of a raw-text or RCDATA element (`<title>`, `<script>`, …). */
  text?: { start: number; end: number };
  /**
   * Inside `<template>` (shadow-tree or script-owned markup) or SVG/MathML,
   * where a `<slot>`, `<title>`, or `<meta>` is not page structure.
   */
  inert: boolean;
}

interface EndTag {
  kind: 'end';
  name: string;
  start: number;
  end: number;
  inert: boolean;
}

type Tag = StartTag | EndTag;

/** Elements whose content is text, not markup, up to their end tag. */
const TEXT_ELEMENTS = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
]);

/**
 * A tolerant scan of an HTML document's tags with source offsets. Covers what
 * template filling needs — comments, declarations, raw-text elements, and
 * attribute syntax — without building a tree.
 */
function scanHtml(html: string): Tag[] {
  const tags: Tag[] = [];
  let templateDepth = 0;
  let foreignDepth = 0;
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) break;
    const next = html[open + 1];
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      index = close < 0 ? html.length : close + 3;
    } else if (next === '!' || next === '?') {
      const close = html.indexOf('>', open + 2);
      index = close < 0 ? html.length : close + 1;
    } else if (next === '/' && isAsciiLetter(html[open + 2])) {
      const nameEnd = scanName(html, open + 2);
      const name = html.slice(open + 2, nameEnd).toLowerCase();
      const close = html.indexOf('>', nameEnd);
      const end = close < 0 ? html.length : close + 1;
      if (name === 'template' && templateDepth > 0) templateDepth--;
      if ((name === 'svg' || name === 'math') && foreignDepth > 0) foreignDepth--;
      tags.push({ kind: 'end', name, start: open, end, inert: templateDepth + foreignDepth > 0 });
      index = end;
    } else if (isAsciiLetter(next)) {
      const tag = scanStartTag(html, open, templateDepth + foreignDepth > 0);
      tags.push(tag);
      index = tag.end;
      if (tag.name === 'template') templateDepth++;
      else if ((tag.name === 'svg' || tag.name === 'math') && !tag.selfClosing) foreignDepth++;
      else if (TEXT_ELEMENTS.has(tag.name) && foreignDepth === 0) {
        const closing = new RegExp(`</${tag.name}(?=[\\s/>])`, 'gi');
        closing.lastIndex = tag.end;
        const match = closing.exec(html);
        const textEnd = match ? match.index : html.length;
        tag.text = { start: tag.end, end: textEnd };
        index = textEnd;
      }
    } else {
      index = open + 1;
    }
  }
  return tags;
}

function scanStartTag(html: string, start: number, inert: boolean): StartTag {
  const nameEnd = scanName(html, start + 1);
  const name = html.slice(start + 1, nameEnd).toLowerCase();
  const attributes: ScannedAttribute[] = [];
  let index = nameEnd;
  for (;;) {
    index = skipSpace(html, index);
    if (index >= html.length) {
      return {
        kind: 'start',
        name,
        start,
        end: html.length,
        closeStart: html.length,
        selfClosing: false,
        attributes,
        inert,
      };
    }
    const char = html[index];
    if (char === '>') {
      return {
        kind: 'start',
        name,
        start,
        end: index + 1,
        closeStart: index,
        selfClosing: false,
        attributes,
        inert,
      };
    }
    if (char === '/') {
      if (html[index + 1] === '>') {
        return {
          kind: 'start',
          name,
          start,
          end: index + 2,
          closeStart: index,
          selfClosing: true,
          attributes,
          inert,
        };
      }
      index++;
      continue;
    }
    const attributeStart = index;
    index++;
    while (index < html.length && !isSpace(html[index]) && !'/>='.includes(html[index])) index++;
    const attributeName = html.slice(attributeStart, index).toLowerCase();
    const afterName = index;
    index = skipSpace(html, index);
    if (html[index] !== '=') {
      attributes.push({
        name: attributeName,
        value: null,
        start: attributeStart,
        end: afterName,
        valueStart: afterName,
        valueEnd: afterName,
      });
      continue;
    }
    index = skipSpace(html, index + 1);
    const quote = html[index];
    let valueStart: number;
    let valueEnd: number;
    if (quote === '"' || quote === "'") {
      valueStart = index + 1;
      const close = html.indexOf(quote, valueStart);
      valueEnd = close < 0 ? html.length : close;
      index = close < 0 ? html.length : close + 1;
    } else {
      valueStart = index;
      while (index < html.length && !isSpace(html[index]) && html[index] !== '>') index++;
      valueEnd = index;
    }
    attributes.push({
      name: attributeName,
      value: html.slice(valueStart, valueEnd),
      start: attributeStart,
      end: index,
      valueStart,
      valueEnd,
    });
  }
}

function scanName(html: string, from: number): number {
  let index = from;
  while (
    index < html.length &&
    !isSpace(html[index]) &&
    html[index] !== '/' &&
    html[index] !== '>'
  ) {
    index++;
  }
  return index;
}

function skipSpace(html: string, from: number): number {
  let index = from;
  while (index < html.length && isSpace(html[index])) index++;
  return index;
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
}

function isAsciiLetter(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z]$/.test(char);
}

function attributeValue(tag: StartTag, name: string): string | undefined {
  return tag.attributes.find((attribute) => attribute.name === name)?.value ?? undefined;
}

// ── Slots ──────────────────────────────────────────────────────────

interface SlotRange {
  /** Null for the unnamed (content) slot. */
  name: string | null;
  start: number;
  end: number;
  /** The fallback children: between the start and end tags. */
  contentStart: number;
  contentEnd: number;
}

function collectSlots(tags: readonly Tag[]): {
  slots: SlotRange[];
  issues: Array<{ message: string; offset: number }>;
} {
  const slots: SlotRange[] = [];
  const issues: Array<{ message: string; offset: number }> = [];
  let open: StartTag | null = null;
  for (const tag of tags) {
    if (tag.name !== 'slot' || tag.inert) continue;
    if (tag.kind === 'start') {
      if (open) {
        issues.push({
          message: 'A <slot> cannot be placed inside another <slot>.',
          offset: tag.start,
        });
        continue;
      }
      if (tag.selfClosing) {
        slots.push({
          name: slotName(tag),
          start: tag.start,
          end: tag.end,
          contentStart: tag.end,
          contentEnd: tag.end,
        });
      } else {
        open = tag;
      }
    } else if (open) {
      slots.push({
        name: slotName(open),
        start: open.start,
        end: tag.end,
        contentStart: open.end,
        contentEnd: tag.start,
      });
      open = null;
    } else {
      issues.push({ message: 'A </slot> has no matching <slot>.', offset: tag.start });
    }
  }
  if (open) {
    issues.push({
      message: 'A <slot> is never closed; write <slot></slot> or <slot/>.',
      offset: open.start,
    });
  }
  return { slots, issues };
}

function slotName(tag: StartTag): string | null {
  const name = attributeValue(tag, 'name')?.trim();
  return name ? name : null;
}

/** Fill the slots written as text inside `<title>`, or replace the text. */
function fillTitleText(text: string, valueFor: (name: string) => string | undefined): string {
  const { slots } = collectSlots(scanHtml(text));
  if (slots.length === 0) return escapeHtml(valueFor('title') ?? '');
  const edits: Edit[] = slots.map((slot) => {
    const value = valueFor(slot.name ?? 'title');
    return {
      start: slot.start,
      end: slot.end,
      text:
        value === undefined ? text.slice(slot.contentStart, slot.contentEnd) : escapeHtml(value),
    };
  });
  return applyEdits(text, edits);
}

const TITLE_META = new Set(['og:title', 'twitter:title']);
const DESCRIPTION_META = new Set(['description', 'og:description', 'twitter:description']);

function metaValue(
  key: string,
  title: string,
  description: string | undefined,
): string | undefined {
  if (TITLE_META.has(key)) return title;
  if (DESCRIPTION_META.has(key)) return description;
  return undefined;
}

/**
 * Where head additions go: before the template's first stylesheet or style
 * block so its own CSS cascades last, else at the end of `<head>`.
 */
function headInsertionPoint(tags: readonly Tag[]): number {
  for (const tag of tags) {
    if (tag.inert) continue;
    if (tag.kind === 'end' && tag.name === 'head') return tag.start;
    if (tag.kind !== 'start') continue;
    if (tag.name === 'body') return tag.start;
    if (tag.name === 'style') return tag.start;
    if (
      tag.name === 'link' &&
      (attributeValue(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')
    ) {
      return tag.start;
    }
  }
  const container = tags.find(
    (tag) => tag.kind === 'start' && (tag.name === 'head' || tag.name === 'html'),
  );
  return container?.end ?? 0;
}

// ── URL rebasing ───────────────────────────────────────────────────

const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'poster',
  'action',
  'formaction',
  'cite',
  'data',
  'background',
  'xlink:href',
]);
const SRCSET_ATTRIBUTES = new Set(['srcset', 'imagesrcset']);

/**
 * Rewrite a template-relative URL to resolve the same from `toDir`. Absolute,
 * root-relative, fragment, query-only, and scheme URLs are left alone, as is
 * any path that climbs out of the container.
 */
function rebaseUrl(raw: string, fromDir: string, toDir: string): string {
  const url = raw.trim();
  if (
    !url ||
    url.startsWith('#') ||
    url.startsWith('?') ||
    url.startsWith('/') ||
    url.startsWith('\\') ||
    /^[a-z][a-z0-9+.-]*:/i.test(url) ||
    url.includes('{{')
  ) {
    return raw;
  }
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  const suffix = cut < 0 ? '' : url.slice(cut);
  // Entity-encoded paths are rare enough not to decode.
  if (path.includes('&')) return raw;
  const target = normalizePath(fromDir ? `${fromDir}/${path}` : path);
  if (target === null) return raw;
  const isDirectory = path.endsWith('/') || /(?:^|\/)\.\.?$/.test(path);
  let relative = relativeTo(toDir, target);
  if (isDirectory) relative = relative ? `${relative}/` : './';
  const leading = raw.slice(0, raw.length - raw.trimStart().length);
  const trailing = raw.slice(raw.trimEnd().length);
  return `${leading}${relative}${suffix}${trailing}`;
}

/** Rebase each candidate URL in a `srcset`, keeping descriptors and separators. */
function rebaseSrcset(raw: string, fromDir: string, toDir: string): string {
  let out = '';
  let index = 0;
  while (index < raw.length) {
    const separator = /^[\s,]*/.exec(raw.slice(index))?.[0] ?? '';
    out += separator;
    index += separator.length;
    if (index >= raw.length) break;
    let urlEnd = index;
    while (urlEnd < raw.length && !isSpace(raw[urlEnd])) urlEnd++;
    let url = raw.slice(index, urlEnd);
    const commas = /,+$/.exec(url)?.[0] ?? '';
    url = url.slice(0, url.length - commas.length);
    out += rebaseUrl(url, fromDir, toDir) + commas;
    index = urlEnd;
    if (commas) continue;
    let descriptorEnd = index;
    let depth = 0;
    while (descriptorEnd < raw.length) {
      const char = raw[descriptorEnd];
      if (char === '(') depth++;
      else if (char === ')') depth = Math.max(0, depth - 1);
      else if (char === ',' && depth === 0) break;
      descriptorEnd++;
    }
    out += raw.slice(index, descriptorEnd);
    index = descriptorEnd;
  }
  return out;
}

/** Relative path from directory `fromDir` to `target` (both normalized). */
function relativeTo(fromDir: string, target: string): string {
  const from = fromDir ? fromDir.split('/') : [];
  const to = target ? target.split('/') : [];
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/');
}

function posixDirname(path: string): string {
  const normalized = normalizePath(path.replace(/\\/g, '/')) ?? '';
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

// ── Editing ────────────────────────────────────────────────────────

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Apply non-overlapping edits; insertions at an offset precede a replacement there. */
function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort(
    (a, b) => a.start - b.start || Number(a.end > a.start) - Number(b.end > b.start),
  );
  let out = '';
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) continue;
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}

function lineIndex(source: string): (offset: number) => number {
  return (offset) => {
    let line = 1;
    for (
      let index = source.indexOf('\n');
      index >= 0 && index < offset;
      index = source.indexOf('\n', index + 1)
    ) {
      line++;
    }
    return line;
  };
}

function describeIssue(issue: HtmlPageTemplateIssue): string {
  return `${issue.message} (line ${issue.line})`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
