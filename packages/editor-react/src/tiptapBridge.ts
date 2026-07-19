/**
 * Tiptap Bridge
 *
 * Conversion utilities between raw markdown source and Tiptap's JSON/HTML
 * content format. Uses a lightweight HTML-based approach: we convert markdown
 * to a simple HTML representation that Tiptap can consume, and parse
 * Tiptap's HTML output back to markdown.
 *
 * This bridge preserves markdown semantics much better than going through
 * Tiptap's native markdown extension, since we control the conversion
 * using squisq's own parser.
 */

import { resolveIcon } from '@bendyline/squisq/icons';
import {
  matchTrailingTemplateAnnotation,
  matchTrailingPandocAttr,
  tokenizeAttrTokens,
} from '@bendyline/squisq/markdown';

// Hoisted regex patterns for inline markdown ↔ HTML conversion
//
// Emphasis carries CommonMark-ish flanking guards. Two rules matter:
//
//  1. A delimiter run may not open when followed by whitespace, nor close
//     when preceded by whitespace. Without this, prose arithmetic such as
//     `2 * 3 * 4` silently became `2 <em> 3 </em> 4`.
//  2. `_` additionally may not open when preceded by, nor close when
//     followed by, an alphanumeric — CommonMark forbids intraword `_`
//     emphasis. Without this, `snake_case_name` and `my_file_v2.txt`
//     became `snake<em>case</em>name` in the editor and were rewritten to
//     `snake*case*name` on the way out: permanent byte corruption of any
//     document mentioning an identifier or a filename. `*` IS allowed
//     intraword in CommonMark, so the star rules stay boundary-free.
//
// The `[\s*]` / `[\s_]` guards also stop a single-delimiter rule from
// pairing ACROSS a double-delimiter run (`** bold **` must stay literal
// rather than becoming `<em>* bold *</em>`).
//
// Backslash-escaped delimiters never reach these patterns: `inlineToHtml`
// swaps them for opaque sentinels first (see ESCAPABLE_MD_CHARS).
const RE_BOLD_STAR = /\*\*(?![\s*])(.+?)(?<![\s*])\*\*/g;
const RE_BOLD_UNDER = /(?<![\p{L}\p{N}_])__(?![\s_])(.+?)(?<![\s_])__(?![\p{L}\p{N}_])/gu;
const RE_ITALIC_STAR = /\*(?![\s*])(.+?)(?<![\s*])\*/g;
const RE_ITALIC_UNDER = /(?<![\p{L}\p{N}_])_(?![\s_])(.+?)(?<![\s_])_(?![\p{L}\p{N}_])/gu;
const RE_STRIKETHROUGH = /~~(.+?)~~/g;

// The delimiters whose backslash escapes this pass understands. `\\` is
// included so an even backslash run collapses correctly instead of
// leaking a literal backslash in front of live emphasis.
const ESCAPABLE_MD_CHARS: readonly string[] = ['*', '_', '~', '\\'];
const RE_MD_ESCAPE = /\\([*_~\\])/g;

const RE_INLINE_CODE = /`(.+?)`/g;
// `*?` on the alt — an empty alt (`![](foo.png)`) is valid markdown and
// the most common shape for pasted/uploaded images that don't yet have
// a human-picked caption. Previously required at least one alt char,
// which dropped those images on the floor during markdown→HTML.
const RE_IMAGE = /!\[(.*?)\]\((.+?)\)/g;
// Mentions: `@[Display](scheme:id)` — scheme-part must start with a letter
// so plain `$100` or price-style parentheticals don't accidentally match.
// remark-stringify may round-trip the colon as `\:` — tolerate either.
const RE_MENTION = /@\[([^\]]+?)\]\(([a-z][a-z0-9+.-]*)\\?:([^)\s]+)\)/gi;
const RE_MENTION_TAG = /<span\b[^>]*?\bdata-mention\b[^>]*?>(?:<[^>]+>)*([^<]*)<\/span>/gi;

// Inline FontAwesome icon. Markdown form: `{[github]}` (bare) or
// `{[fa-solid:user]}` (qualified). HTML form (produced by the
// `InlineIcon` Tiptap node and consumed back by `htmlToInline`):
// `<i data-icon="github" data-family="brands" data-name="github"
//     class="fa-brands fa-github" contenteditable="false"></i>`.
const RE_ICON_MD = /\{\[([a-zA-Z0-9_:-]+)\]\}/g;
const RE_ICON_TAG = /<i\b[^>]*?\bdata-icon="([^"]*)"[^>]*?><\/i>/gi;
const RE_STRONG_TAG = /<strong>(.*?)<\/strong>/g;
const RE_B_TAG = /<b>(.*?)<\/b>/g;
const RE_EM_TAG = /<em>(.*?)<\/em>/g;
const RE_I_TAG = /<i>(.*?)<\/i>/g;
const RE_S_TAG = /<s>(.*?)<\/s>/g;
const RE_DEL_TAG = /<del>(.*?)<\/del>/g;
const RE_CODE_TAG = /<code>(.*?)<\/code>/g;
// Attribute-order agnostic: Tiptap's Link extension renders
// `<a target rel href>` while `markdownToTiptap` emits `<a href title>`.
// The attrs are parsed out of the capture rather than positionally so a
// `title` on either side of `href` is still found.
const RE_A_TAG = /<a\b([^>]*)>(.*?)<\/a>/g;
// Matches any `<img>` tag and captures its `src` + `alt` regardless of
// attribute order. TipTap's Image extension renders `<img src="..."
// alt="...">` (src first), while some other producers — including our
// own `markdownToTiptap` conversion — emit alt-first. The previous
// regex required alt-before-src and silently dropped every src-first
// image; `RE_STRIP_TAGS` below would then delete the unmatched tag,
// so the outgoing markdown had no image reference at all.
const RE_IMG_TAG = /<img\b([^>]*)>/g;
const RE_STRIP_TAGS = /<[^>]+>/g;

/**
 * Convert raw markdown source to Tiptap-consumable HTML content.
 * Uses a simple markdown-to-HTML conversion that maps cleanly to
 * Tiptap's ProseMirror schema.
 */
