/**
 * Fenced code blocks for the Markdown bridge, by CommonMark's rules.
 *
 * The bridge used to know one fence: three backticks at the left margin.
 * `~~~` fences became escaped paragraphs, info strings were cut to the
 * language (Tiptap keeps one `language-*` class), and a code line of
 * ```` ``` ```` closed its own fence on the way back out. The marker and the
 * info string past the language now ride on the `<pre>` as
 * `data-squisq-fence` / `data-squisq-fence-meta`, which
 * `tiptap/codeFenceSource.ts` keeps as code-block attributes.
 */

import { escapeHtml, unescapeHtml } from './htmlEntities';

const BACKTICK = '`';

/** An open code fence: CommonMark's opener rules, kept so its closer can be matched. */
export interface CodeFence {
  /** Leading spaces on the opener (0–3); content lines lose up to this many. */
  indent: number;
  /** The opening marker exactly as written: ```` ``` ````, `~~~`, or a longer run. */
  marker: string;
  /** The info string after the marker, trimmed. */
  info: string;
}

/**
 * A code fence opener: up to three spaces, then three or more backticks or
 * tildes. A backtick fence's info string may not contain a backtick (that
 * line is inline code instead).
 */
export function matchFenceOpen(line: string): CodeFence | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[2]!;
  const info = match[3]!;
  if (marker[0] === BACKTICK && info.includes(BACKTICK)) return null;
  return { indent: match[1]!.length, marker, info: info.trim() };
}

/** A closer is the opener's character, at least as long, with nothing after it. */
export function isFenceClose(line: string, fence: CodeFence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!match && match[1]![0] === fence.marker[0] && match[1]!.length >= fence.marker.length;
}

/** A content line without (up to) the opener's indent, as CommonMark specifies. */
export function fenceContentLine(line: string, fence: CodeFence): string {
  const indent = /^ */.exec(line)![0].length;
  return line.slice(Math.min(indent, fence.indent));
}

/** A fenced code block's HTML: the language as a class, the rest of the opener on <pre>. */
export function fencedCodeToHtml(fence: CodeFence, codeLines: readonly string[]): string {
  const [lang = '', ...rest] = fence.info.split(/\s+/);
  const meta = rest.join(' ');
  const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  const markerAttr = fence.marker === '```' ? '' : ` data-squisq-fence="${fence.marker}"`;
  const metaAttr = meta ? ` data-squisq-fence-meta="${escapeHtml(meta)}"` : '';
  return `<pre${markerAttr}${metaAttr}><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
}

/**
 * The fence to write `code` with: the author's marker when it is still safe,
 * else one longer than any marker run that opens a line of the code, so no
 * code line can close it early. Tildes when the info string has a backtick.
 */
function fenceForCode(code: string, info: string, preferred: string): string {
  const char = preferred[0] === '~' || info.includes(BACKTICK) ? '~' : BACKTICK;
  let length = preferred[0] === char ? Math.max(3, preferred.length) : 3;
  const runs = char === '~' ? /^ {0,3}(~{3,})/gm : /^ {0,3}(`{3,})/gm;
  for (const run of code.matchAll(runs)) length = Math.max(length, run[1]!.length + 1);
  return char.repeat(length);
}

/**
 * Markdown lines for a `<pre><code>` from the editor: the opener its author
 * wrote (marker and full info string) when that is still safe for the code.
 */
export function fencedCodeToMarkdown(
  preAttrs: string,
  codeAttrs: string,
  codeHtml: string,
): string[] {
  const lang = unescapeHtml(/\bclass="language-([^"]*)"/.exec(codeAttrs)?.[1] ?? '');
  const marker = /\bdata-squisq-fence="([`~]{3,})"/.exec(preAttrs)?.[1] ?? '```';
  const meta = unescapeHtml(/\bdata-squisq-fence-meta="([^"]*)"/.exec(preAttrs)?.[1] ?? '');
  const info = meta ? `${lang} ${meta}`.trim() : lang;
  const code = unescapeHtml(codeHtml);
  const fence = fenceForCode(code, info, marker);
  return [fence + info, code, fence];
}
