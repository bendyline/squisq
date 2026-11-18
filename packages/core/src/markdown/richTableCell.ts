/**
 * Rich table cells.
 *
 * A GFM table cell holds only inline content, so the Write view stores a cell
 * that holds blocks — a checklist, a list, several paragraphs — as one
 * sanitized HTML envelope on the row's single line:
 *
 *   | <div data-squisq-table-cell=""><ul data-type="taskList"><li data-checked="false" …>…</li></ul></div> |
 *
 * Parsed as Markdown, that is a run of inline HTML tags around the text, and
 * every renderer other than the editor printed the tags verbatim — on slides,
 * in PDF and Word. {@link readRichTableCell} turns the run into inline content
 * any renderer can draw: one line per paragraph or list item, list items
 * marked •, 1., ☐ or ☑, the lines joined by hard breaks, bold, italic, code
 * and links kept. The original envelope is returned too, so writing the
 * document back to Markdown reproduces the cell the editor can reopen.
 */

import type { MarkdownInlineNode } from './types.js';

export const RICH_TABLE_CELL_OPEN = '<div data-squisq-table-cell="">';
const RICH_TABLE_CELL_CLOSE = '</div>';

/** Inline formatting a rich cell's HTML can carry into the readable form. */
type Mark =
  | { kind: 'strong' | 'emphasis' | 'delete' | 'code' }
  | { kind: 'link'; url: string; title: string | null };

type ListFrame = { kind: 'bullet' | 'task' } | { kind: 'ordered'; next: number };

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);
const HEADING_TAG = /^h[1-6]$/;

interface Tag {
  name: string;
  closing: boolean;
  attributes: Record<string, string>;
}

function readTag(rawHtml: string): Tag | null {
  const match = /^<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>$/.exec(rawHtml.trim());
  if (!match) return null;
  const attributes: Record<string, string> = {};
  for (const attr of match[3].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g)) {
    attributes[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? '');
  }
  return { name: match[2].toLowerCase(), closing: Boolean(match[1]), attributes };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Escape text the way the Write view writes it into the envelope. */
function escapeCellText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;');
}

/** Drop the innermost open mark of `kind`, if any. */
function closeMark(marks: Mark[], kind: Mark['kind']): void {
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].kind === kind) {
      marks.splice(i, 1);
      return;
    }
  }
}

function wrap(text: string, marks: readonly Mark[]): MarkdownInlineNode {
  let node: MarkdownInlineNode = marks.some((mark) => mark.kind === 'code')
    ? { type: 'inlineCode', value: text }
    : { type: 'text', value: text };
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark.kind === 'code') continue;
    node =
      mark.kind === 'link'
        ? { type: 'link', url: mark.url, title: mark.title, children: [node] }
        : { type: mark.kind, children: [node] };
  }
  return node;
}

/**
 * When `children` (a table cell's parsed inline content) is a Write-view rich
 * cell, its readable inline form and its original HTML envelope; otherwise
 * null. Only cells made purely of the envelope's tags, text and line breaks
 * qualify, so an ordinary cell is never touched.
 */
export function readRichTableCell(
  children: readonly MarkdownInlineNode[],
): { inlines: MarkdownInlineNode[]; html: string } | null {
  const first = children[0];
  const last = children[children.length - 1];
  if (
    children.length < 2 ||
    first?.type !== 'htmlInline' ||
    first.rawHtml !== RICH_TABLE_CELL_OPEN ||
    last?.type !== 'htmlInline' ||
    last.rawHtml !== RICH_TABLE_CELL_CLOSE ||
    children.some((child) => child.type !== 'htmlInline' && child.type !== 'text')
  ) {
    return null;
  }

  const lines: MarkdownInlineNode[][] = [[]];
  let lineHasText = false;
  const marks: Mark[] = [];
  const lists: ListFrame[] = [];
  const startLine = () => {
    if (lines[lines.length - 1].length > 0) lines.push([]);
    lineHasText = false;
  };
  const html: string[] = [];

  for (const child of children) {
    if (child.type === 'text') {
      html.push(escapeCellText(child.value));
      if (child.value.length === 0) continue;
      lines[lines.length - 1].push(wrap(child.value, marks));
      lineHasText = true;
      continue;
    }
    if (child.type !== 'htmlInline') continue;
    html.push(child.rawHtml);
    const tag = readTag(child.rawHtml);
    if (!tag) continue;
    const { name, closing, attributes } = tag;

    if (name === 'br') {
      lines.push([]);
      lineHasText = false;
      continue;
    }
    if (name === 'ul' || name === 'ol') {
      if (closing) lists.pop();
      else if (name === 'ol') lists.push({ kind: 'ordered', next: Number(attributes.start) || 1 });
      else lists.push({ kind: attributes['data-type'] === 'taskList' ? 'task' : 'bullet' });
      continue;
    }
    if (BLOCK_TAGS.has(name)) {
      if (closing) {
        if (HEADING_TAG.test(name)) closeMark(marks, 'strong');
        if (lineHasText) startLine();
        continue;
      }
      // A paragraph inside a list item continues the item's own line.
      if (lineHasText) startLine();
      if (name === 'li') {
        const list = lists[lists.length - 1];
        const indent = '  '.repeat(Math.max(0, lists.length - 1));
        const marker =
          list?.kind === 'task'
            ? attributes['data-checked'] === 'true'
              ? '☑ '
              : '☐ '
            : list?.kind === 'ordered'
              ? `${String(list.next++)}. `
              : '• ';
        lines[lines.length - 1].push({ type: 'text', value: indent + marker });
      }
      if (HEADING_TAG.test(name)) marks.push({ kind: 'strong' });
      continue;
    }
    const markKind =
      name === 'strong' || name === 'b'
        ? 'strong'
        : name === 'em' || name === 'i'
          ? 'emphasis'
          : name === 's' || name === 'del' || name === 'strike'
            ? 'delete'
            : name === 'code'
              ? 'code'
              : name === 'a'
                ? 'link'
                : null;
    if (!markKind) continue;
    if (closing) {
      closeMark(marks, markKind);
    } else if (markKind === 'link') {
      marks.push({ kind: 'link', url: attributes.href ?? '', title: attributes.title || null });
    } else {
      marks.push({ kind: markKind });
    }
  }

  const kept = lines.filter((line) => line.length > 0);
  const inlines: MarkdownInlineNode[] = [];
  kept.forEach((line, index) => {
    if (index > 0) inlines.push({ type: 'break' });
    inlines.push(...line);
  });
  return { inlines, html: html.join('') };
}