export function markdownToTiptap(markdown: string): string {
  if (!markdown.trim()) return '<p></p>';

  // Normalize line endings — content from zip archives may use \r\n
  const html = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Process blocks line by line for accurate conversion
  const lines = html.split('\n');
  // Line index of a leading YAML frontmatter block's CLOSING `---`, or -1.
  // The bridge has never understood frontmatter (it renders the fences as
  // <hr> and the keys as paragraphs), but the setext-heading rule below must
  // still not reach across it: `squisq-theme: fresh` sitting above the
  // closing `---` looks exactly like a setext h2, and claiming it would eat
  // the fence and destroy the whole frontmatter block.
  const frontmatterEnd = findFrontmatterEnd(lines);
  const outputBlocks: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  // Open list levels, shallowest first. A markdown list nests by INDENT,
  // but Tiptap nests by markup (the child `<ul>` is a child of the parent
  // `<li>`, a sibling of that item's `<p>`). The stack bridges the two: an
  // item stays "open" until we know whether a deeper list follows it, so
  // the sublist can be appended inside it. A flat accumulator could not
  // express this and dropped indented items out of the list entirely.
  interface ListLevel {
    indent: number;
    /**
     * Shallowest indent still considered INSIDE this level's parent item.
     * An item above this column closes the level; one below it merely snaps
     * the level's own indent down (a ragged dedent stays a sibling rather
     * than escaping to the parent list) — matching core's CommonMark parser.
     */
    minIndent: number;
    type: 'ul' | 'ol' | 'task';
    /**
     * First ordinal of an `ol` (the number the author actually wrote). Only
     * the FIRST item's number counts — CommonMark ignores the rest and so
     * does `<ol start>`. Dropping this renumbered any list that continues
     * after an interruption (`5.` came back as `1.`).
     */
    start: number | null;
    items: string[];
    openAttrs: string | null;
    openContent: string;
  }
  const listStack: ListLevel[] = [];
  let inTable = false;
  let tableLines: string[] = [];
  let pendingBlankLines = 0;
  /**
   * Whether the most recently emitted TOP-LEVEL block was a list. Only the
   * indented-code detector reads it: a 4-space line right after a list is list
   * continuation (core reads `- a\n\n    - b` as a nested list), not code.
   */
  let lastBlockWasList = false;

  const flushPendingBlankParagraphs = () => {
    if (pendingBlankLines === 0) return;
    const emptyParagraphs =
      outputBlocks.length === 0 ? pendingBlankLines : Math.max(0, pendingBlankLines - 1);
    for (let i = 0; i < emptyParagraphs; i++) {
      outputBlocks.push('<p></p>');
    }
    pendingBlankLines = 0;
  };

  const pushBlock = (block: string) => {
    flushPendingBlankParagraphs();
    outputBlocks.push(block);
    lastBlockWasList = false;
  };

  const sealOpenItem = (level: ListLevel) => {
    if (level.openAttrs === null) return;
    level.items.push(`<li${level.openAttrs}>${level.openContent}</li>`);
    level.openAttrs = null;
    level.openContent = '';
  };

  /** Close the deepest level, nesting its markup into the parent's open item. */
  const popListLevel = () => {
    const level = listStack.pop();
    if (!level) return;
    sealOpenItem(level);
    if (level.items.length === 0) return;
    const tag = level.type === 'ol' ? 'ol' : 'ul';
    let attr = level.type === 'task' ? ' data-type="taskList"' : '';
    // `start` is the ProseMirror OrderedList attribute; Tiptap round-trips it
    // and only renders it when it differs from the default of 1.
    if (level.type === 'ol' && level.start != null && level.start !== 1) {
      attr += ` start="${level.start}"`;
    }
    const html = `<${tag}${attr}>${level.items.join('')}</${tag}>`;
    const parent = listStack[listStack.length - 1];
    if (!parent) {
      pushBlock(html);
      lastBlockWasList = true;
      return;
    }
    if (parent.openAttrs === null) {
      // A sublist with no preceding sibling item — give it an empty host
      // item so the nesting still has somewhere valid to live.
      parent.openAttrs = parent.type === 'task' ? ' data-type="taskItem"' : '';
      parent.openContent = '<p></p>';
    }
    parent.openContent += html;
  };

  const flushList = () => {
    while (listStack.length > 0) popListLevel();
  };

  const addListItem = (
    indent: number,
    type: 'ul' | 'ol' | 'task',
    attrs: string,
    content: string,
    /** Ordinal the author wrote, for `ol` only. Used when OPENING a level. */
    start: number | null = null,
  ) => {
    while (listStack.length > 0 && indent < listStack[listStack.length - 1].minIndent) {
      popListLevel();
    }
    const top = listStack[listStack.length - 1];
    if (!top) {
      listStack.push({
        indent,
        minIndent: 0,
        type,
        start,
        items: [],
        openAttrs: attrs,
        openContent: content,
      });
      return;
    }
    if (indent > top.indent) {
      // Deeper than the current level's marker — open a nested list inside
      // the level's open item. Anything indented past the parent's marker
      // stays inside that item.
      listStack.push({
        indent,
        minIndent: top.indent + 1,
        type,
        start,
        items: [],
        openAttrs: attrs,
        openContent: content,
      });
      return;
    }
    // Same level (or a ragged dedent that is still inside the parent item).
    if (indent < top.indent) top.indent = indent;
    if (top.type !== type) {
      // A different marker at the same depth starts a sibling list.
      const { indent: depth, minIndent } = top;
      popListLevel();
      listStack.push({
        indent: depth,
        minIndent,
        type,
        start,
        items: [],
        openAttrs: attrs,
        openContent: content,
      });
      return;
    }
    sealOpenItem(top);
    top.openAttrs = attrs;
    top.openContent = content;
  };

  const flushTable = () => {
    if (!inTable || tableLines.length === 0) {
      inTable = false;
      tableLines = [];
      return;
    }

    // Validate: need at least 2 lines and second must be a separator
    const separatorCells = tableLines.length >= 2 ? parseTableCells(tableLines[1]) : [];
    const isSeparator =
      separatorCells.length > 0 && separatorCells.every((cell) => /^:?-+:?$/.test(cell.trim()));

    if (tableLines.length < 2 || !isSeparator) {
      // Not a valid table — render accumulated lines as paragraphs
      for (const tl of tableLines) {
        pushBlock(`<p>${inlineToHtml(tl)}</p>`);
      }
      inTable = false;
      tableLines = [];
      return;
    }

    const alignments = parseAlignments(tableLines[1]);
    const headerCells = parseTableCells(tableLines[0]);

    // Build header row
    const thHtml = headerCells
      .map((cell, i) => {
        const align = alignments[i];
        const style = align ? ` style="text-align: ${align}"` : '';
        return `<th${style}>${inlineToHtml(cell)}</th>`;
      })
      .join('');

    // Build body rows
    const bodyHtml = tableLines
      .slice(2)
      .map((rowLine) => {
        const cells = parseTableCells(rowLine);
        const tdHtml = cells
          .map((cell, i) => {
            const align = alignments[i];
            const style = align ? ` style="text-align: ${align}"` : '';
            return `<td${style}>${inlineToHtml(cell)}</td>`;
          })
          .join('');
        return `<tr>${tdHtml}</tr>`;
      })
      .join('');

    pushBlock(`<table><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);

    inTable = false;
    tableLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence handling
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushList();
        // A fence is the ONE block start reached before the generic
        // "line is not a table row → flushTable()" guard below (that guard
        // runs after the in-code-block early-continue, which a fence must
        // precede). Without this call the buffered table rows stayed queued
        // and were flushed by the fence's own `pushBlock`, emitting the
        // <pre> BEFORE the <table>: a table immediately followed by a fence
        // came back with its blocks in the opposite ORDER.
        flushTable();
        flushPendingBlankParagraphs();
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        const langAttr = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
        pushBlock(`<pre><code${langAttr}>${escapeHtml(codeBlockLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
        codeBlockLang = '';
        codeBlockLines = [];
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // If in table and current line is not a table row, flush
    if (inTable && !/^\|.*\|$/.test(line.trim())) {
      flushTable();
    }

    // Blank line flushes list
    if (line.trim() === '') {
      flushList();
      pendingBlankLines++;
      continue;
    }

    // Must be sampled BEFORE flushPendingBlankParagraphs() zeroes the count.
    // An indented code block may not interrupt a paragraph, so it needs to
    // know whether a blank line (or the document start) precedes it.
    const precededByBlank = pendingBlankLines > 0 || outputBlocks.length === 0;

    // Indented (4-space / tab) code block. Checked before every other block
    // start because in CommonMark an indent of 4+ columns disqualifies ATX
    // headings, thematic breaks and list markers alike: `    - item` after a
    // blank line is code that READS "- item", not a bullet. Previously these
    // lines fell through to the paragraph branch, where `preserveLeadingSpaces`
    // turned the indent into nbsp and — far worse — the inline-emphasis
    // regexes ran over the code text, rewriting `*ptr` and `y_z` as emphasis.
    //
    // The guards keep this away from list content, which is the OTHER meaning
    // of a 4-space indent: an open list level means we are inside item content,
    // and `lastBlockWasList` covers the case where a blank line already
    // closed the bridge's list stack but core would still read the indented
    // line as that list's continuation (`- a\n\n    - b` is a nested list).
    if (
      precededByBlank &&
      !inTable &&
      listStack.length === 0 &&
      !lastBlockWasList &&
      isIndentedCodeLine(line)
    ) {
      const codeLines: string[] = [];
      let scan = i;
      for (; scan < lines.length; scan++) {
        const scanned = lines[scan];
        // A blank line inside the block belongs to the code (core reads
        // `    a\n\n    b` as one code block whose value is "a\n\nb").
        if (scanned.trim() === '') {
          codeLines.push('');
          continue;
        }
        if (!isIndentedCodeLine(scanned)) break;
        codeLines.push(stripCodeIndent(scanned));
      }
      // Trailing blanks belong to whatever follows, not to the code block.
      let end = codeLines.length;
      while (end > 0 && codeLines[end - 1] === '') end--;
      const trailingBlanks = codeLines.length - end;
      codeLines.length = end;
      // Hand the trailing blank lines back to the loop so the normal
      // blank-line accounting still sees them.
      i = scan - trailingBlanks - 1;
      // No info string: an indented code block has no language, exactly like
      // a bare ``` fence. Both are `code` with a null lang in core's mdast,
      // and core's own serializer normalizes indented code to a fence too.
      pushBlock(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    flushPendingBlankParagraphs();

    // Headings (ATX — `# Title`)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      pushBlock(headingToHtml(headingMatch[1].length, headingMatch[2]));
      continue;
    }

    // Thematic break
    if (/^(---|\*\*\*|___)(\s*)$/.test(line.trim())) {
      flushList();
      pushBlock('<hr>');
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      const quoteLines = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        quoteLines.push(lines[i].slice(2));
      }
      pushBlock(
        `<blockquote>${quoteLines.map((quoteLine) => `<p>${inlineToHtml(quoteLine)}</p>`).join('')}</blockquote>`,
      );
      continue;
    }

    // Task list item. Text is optional so freshly-typed, still-empty tasks
    // survive a round-trip. The checkbox itself is drawn by TaskItem's node
    // view from the data-checked attribute, so we only emit the text content
    // (in a paragraph, matching Tiptap's own node structure).
    const taskMatch = line.match(/^([ \t]*)[-*+]\s+\[([xX ])\]\s*(.*)$/);
    if (taskMatch) {
      const checkedAttr = taskMatch[2].toLowerCase() === 'x' ? ' data-checked="true"' : '';
      addListItem(
        indentWidth(taskMatch[1]),
        'task',
        ` data-type="taskItem"${checkedAttr}`,
        `<p>${inlineToHtml(taskMatch[3])}</p>`,
      );
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^([ \t]*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      addListItem(indentWidth(ulMatch[1]), 'ul', '', `<p>${inlineToHtml(ulMatch[2])}</p>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^([ \t]*)(\d+)\.\s+(.+)$/);
    if (olMatch) {
      addListItem(
        indentWidth(olMatch[1]),
        'ol',
        '',
        `<p>${inlineToHtml(olMatch[3])}</p>`,
        parseInt(olMatch[2], 10),
      );
      continue;
    }

    // Table row
    if (/^\|.*\|$/.test(line.trim())) {
      if (!inTable) {
        flushList();
        inTable = true;
        tableLines = [];
      }
      tableLines.push(line);
      continue;
    }

    // Standalone image — emit as a top-level block `<img>` instead of
    // wrapping in `<p>`. The Tiptap Image extension is configured with
    // `inline: false`, so `<p><img></p>` parses to an empty paragraph
    // (the block image can't live inside the paragraph). That bug
    // manifested as a broken-image glyph after a markdown → WYSIWYG
    // round-trip for any dropped/pasted image.
    const standaloneImageMatch = line.trim().match(/^!\[(.*?)\]\((.+?)\)$/);
    if (standaloneImageMatch) {
      flushList();
      const alt = escapeHtml(standaloneImageMatch[1] ?? '');
      const src = escapeHtml(standaloneImageMatch[2] ?? '');
      pushBlock(`<img alt="${alt}" src="${src}">`);
      continue;
    }

    // Standalone raw HTML `<img>` line — emitted by `tiptapToMarkdown`
    // when the user has resized an image (width/height attrs are
    // serialized as HTML rather than markdown shorthand so the
    // dimensions survive round-trip). Pass the tag through unchanged
    // so Tiptap's Image extension parses width/height attributes.
    const trimmed = line.trim();
    if (/^<img\b[^>]*>$/i.test(trimmed)) {
      flushList();
      pushBlock(trimmed);
      continue;
    }

    // Standalone `<video>` / `<audio>` line — emitted by the recorder
    // (RecorderEntry) when it saves a clip, and by `tiptapToMarkdown`
    // when the WYSIWYG editor's TiptapVideo/TiptapAudio nodes serialize
    // back to markdown. Pass through unchanged so the editor's parseHTML
    // picks up the tag attributes (`src`, `controls`, …).
    if (/^<(?:video|audio)\b[^>]*>(?:[\s\S]*?<\/(?:video|audio)>)?$/i.test(trimmed)) {
      flushList();
      pushBlock(trimmed);
      continue;
    }

    // Setext heading (`Title` over `===` / `---`). Deliberately the LAST
    // check: a setext underline may only follow a PARAGRAPH, so this line
    // must be one that no other block start claimed. That ordering is what
    // keeps `- foo\n---` a list plus a thematic break and `# H\n---` an ATX
    // heading plus a thematic break, matching core.
    //
    // Without this the underline was reached on its own and the heading was
    // silently destroyed: `My Title\n---` became a paragraph plus an <hr>
    // (`===` fared worse — two plain paragraphs), so any setext-authored
    // document lost its headings on the first WYSIWYG keystroke.
    const setextLevel =
      i + 1 < lines.length && i + 1 > frontmatterEnd ? matchSetextUnderline(lines[i + 1]) : null;
    if (setextLevel !== null) {
      flushList();
      i++; // consume the underline
      pushBlock(headingToHtml(setextLevel, line.trim()));
      continue;
    }

    // Regular paragraph
    flushList();
    pushBlock(`<p>${inlineToHtml(line)}</p>`);
  }

  // Close any remaining open blocks
  if (inCodeBlock) {
    const langAttr = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
    pushBlock(`<pre><code${langAttr}>${escapeHtml(codeBlockLines.join('\n'))}</code></pre>`);
  }
  flushList();
  flushTable();
  flushPendingBlankParagraphs();

  return outputBlocks.join('') || '<p></p>';
}

/**
 * Convert Tiptap HTML output back to markdown source.
 * Extracts semantic structure from HTML and produces clean markdown.
 */
export function tiptapToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return '';

  const lines: string[] = [];

  // Simple regex-based HTML to markdown conversion
  // This works because Tiptap produces clean, predictable HTML
  let remaining = html;

  while (remaining.length > 0) {
    // Headings
    const headingMatch = remaining.match(/^<h([1-6])([^>]*)>(.*?)<\/h\1>/s);
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10);
      const attrs = headingMatch[2];
      const headingHtml = headingMatch[3];
      // Template/property badges are editor chrome, not heading content. Strip
      // them structurally before converting the inline HTML. Older builds
      // briefly rendered the template label as real badge text; using the
      // markup boundary preserves that cleanup without mistaking a legitimate
      // heading suffix (for example "A Famous Quote") for the badge label.
      const chromeStart = headingHtml.search(
        /<span\b[^>]*\bclass="[^"]*\bsquisq-(?:template|props)-badge\b[^"]*"[^>]*>/i,
      );
      let text = htmlToInline(chromeStart >= 0 ? headingHtml.slice(0, chromeStart) : headingHtml);

      // Re-inject heading annotations from data attributes. Canonical
      // emit order: Pandoc `{#…}` first, then squisq `{[…]}` annotation
      // (matches blockToMdast in core/markdown/convert.ts).
      const blockAttrsMatch = attrs.match(/data-block-attrs="([^"]*)"/);
      const tmplMatch = attrs.match(/data-template="([^"]+)"/);
      const paramsMatch = attrs.match(/data-template-params="([^"]+)"/);
      const hasEmptyTemplateAnnotation = /\sdata-template-empty(?:="[^"]*")?/.test(attrs);
      if (blockAttrsMatch) {
        const inner = unescapeHtml(blockAttrsMatch[1]);
        text += ` {${inner}}`;
      }
      if (tmplMatch || paramsMatch) {
        let annotation = tmplMatch ? tmplMatch[1] : '';
        if (paramsMatch) {
          annotation += (annotation ? ' ' : '') + unescapeHtml(paramsMatch[1]);
        }
        text += ` {[${annotation}]}`;
      } else if (hasEmptyTemplateAnnotation) {
        text += ' {[]}';
      }

      lines.push('#'.repeat(level) + ' ' + text);
      lines.push('');
      remaining = remaining.slice(headingMatch[0].length);
      continue;
    }

    // Code blocks — tolerate attributes on <pre> and <code>: real
    // editor.getHTML() output carries class="squisq-code-block" on the
    // <pre> (StarterKit codeBlock HTMLAttributes), which a bare
    // `<pre><code` anchor never matches, silently dropping the fence.
    const codeMatch = remaining.match(/^<pre\b[^>]*><code\b([^>]*)>(.*?)<\/code><\/pre>/s);
    if (codeMatch) {
      const lang = /\bclass="language-([^"]*)"/.exec(codeMatch[1] ?? '')?.[1] ?? '';
      const code = unescapeHtml(codeMatch[2]);
      lines.push('```' + lang);
      lines.push(code);
      lines.push('```');
      lines.push('');
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Blockquote
    const bqMatch = remaining.match(/^<blockquote>(.*?)<\/blockquote>/s);
    if (bqMatch) {
      const paragraphs = bqMatch[1]
        .split(/<\/p>\s*<p[^>]*>/i)
        .map((paragraph) => paragraph.replace(/^<p[^>]*>/i, '').replace(/<\/p>\s*$/i, ''));
      for (const paragraph of paragraphs) {
        for (const quoteLine of htmlToInline(paragraph).split('\n')) {
          lines.push('> ' + quoteLine);
        }
      }
      const next = remaining.slice(bqMatch[0].length);
      // Older bridge output and direct Tiptap edits can still leave adjacent
      // blockquote nodes. Keep those nodes adjacent when serializing;
      // inserting the normal block separator here turns one quote into two
      // paragraphs every time the document passes through WYSIWYG mode.
      if (!/^\s*<blockquote>/.test(next)) lines.push('');
      remaining = next;
      continue;
    }

    // Horizontal rule
    if (
      remaining.startsWith('<hr>') ||
      remaining.startsWith('<hr/>') ||
      remaining.startsWith('<hr />')
    ) {
      const hrMatch = remaining.match(/^<hr\s*\/?>/);
      lines.push('---');
      lines.push('');
      remaining = remaining.slice(hrMatch![0].length);
      continue;
    }

    // Table (with optional Tiptap tableWrapper div; table tag may have style attrs)
    const tableMatch =
      remaining.match(
        /^<div[^>]*class="[^"]*tableWrapper[^"]*"[^>]*><table[^>]*>(.*?)<\/table>\s*<\/div>/s,
      ) || remaining.match(/^<table[^>]*>(.*?)<\/table>/s);
    if (tableMatch) {
      const tableContent = tableMatch[1];

      // Extract all rows with their cells
      const rows: { content: string; align: string | null; isHeader: boolean }[][] = [];
      const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
      let rowExec;
      while ((rowExec = rowRegex.exec(tableContent)) !== null) {
        const rowHtml = rowExec[1];
        const cells: { content: string; align: string | null; isHeader: boolean }[] = [];
        const cellRegex = /<(th|td)([^>]*)>(.*?)<\/\1>/gs;
        let cellExec;
        while ((cellExec = cellRegex.exec(rowHtml)) !== null) {
          const tag = cellExec[1];
          const attrs = cellExec[2];
          const content = htmlToInline(cellExec[3].replace(/<\/?p>/g, ''));
          const alignExec = attrs.match(/text-align:\s*(left|center|right)/);
          cells.push({
            content,
            align: alignExec ? alignExec[1] : null,
            isHeader: tag === 'th',
          });
        }
        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        // Header row = first row with th cells, or just the first row
        const headerIdx = rows.findIndex((r) => r.some((c) => c.isHeader));
        const hIdx = headerIdx >= 0 ? headerIdx : 0;
        const headerRow = rows[hIdx];
        const dataRows = rows.filter((_, i) => i !== hIdx);

        const aligns = headerRow.map((c) => c.align);
        lines.push('| ' + headerRow.map((c) => c.content || ' ').join(' | ') + ' |');
        lines.push(
          '| ' +
            aligns
              .map((a) => {
                if (a === 'center') return ':---:';
                if (a === 'right') return '---:';
                return '---';
              })
              .join(' | ') +
            ' |',
        );
        for (const row of dataRows) {
          lines.push('| ' + row.map((c) => c.content || ' ').join(' | ') + ' |');
        }
        lines.push('');
      }

      remaining = remaining.slice(tableMatch[0].length);
      continue;
    }

    // Lists — unordered, ordered and task lists all funnel through one
    // balanced-tag walk. The previous lazy `/^<ul>(.*?)<\/ul>/s` anchors
    // stopped at the first `</ul>`, so any nested list (the shape Tiptap
    // emits for every indented bullet, and what pasting from Google Docs
    // or Word produces) truncated the outer list mid-item: the child's
    // text fused into the parent bullet and every following sibling lost
    // its marker. `matchBalancedTag` counts depth instead.
    const listOpenMatch = remaining.match(/^<(ul|ol)\b([^>]*)>/i);
    if (listOpenMatch) {
      const tag = listOpenMatch[1].toLowerCase();
      const matched = matchBalancedTag(remaining, 0, tag);
      if (matched) {
        const isTask = /data-type="taskList"/i.test(listOpenMatch[2] ?? '');
        lines.push(
          ...renderList(matched.inner, tag === 'ol', isTask, '', readListStart(listOpenMatch[2])),
        );
        lines.push('');
        remaining = remaining.slice(matched.end);
        continue;
      }
    }

    // Paragraph
    const pMatch = remaining.match(/^<p>(.*?)<\/p>/s);
    if (pMatch) {
      const text = htmlToInline(pMatch[1]);
      if (text.trim()) {
        lines.push(text);
        lines.push('');
      } else {
        lines.push('');
      }
      remaining = remaining.slice(pMatch[0].length);
      continue;
    }

    // Block-level image. TipTap's Image extension with `inline: false`
    // emits `<img src alt>` as a bare top-level element (no wrapping
    // `<p>`). Without this handler the skip-unknown-tags catch-all
    // below silently drops the image from the outgoing markdown —
    // the bug that made the chat composer ship image-less messages
    // even though the editor showed the picture. Handled here,
    // before the inline walker ever sees it.
    const imgMatch = remaining.match(/^<img\b([^>]*)>/);
    if (imgMatch) {
      const attrs = imgMatch[1] ?? '';
      const src = /\bsrc="([^"]*)"/i.exec(attrs)?.[1];
      if (src) {
        const alt = /\balt="([^"]*)"/i.exec(attrs)?.[1] ?? '';
        lines.push(serializeImage(src, alt, attrs));
        lines.push('');
      }
      remaining = remaining.slice(imgMatch[0].length);
      continue;
    }

    // Block-level `<video>` / `<audio>` — emitted by our TiptapVideo /
    // TiptapAudio atom nodes (block group). Serialize the whole tag
    // (opening + closing) back to markdown unchanged; CommonMark allows
    // inline HTML, and our renderer plus the InlinePreviewGutter both
    // know how to parse the htmlElement back out.
    const mediaMatch = remaining.match(/^<(video|audio)\b([^>]*)>(?:[\s\S]*?<\/\1>)?/);
    if (mediaMatch) {
      const tag = mediaMatch[1] === 'video' ? 'video' : 'audio';
      lines.push(serializeMediaTag(tag, mediaMatch[2] ?? ''));
      lines.push('');
      remaining = remaining.slice(mediaMatch[0].length);
      continue;
    }

    // Skip unknown tags or whitespace
    const skipMatch = remaining.match(/^(<[^>]+>|\s+)/);
    if (skipMatch) {
      remaining = remaining.slice(skipMatch[0].length);
      continue;
    }

    // Plain text (shouldn't happen in well-formed Tiptap output)
    const textMatch = remaining.match(/^([^<]+)/);
    if (textMatch) {
      lines.push(unescapeHtml(textMatch[1]));
      remaining = remaining.slice(textMatch[0].length);
      continue;
    }

    // Safety: skip one character to avoid infinite loop
    remaining = remaining.slice(1);
  }

  return lines.join('\n');
}

