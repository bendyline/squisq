import { splitKeyValueToken, tokenizeAttrTokens } from '@bendyline/squisq/markdown';

interface MediaReferenceRange {
  start: number;
  end: number;
}

interface MarkdownReferenceMatch {
  destination: string;
  range: MediaReferenceRange;
}

const MEDIA_REFERENCE_PARAM_KEYS = new Set([
  'audio',
  'file',
  'href',
  'image',
  'imagesrc',
  'path',
  'poster',
  'src',
  'url',
  'video',
]);

const HTML_MEDIA_ATTRS = ['src', 'href', 'poster'] as const;

/**
 * Collect media references from the document source. Used by the Files panel
 * to distinguish stored files that are actually referenced by the document
 * from files that only exist in the bin.
 */
export function collectMediaReferencesFromMarkdown(source: string): ReadonlySet<string> {
  const refs = new Set<string>();
  collectMarkdownInlineReferences(source, refs);
  collectHtmlAttributeReferences(source, refs);
  collectAnnotationReferences(source, refs);
  return refs;
}

/**
 * Remove markdown/html references to a media asset without reparsing and
 * reserializing the whole document. This targets the ref shapes the editor
 * emits for uploaded files while preserving unrelated author formatting.
 */
export function removeMediaReferencesFromMarkdown(source: string, mediaPath: string): string {
  if (!mediaPath) return source;
  const withoutMarkdownRefs = removeMarkdownInlineReferences(source, mediaPath);
  const withoutImageTags = removeHtmlTagsByAttribute(withoutMarkdownRefs, 'img', 'src', mediaPath);
  return removeHtmlTagsByAttribute(withoutImageTags, 'a', 'href', mediaPath);
}

function removeMarkdownInlineReferences(source: string, mediaPath: string): string {
  let result = '';
  let cursor = 0;

  while (cursor < source.length) {
    const range = findNextMarkdownReference(source, cursor, mediaPath);
    if (!range) break;
    result += source.slice(cursor, range.start);
    cursor = range.end;
  }

  return result + source.slice(cursor);
}

function findNextMarkdownReference(
  source: string,
  startIndex: number,
  mediaPath: string,
): MediaReferenceRange | null {
  const match = findNextMarkdownReferenceMatch(source, startIndex, mediaPath);
  return match?.range ?? null;
}

function collectMarkdownInlineReferences(source: string, refs: Set<string>): void {
  let cursor = 0;
  while (cursor < source.length) {
    const match = findNextMarkdownReferenceMatch(source, cursor);
    if (!match) return;
    refs.add(match.destination);
    cursor = Math.max(match.range.end, cursor + 1);
  }
}

function findNextMarkdownReferenceMatch(
  source: string,
  startIndex: number,
  mediaPath?: string,
): MarkdownReferenceMatch | null {
  let bracketIndex = source.indexOf('[', startIndex);

  while (bracketIndex !== -1) {
    const previous = source[bracketIndex - 1];
    const isImage = previous === '!';
    if (previous === '@') {
      bracketIndex = source.indexOf('[', bracketIndex + 1);
      continue;
    }

    const closeBracket = findClosingBracket(source, bracketIndex);
    if (closeBracket === -1 || source[closeBracket + 1] !== '(') {
      bracketIndex = source.indexOf('[', bracketIndex + 1);
      continue;
    }

    const openParen = closeBracket + 1;
    const closeParen = findClosingParen(source, openParen);
    if (closeParen === -1) {
      bracketIndex = source.indexOf('[', bracketIndex + 1);
      continue;
    }

    const destination = readLinkDestination(source.slice(openParen + 1, closeParen));
    if (destination && (mediaPath === undefined || destination === mediaPath)) {
      const tokenStart = isImage ? bracketIndex - 1 : bracketIndex;
      return {
        destination,
        range: expandStandaloneLine(source, tokenStart, closeParen + 1),
      };
    }

    bracketIndex = source.indexOf('[', bracketIndex + 1);
  }

  return null;
}

function collectHtmlAttributeReferences(source: string, refs: Set<string>): void {
  const tagPattern = /<[a-z][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source))) {
    const tag = match[0];
    for (const attrName of HTML_MEDIA_ATTRS) {
      const value = readHtmlAttribute(tag, attrName);
      if (value) refs.add(value);
    }
  }
}

function collectAnnotationReferences(source: string, refs: Set<string>): void {
  const annotationPattern = /\{\[([^\]]*)\]\}/g;
  let match: RegExpExecArray | null;

  while ((match = annotationPattern.exec(source))) {
    const inner = match[1];
    if (!inner) continue;
    const tokens = tokenizeAttrTokens(inner);
    for (const token of tokens) {
      const pair = splitKeyValueToken(token);
      if (!pair) continue;
      if (MEDIA_REFERENCE_PARAM_KEYS.has(pair.key.toLowerCase())) {
        refs.add(pair.value);
      }
    }
  }
}

function findClosingBracket(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === '[') depth += 1;
    if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findClosingParen(source: string, openIndex: number): number {
  let depth = 0;
  let inAngleDestination = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inAngleDestination) {
      if (ch === '>') inAngleDestination = false;
      continue;
    }
    if (ch === '<') {
      inAngleDestination = true;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function readLinkDestination(raw: string): string {
  const content = raw.trimStart();
  if (!content) return '';

  if (content.startsWith('<')) {
    const close = findUnescaped(content, '>', 1);
    if (close === -1) return '';
    return unescapeMarkdownUrl(content.slice(1, close));
  }

  let depth = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')' && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      return unescapeMarkdownUrl(content.slice(0, i));
    }
  }

  return unescapeMarkdownUrl(content);
}

function findUnescaped(source: string, needle: string, startIndex: number): number {
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === needle) return i;
  }
  return -1;
}

function unescapeMarkdownUrl(value: string): string {
  return value.replace(/\\([\\`*{}[\]()#+\-.!_>])/g, '$1');
}

function expandStandaloneLine(source: string, start: number, end: number): MediaReferenceRange {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const nextNewline = source.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd);

  if (before.trim() === '' && after.trim() === '') {
    return {
      start: lineStart,
      end: nextNewline === -1 ? lineEnd : lineEnd + 1,
    };
  }

  return { start, end };
}

function removeHtmlTagsByAttribute(
  source: string,
  tagName: 'a' | 'img',
  attrName: 'href' | 'src',
  mediaPath: string,
): string {
  const tagPattern = tagName === 'img' ? /<img\b[^>]*>/gi : /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  return source.replace(tagPattern, (tag) => {
    const value = readHtmlAttribute(tag, attrName);
    return value === mediaPath ? '' : tag;
  });
}

function readHtmlAttribute(tag: string, attrName: string): string | null {
  const attrPattern = new RegExp(`\\b${attrName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = attrPattern.exec(tag);
  if (!match) return null;
  return unescapeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '');
}

function unescapeHtmlAttribute(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