/**
 * Find the tag opened at `start` and return its inner HTML plus the index
 * just past its matching close tag, counting nested opens of the same tag.
 *
 * A lazy `/^<ul>(.*?)<\/ul>/s` cannot do this: it stops at the FIRST
 * `</ul>`, which for any nested list is the INNER list's close tag. That
 * truncation is what fused a child bullet's text into its parent and
 * dropped the following siblings' markers entirely.
 */
function matchBalancedTag(
  html: string,
  start: number,
  tag: string,
): { inner: string; end: number } | null {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  let innerStart = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[0][1] === '/') {
      depth--;
      if (depth === 0)
        return { inner: html.slice(innerStart, match.index), end: match.index + match[0].length };
      if (depth < 0) return null;
    } else {
      if (depth === 0) {
        if (match.index !== start) return null;
        innerStart = match.index + match[0].length;
      }
      depth++;
    }
  }
  return null;
}

/** Split a list's inner HTML into its top-level `<li>` items (depth-counted). */
function splitTopLevelListItems(inner: string): { attrs: string; inner: string }[] {
  const items: { attrs: string; inner: string }[] = [];
  const re = /<li\b([^>]*)>|<\/li\s*>/gi;
  let depth = 0;
  let itemStart = -1;
  let itemAttrs = '';
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner)) !== null) {
    if (match[0][1] === '/') {
      depth--;
      if (depth === 0 && itemStart >= 0) {
        items.push({ attrs: itemAttrs, inner: inner.slice(itemStart, match.index) });
      }
      if (depth < 0) depth = 0;
    } else {
      if (depth === 0) {
        itemStart = match.index + match[0].length;
        itemAttrs = match[1] ?? '';
      }
      depth++;
    }
  }
  return items;
}

interface NestedList {
  ordered: boolean;
  task: boolean;
  inner: string;
  start: number;
}

/** Read an `<ol start="N">` attribute, defaulting to ProseMirror's start of 1. */
function readListStart(attrs: string | undefined): number {
  const parsed = parseInt(/\bstart="(\d+)"/i.exec(attrs ?? '')?.[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

/**
 * Separate an `<li>`'s own content from the lists nested inside it. Tiptap
 * nests a sublist as a CHILD of the `<li>`, as a sibling of the item's
 * `<p>` — so the nested markup must be lifted out before the item's text is
 * rendered, or it would be flattened into that text.
 */
function splitItemContent(itemHtml: string): { content: string; nested: NestedList[] } {
  const nested: NestedList[] = [];
  let content = '';
  let cursor = 0;
  const re = /<(ul|ol)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(itemHtml)) !== null) {
    const tag = match[1].toLowerCase();
    const matched = matchBalancedTag(itemHtml, match.index, tag);
    if (!matched) break;
    content += itemHtml.slice(cursor, match.index);
    nested.push({
      ordered: tag === 'ol',
      task: /data-type="taskList"/i.test(match[2] ?? ''),
      inner: matched.inner,
      start: readListStart(match[2]),
    });
    cursor = matched.end;
    // Skip past the whole nested list so only TOP-level lists are collected.
    re.lastIndex = matched.end;
  }
  return { content: content + itemHtml.slice(cursor), nested };
}

/**
 * Render a `<ul>`/`<ol>` (including task lists) as markdown lines, recursing
 * into nested lists at any depth. Sub-items are indented to the parent
 * marker's content column, which is what makes them re-parse as children.
 *
 * `start` is the first ordinal of an ordered list. Hard-coding it to 1 reset
 * every list that continues after an interruption, so `5. five` came back as
 * `1. five`. Marker WIDTH follows from the real ordinal, so the child indent
 * below stays correct for two-digit markers too.
 */
function renderList(
  inner: string,
  ordered: boolean,
  task: boolean,
  indent: string,
  start = 1,
): string[] {
  const lines: string[] = [];
  const items = splitTopLevelListItems(inner);

  items.forEach((item, idx) => {
    const { content, nested } = splitItemContent(item.inner);
    const marker = ordered ? `${start + idx}. ` : '- ';

    if (task) {
      // Read checked state from the attribute value only — a bare
      // includes('checked') matches the substring in data-checked="false".
      const checked = /data-checked="true"/.test(item.attrs);
      // Drop the checkbox chrome (<label>…</label>) before reading text;
      // Tiptap puts the task text in the trailing content node, not the label.
      const body = content.replace(/<label\b[^>]*>.*?<\/label>/s, '');
      const text = htmlToInline(body.replace(/<[^>]+>/g, '').trim());
      lines.push(`${indent}- [${checked ? 'x' : ' '}] ${text}`.trimEnd());
    } else {
      lines.push(...renderListItem(marker, content, indent));
    }

    const childIndent = indent + ' '.repeat(task ? 2 : marker.length);
    for (const child of nested) {
      lines.push(...renderList(child.inner, child.ordered, child.task, childIndent, child.start));
    }
  });

  return lines;
}

/**
 * Render a list item's HTML content as one or more markdown lines.
 * Handles `<p>` paragraph breaks (blank line) and `<br>` hard breaks
 * (two trailing spaces). Continuation lines are indented to keep them
 * inside the list item.
 */
function renderListItem(prefix: string, html: string, outerIndent = ''): string[] {
  const indent = outerIndent + ' '.repeat(prefix.length);

  // Pull out any block-level media nested in the item (e.g. a recording
  // dropped onto a list bullet, or a clip dragged into one). The inline
  // paragraph walk below ignores `<video>` / `<audio>` tags, so without
  // this they'd be silently dropped on serialize and lost from the
  // markdown source. We collect them and re-emit each as an indented
  // continuation line so they stay inside the list item and round-trip
  // through the markdown parser's block-media handler.
  const media: string[] = [];
  const htmlWithoutMedia = html.replace(
    /<(video|audio)\b([^>]*)>(?:[\s\S]*?<\/\1>)?/gi,
    (_full, tag: string, attrs: string) => {
      media.push(serializeMediaTag(tag.toLowerCase() === 'video' ? 'video' : 'audio', attrs ?? ''));
      return '';
    },
  );

  // Split on </p><p> to detect paragraph breaks within the item
  const paragraphs = htmlWithoutMedia
    .split(/<\/p>\s*<p[^>]*>/i)
    .map((p) => p.replace(/^<p[^>]*>/i, '').replace(/<\/p>\s*$/i, ''));

  const textLines: string[] = [];
  paragraphs.forEach((paragraph, pIdx) => {
    const inline = htmlToInline(paragraph).trim();
    if (!inline) return;

    // Each <br> already became "  \n" in htmlToInline; split on it now.
    const subLines = inline.split('\n');
    subLines.forEach((sub, sIdx) => {
      if (pIdx === 0 && sIdx === 0) {
        textLines.push(outerIndent + prefix + sub);
      } else {
        // Blank line separator between paragraphs (sIdx === 0 means new paragraph)
        if (sIdx === 0) textLines.push('');
        textLines.push(indent + sub);
      }
    });
  });

  if (textLines.length === 0 && media.length === 0) return [outerIndent + prefix];

  // Text first (its first line carries the bullet marker), then each media
  // tag as its own indented continuation block. If the item is media-only,
  // the first tag takes the bullet so the item isn't emitted empty.
  const result: string[] = [];
  if (textLines.length > 0) {
    result.push(...textLines);
    for (const tag of media) {
      result.push('');
      result.push(indent + tag);
    }
  } else {
    result.push(outerIndent + prefix + media[0]);
    for (const tag of media.slice(1)) {
      result.push('');
      result.push(indent + tag);
    }
  }
  return result;
}

/**
 * Line index of the closing `---` of a leading YAML frontmatter block, or -1
 * when the document has none. Mirrors core: a `---` on the FIRST line opens
 * frontmatter that runs to the next `---` line, and core's parser really does
 * read `---\nfoo\n---\nbar` that way (frontmatter + one paragraph).
 */
function findFrontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i;
  }
  return -1;
}

/**
 * Match a setext heading underline, returning the heading level it implies
 * (`=` → 1, `-` → 2) or null. Per CommonMark the run may be any length —
 * a single `-` counts — and may be indented up to three columns.
 */
function matchSetextUnderline(line: string): 1 | 2 | null {
  const match = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
  if (!match) return null;
  return match[1][0] === '=' ? 1 : 2;
}

/** A line that is indented far enough (4 columns / one tab) to be code. */
function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/.test(line) && line.trim() !== '';
}

/** Remove the 4-column indent that marks a line as indented code. */
function stripCodeIndent(line: string): string {
  return line.startsWith('\t') ? line.slice(1) : line.slice(4);
}

/**
 * Render a heading line's text as Tiptap heading HTML, peeling off any
 * trailing brace-blocks into data attributes.
 *
 * Shared by the ATX (`# Title`) and setext (`Title` / `---`) branches: the two
 * markdown spellings produce the SAME heading node, so annotation handling
 * must not depend on which one the author used.
 */
function headingToHtml(level: number, rawText: string): string {
  let text = rawText;
  let attrs = '';

  // Peel off trailing brace-blocks in any order: the squisq-native
  // `{[template …]}` annotation and the Pandoc `{#id .class key=value}`
  // attribute block may both appear at the end of the heading line.
  // Loop until neither matches. The matchers are imported from core so
  // this stays in sync with packages/core/src/markdown/convert.ts.
  let templateInner: string | null = null;
  let pandocInner: string | null = null;
  for (let pass = 0; pass < 4; pass++) {
    let matched = false;
    if (templateInner == null) {
      const m = matchTrailingTemplateAnnotation(text);
      if (m) {
        templateInner = m.inner.trim();
        text = text.slice(0, m.index).trimEnd();
        matched = true;
      }
    }
    if (pandocInner == null) {
      const m = matchTrailingPandocAttr(text);
      if (m) {
        pandocInner = m.inner.trim();
        text = text.slice(0, m.index).trimEnd();
        matched = true;
      }
    }
    if (!matched) break;
  }

  if (templateInner != null) {
    // Quote-aware tokenization (shared with the core parser) keeps a
    // quoted value like caption="Beach at sunset" as one token. The
    // tokens are stored raw — quotes included — so tiptapToMarkdown
    // can re-join them into the annotation verbatim.
    const tokens = tokenizeAttrTokens(templateInner);
    if (tokens.length === 0) {
      // Preserve an authored `{[]}` through the editable Tiptap document
      // while keeping the raw marker out of the visible heading text.
      attrs += ' data-template-empty="true"';
    }
    const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
    if (!firstIsParam && tokens[0]) {
      attrs += ` data-template="${escapeHtml(tokens[0])}"`;
    }
    const params = tokens.slice(firstIsParam ? 0 : 1).filter((t) => t.includes('='));
    if (params.length > 0) {
      attrs += ` data-template-params="${escapeHtml(params.join(' '))}"`;
    }
  }
  if (pandocInner != null) {
    attrs += ` data-block-attrs="${escapeHtml(pandocInner)}"`;
  }

  return `<h${level}${attrs}>${inlineToHtml(text)}</h${level}>`;
}

/** Leading-whitespace width of a list line, counting a tab as 4 columns. */
function indentWidth(raw: string): number {
  let width = 0;
  for (const ch of raw) width += ch === '\t' ? 4 : 1;
  return width;
}

// ─── Table helpers ───────────────────────────────────────

/** Split a GFM table row into trimmed cell strings (strips outer pipes). */
function parseTableCells(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  return inner.split('|').map((cell) => cell.trim());
}

/** Parse a GFM separator line into column alignments. */
function parseAlignments(separatorLine: string): (string | null)[] {
  return parseTableCells(separatorLine).map((cell) => {
    const s = cell.replace(/\s/g, '');
    if (s.startsWith(':') && s.endsWith(':')) return 'center';
    if (s.endsWith(':')) return 'right';
    if (s.startsWith(':')) return 'left';
    return null;
  });
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * Serialize a parsed `<img>` tag back to markdown. When the tag carries
 * an explicit `width` and/or `height` we emit a raw HTML `<img>` (the
 * markdown shorthand `![alt](src)` has no syntax for dimensions);
 * otherwise the friendlier shorthand is used. Markdown allows inline
 * HTML, so the HTML form parses and renders identically in any
 * CommonMark/GFM viewer.
 */
/**
 * Serialize a `<video>` or `<audio>` tag (from the Tiptap atom node's
 * `renderHTML`) back to markdown. We re-emit only the attributes the
 * recorder + the renderer care about, in a stable order, so the
 * round-tripped markdown stays deterministic regardless of how Tiptap
 * decided to order them on its output.
 */
function serializeMediaTag(tag: 'video' | 'audio', attrs: string): string {
  const src = /\bsrc="([^"]*)"/i.exec(attrs)?.[1] ?? '';
  const controls = /\bcontrols\b/i.test(attrs);
  const width = /\bwidth="([^"]*)"/i.exec(attrs)?.[1];
  const height = /\bheight="([^"]*)"/i.exec(attrs)?.[1];
  const poster = tag === 'video' ? /\bposter="([^"]*)"/i.exec(attrs)?.[1] : undefined;
  const placement =
    tag === 'video' ? /\bdata-squisq-video-placement="([^"]*)"/i.exec(attrs)?.[1] : undefined;
  const lockToBlock =
    tag === 'video' ? /\bdata-squisq-video-lock-to-block="([^"]*)"/i.exec(attrs)?.[1] : undefined;
  const startAt =
    tag === 'video' ? /\bdata-squisq-video-start-at="([^"]*)"/i.exec(attrs)?.[1] : undefined;
  const clipStart =
    tag === 'video' ? /\bdata-squisq-video-clip-start="([^"]*)"/i.exec(attrs)?.[1] : undefined;
  const clipEnd =
    tag === 'video' ? /\bdata-squisq-video-clip-end="([^"]*)"/i.exec(attrs)?.[1] : undefined;
  const parts = [`<${tag} src="${src}"`];
  if (controls) parts.push(' controls');
  if (width) parts.push(` width="${width}"`);
  if (height) parts.push(` height="${height}"`);
  if (poster) parts.push(` poster="${poster}"`);
  if (placement === 'picture-in-picture' || placement === 'overlay') {
    parts.push(` data-squisq-video-placement="${placement}"`);
  }
  if (lockToBlock === 'false') parts.push(' data-squisq-video-lock-to-block="false"');
  if (startAt != null) parts.push(` data-squisq-video-start-at="${startAt}"`);
  if (clipStart != null) parts.push(` data-squisq-video-clip-start="${clipStart}"`);
  if (clipEnd != null) parts.push(` data-squisq-video-clip-end="${clipEnd}"`);
  parts.push(`></${tag}>`);
  return parts.join('');
}

function serializeImage(src: string, alt: string, attrs: string): string {
  const width = /\bwidth="([^"]*)"/i.exec(attrs)?.[1];
  const height = /\bheight="([^"]*)"/i.exec(attrs)?.[1];
  const title = /\btitle="([^"]*)"/i.exec(attrs)?.[1];
  if (!width && !height) {
    return `![${alt}](${src})`;
  }
  const parts = [`<img alt="${alt}" src="${src}"`];
  if (width) parts.push(` width="${width}"`);
  if (height) parts.push(` height="${height}"`);
  if (title) parts.push(` title="${title}"`);
  parts.push('>');
  return parts.join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, '\u00a0')
    .replace(/&amp;/g, '&');
}

/** Convert inline markdown to HTML for Tiptap consumption */
function inlineToHtml(text: string): string {
  // Extract code/images/mentions/links to opaque placeholders BEFORE running
  // any other inline-formatting regexes. Otherwise `_` characters inside a URL
  // (e.g. `mikehome_files/IMG_6829.JPEG`) get turned into `<em>` tags by
  // the underscore-italic rule, mangling the src so the image renders
  // broken after a markdown ↔ WYSIWYG round-trip. Code comes first because
  // every markdown-looking character inside a code span must stay literal.
  const placeholders: string[] = [];
  const stash = (html: string): string => {
    const token = `\u0000PH${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };

  // We run extraction on the RAW text (before escapeHtml) so the
  // captured groups are the literal markdown contents; then we
  // selectively escape the parts of each placeholder that need it.
  let staged = text.replace(RE_INLINE_CODE, (_m, code) =>
    stash(`<code>${escapeHtml(code)}</code>`),
  );

  // Images first: ![alt](src) — must be before links so the `!` prefix is consumed
  staged = staged.replace(RE_IMAGE, (_m, alt, src) =>
    stash(`<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}">`),
  );

  // Mentions: @[Display](scheme:id) — must run before links so the
  // bracket+paren isn't consumed as a regular link.
  staged = staged.replace(RE_MENTION, (_m, label, kind, id) =>
    stash(
      `<span data-mention="true" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(id)}" data-label="${escapeHtml(label)}" class="mention">@${escapeHtml(label)}</span>`,
    ),
  );

  // FontAwesome inline icons: {[github]} / {[fa-solid:user]} — resolve
  // against the FA catalog so unknown / ambiguous tokens stay as
  // literal text (preserved through escapeHtml later). Stashing here
  // alongside images/mentions keeps the `_` and other punctuation in
  // the class attribute from being mangled by the underscore-italic
  // regex below.
  staged = staged.replace(RE_ICON_MD, (full, token) => {
    const icon = resolveIcon(token);
    if (!icon) return full; // leave literal text — author may have meant it
    return stash(
      `<i class="fa-${icon.family} fa-${icon.name}" data-icon="${escapeHtml(token)}" data-family="${icon.family}" data-name="${icon.name}" contenteditable="false"></i>`,
    );
  });

  // Links: [text](url) / [text](url "title") — stash but keep the link text
  // available to inline formatting by recursing. The destination must be
  // SPLIT from the optional title first: folding the whole thing into the
  // href produced `href="http://x.com &quot;T&quot;"`, a link that is broken
  // for as long as the document is open in the editor.
  staged = replaceMarkdownLinks(staged, (linkText, destination) => {
    const { url, title } = splitLinkDestination(destination);
    const titleAttr = title === null ? '' : ` title="${escapeHtml(title)}"`;
    return stash(`<a href="${escapeHtml(url)}"${titleAttr}>${inlineToHtml(linkText)}</a>`);
  });

  let result = escapeHtml(staged);

  // Neutralize backslash-escaped emphasis delimiters BEFORE the emphasis
  // regexes run. `\*not italic\*` previously matched RE_ITALIC_STAR from
  // the inner `*`, rendering real emphasis with stray visible backslashes
  // (`\<em>not italic\</em>`). Reusing the stash idiom keeps the escape
  // invisible to every pattern below, and the restore step swaps in the
  // BARE character, so no backslash survives into the editor either.
  // `\\*x*` still emphasizes: the even backslash run is consumed as one
  // escaped backslash before the delimiter is ever considered.
  result = result.replace(
    RE_MD_ESCAPE,
    (_m, ch: string) => `\u0000ESC${ESCAPABLE_MD_CHARS.indexOf(ch)}\u0000`,
  );

  // Bold: **text** or __text__
  result = result.replace(RE_BOLD_STAR, '<strong>$1</strong>');
  result = result.replace(RE_BOLD_UNDER, '<strong>$1</strong>');

  // Italic: *text* or _text_
  result = result.replace(RE_ITALIC_STAR, '<em>$1</em>');
  result = result.replace(RE_ITALIC_UNDER, '<em>$1</em>');

  // Strikethrough: ~~text~~
  result = result.replace(RE_STRIKETHROUGH, '<s>$1</s>');

  // Restore escaped delimiters as their literal character. split/join
  // rather than a regex: the sentinel is a control character, which a
  // RegExp literal cannot carry cleanly (and the placeholder restore
  // below already uses this same idiom).
  for (let index = 0; index < ESCAPABLE_MD_CHARS.length; index++) {
    result = result.split(`\u0000ESC${index}\u0000`).join(ESCAPABLE_MD_CHARS[index]);
  }

  // Restore newest placeholders first. A link placeholder can contain an
  // older code/icon placeholder from its label, so a single regex replacement
  // would leave that nested token unresolved.
  for (let index = placeholders.length - 1; index >= 0; index--) {
    result = result.split(`\u0000PH${index}\u0000`).join(placeholders[index] ?? '');
  }

  return preserveLeadingSpaces(result);
}

/**
 * Replace inline links while respecting balanced label brackets. A regex like
 * `\[(.+?)\]\((.+?)\)` incorrectly joins the two bracket pairs in prose such
 * as `[squiggly square], or [squisq](https://squisq.com)`, creating one giant
 * link. The small delimiter scanner also preserves valid nested link labels.
 */
function replaceMarkdownLinks(
  text: string,
  replace: (label: string, href: string) => string,
): string {
  let output = '';
  let consumedThrough = 0;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const labelOpen = text.indexOf('[', searchFrom);
    if (labelOpen < 0) break;
    if (isEscapedMarkdownCharacter(text, labelOpen)) {
      searchFrom = labelOpen + 1;
      continue;
    }

    const labelClose = findMatchingMarkdownDelimiter(text, labelOpen, '[', ']');
    const destinationOpen = labelClose + 1;
    if (labelClose < 0 || text[destinationOpen] !== '(') {
      searchFrom = labelOpen + 1;
      continue;
    }

    const destinationClose = findMatchingMarkdownDelimiter(text, destinationOpen, '(', ')');
    if (destinationClose < 0) {
      searchFrom = labelOpen + 1;
      continue;
    }

    const label = text.slice(labelOpen + 1, labelClose);
    const href = text.slice(destinationOpen + 1, destinationClose);
    // Match the bridge's historical regex behavior: empty labels or
    // destinations remain literal source.
    if (!label || !href) {
      searchFrom = labelOpen + 1;
      continue;
    }

    output += text.slice(consumedThrough, labelOpen) + replace(label, href);
    consumedThrough = destinationClose + 1;
    searchFrom = consumedThrough;
  }

  return output + text.slice(consumedThrough);
}

/**
 * Split a link destination into its URL and optional title.
 *
 * CommonMark allows `[t](url "title")`, `'title'` and `(title)`. Only a title
 * that runs to the very end of the destination counts, which is what keeps a
 * URL that merely CONTAINS quotes or parens — `http://x.com/a_(b)` — intact:
 * no separating whitespace, so the whole string stays the URL.
 */
function splitLinkDestination(destination: string): { url: string; title: string | null } {
  // Keyed by CLOSER: the title always ends the destination, so the final
  // character is what tells us which delimiter to look for.
  const OPENER_FOR: Record<string, string> = { '"': '"', "'": "'", ')': '(' };
  const trimmed = destination.trimEnd();
  const opener = OPENER_FOR[trimmed[trimmed.length - 1] ?? ''];
  if (!opener) return { url: destination.trim(), title: null };

  // Walk backwards from just inside the closer. `"` and `'` are their own
  // closer, so scanning FORWARD (or taking the last index outright) would
  // land on the closing delimiter rather than the opening one.
  for (let index = trimmed.length - 2; index > 0; index--) {
    if (trimmed[index] !== opener) continue;
    if (isEscapedMarkdownCharacter(trimmed, index)) continue;
    // A title must be separated from the URL by whitespace. Without this,
    // `http://x.com/a_(b)` would lose `(b)` to a phantom title.
    if (!/\s/.test(trimmed[index - 1])) continue;
    const url = trimmed.slice(0, index).trim();
    if (!url) continue;
    return {
      url,
      // Backslash escapes inside a title are real escapes (`\"` is a literal
      // quote), matching core's parser.
      title: trimmed.slice(index + 1, -1).replace(/\\([\\"'()])/g, '$1'),
    };
  }
  return { url: destination.trim(), title: null };
}

/**
 * Markdown-escape a link title that is still in its HTML-ESCAPED form.
 *
 * Every `htmlToInline` handler leaves attribute values entity-encoded and lets
 * the single trailing `unescapeHtml` decode them once; unescaping here instead
 * would decode a title twice (a literal `&amp;` would collapse to `&`). So the
 * quote is escaped through its entity: `\&quot;` decodes to `\"` on that final
 * pass. Backslashes go first so the one added for the quote isn't doubled.
 */
function escapeLinkTitleAttr(attrValue: string): string {
  return attrValue.replace(/\\/g, '\\\\').replace(/&quot;/g, '\\&quot;');
}

function findMatchingMarkdownDelimiter(
  text: string,
  start: number,
  open: '[' | '(',
  close: ']' | ')',
): number {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (isEscapedMarkdownCharacter(text, index)) continue;
    if (text[index] === open) depth++;
    if (text[index] !== close) continue;
    depth--;
    if (depth === 0) return index;
  }
  return -1;
}

function isEscapedMarkdownCharacter(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function isMarkdownWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/** Start/end of a text run counts as whitespace, matching CommonMark flanking. */
function isMarkdownSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/**
 * Bare URLs that GFM will autolink on re-parse. Their delimiters must NOT be
 * escaped: a backslash inside an autolink destination is not an escape, it is
 * a literal character of the URL (`.../_next/` would come back as
 * `.../\_next/`, a different — broken — link). Inside the autolink's extent
 * the delimiters are inert anyway, because the autolink consumes them before
 * emphasis pairing runs.
 *
 * Markdown-syntax links (`[x](url)`) don't need this: they're already stashed
 * out of the text before escaping.
 */
const RE_BARE_URL = /(?:https?:\/\/|ftp:\/\/|www\.)(?:\([^\s<>()]*\)|[^\s<>[\]()])+/gi;

/**
 * Escape the markdown delimiters in a run of literal TEXT so it survives a
 * re-parse as text rather than turning into emphasis.
 *
 * A delimiter reaching this function came from a text node, so by definition
 * it was NOT emphasis in the editor — escaping it can never lose meaning,
 * only add bytes. The escape is therefore deliberately MINIMAL rather than
 * blanket: a char is escaped only where the inbound rules above would
 * actually re-read it as a delimiter. That is what keeps `snake_case_name`,
 * `my_file_v2.txt`, `2 * 3 * 4` and `~/home` byte-identical through a
 * round-trip while still neutering `*not italic*`.
 *
 * Bare URLs are passed through verbatim (see {@link RE_BARE_URL}).
 *
 * NOTE on why `*` is escaped conservatively (whenever it could flank) rather
 * than only when a partner exists in the same text node: emphasis pairs
 * ACROSS text nodes. `a*b <em>x</em> c*d` serializes to `a*b *x* c*d`, whose
 * four delimiters re-pair into nested emphasis. Per-node pair counting is
 * therefore unsound, and the extra backslash is the price of correctness.
 */
function escapeMarkdownText(text: string): string {
  let out = '';
  let cursor = 0;
  RE_BARE_URL.lastIndex = 0;
  let url: RegExpExecArray | null;
  while ((url = RE_BARE_URL.exec(text)) !== null) {
    out += escapeMarkdownRun(text.slice(cursor, url.index));
    out += url[0];
    cursor = url.index + url[0].length;
  }
  return out + escapeMarkdownRun(text.slice(cursor));
}

/** Escape delimiters in a run of text known to contain no bare URL. */
function escapeMarkdownRun(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1];
    const next = text[i + 1];

    if (ch === '\\') {
      // Only double a backslash that would otherwise escape a delimiter we
      // handle; `C:\path` must stay `C:\path`.
      out += ESCAPABLE_MD_CHARS.includes(next ?? '') ? '\\\\' : '\\';
      continue;
    }
    if (ch === '~') {
      // Only `~~` opens strikethrough; a lone `~` (e.g. `~/home`) is literal.
      out += prev === '~' || next === '~' ? '\\~' : '~';
      continue;
    }
    if (ch === '*') {
      out += !isMarkdownSpace(next) || !isMarkdownSpace(prev) ? '\\*' : '*';
      continue;
    }
    if (ch === '_') {
      const canOpen = !isMarkdownWordChar(prev) && !isMarkdownSpace(next);
      const canClose = !isMarkdownWordChar(next) && !isMarkdownSpace(prev);
      out += canOpen || canClose ? '\\_' : '_';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Apply `escapeMarkdownText` to the text nodes of an HTML fragment, leaving
 * tags (and the literal contents of `<code>` spans) untouched. Must run
 * BEFORE the tag→markdown conversions below, otherwise it would escape the
 * `*` / `~~` delimiters those conversions legitimately emit.
 */
function escapeMarkdownTextNodes(html: string): string {
  let out = '';
  let cursor = 0;
  const re = /<code\b[^>]*>[\s\S]*?<\/code>|<[^>]+>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    out += escapeMarkdownText(html.slice(cursor, match.index));
    out += match[0];
    cursor = match.index + match[0].length;
  }
  return out + escapeMarkdownText(html.slice(cursor));
}

/** Convert inline HTML back to markdown */
function htmlToInline(html: string): string {
  let result = html;

  // Soft line breaks — convert <br> to GFM hard-break syntax (two trailing
  // spaces + newline) before stripping tags so the newline survives.
  result = result.replace(/<br\s*\/?>/gi, '  \n');

  // Escape literal markdown delimiters in the text BEFORE any tag becomes
  // markdown. Without this, prose the user typed as `\*not italic\*` came
  // back as a live `*not italic*` and rendered italic on the next parse.
  result = escapeMarkdownTextNodes(result);

  // FontAwesome inline icons — emit the original token. Must run before
  // RE_I_TAG (which matches a bare `<i>` and would otherwise eat icon
  // tags too). The token captured via data-icon already carries the
  // qualified form when needed, so source round-trips exactly.
  result = result.replace(RE_ICON_TAG, (_m, token) => `{[${token}]}`);

  // Strong
  result = result.replace(RE_STRONG_TAG, '**$1**');
  result = result.replace(RE_B_TAG, '**$1**');

  // Em
  result = result.replace(RE_EM_TAG, '*$1*');
  result = result.replace(RE_I_TAG, '*$1*');

  // Strikethrough
  result = result.replace(RE_S_TAG, '~~$1~~');
  result = result.replace(RE_DEL_TAG, '~~$1~~');

  // Code
  result = result.replace(RE_CODE_TAG, '`$1`');

  // Mentions — match before the link handler so the span isn't stripped
  // out as an unknown tag. Pull kind + id out of the data attributes.
  result = result.replace(RE_MENTION_TAG, (match, _inner) => {
    const kind = /data-kind="([^"]*)"/i.exec(match)?.[1] ?? '';
    const id = /data-id="([^"]*)"/i.exec(match)?.[1] ?? '';
    const label = /data-label="([^"]*)"/i.exec(match)?.[1] ?? '';
    if (!kind || !id || !label) return match;
    return `@[${label}](${kind}:${id})`;
  });

  // Links — re-emit the title as `[text](url "title")` when the anchor
  // carries one. Attributes are read by name so Tiptap's own
  // `<a target rel href>` ordering works as well as our `<a href title>`.
  result = result.replace(RE_A_TAG, (match, attrs: string, text: string) => {
    const href = /\bhref="([^"]*)"/i.exec(attrs)?.[1];
    if (href === undefined) return match;
    const title = /\btitle="([^"]*)"/i.exec(attrs)?.[1];
    const titlePart = title ? ` "${escapeLinkTitleAttr(title)}"` : '';
    return `[${text}](${href}${titlePart})`;
  });

  // Images — order-agnostic attribute parsing (tiptap emits src-first,
  // our markdown-to-html emits alt-first; either must serialize back).
  // When a width/height is present we serialize as raw HTML `<img>` so
  // the dimensions survive the round-trip; otherwise the markdown
  // shorthand `![alt](src)` is used.
  result = result.replace(RE_IMG_TAG, (match, attrs: string) => {
    const src = /\bsrc="([^"]*)"/i.exec(attrs)?.[1];
    if (!src) return match;
    const alt = /\balt="([^"]*)"/i.exec(attrs)?.[1] ?? '';
    return serializeImage(src, alt, attrs);
  });

  // Strip remaining tags
  result = result.replace(RE_STRIP_TAGS, '');

  return restoreLeadingSpaces(unescapeHtml(result));
}

function preserveLeadingSpaces(html: string): string {
  return html.replace(/^ +/, (spaces) => '&nbsp;'.repeat(spaces.length));
}

function restoreLeadingSpaces(text: string): string {
  return text.replace(/(^|\n)(\u00a0+)/g, (_match, prefix: string, spaces: string) => {
    return prefix + ' '.repeat(spaces.length);
  });
}
