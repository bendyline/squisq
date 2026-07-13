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
const RE_BOLD_STAR = /\*\*(.+?)\*\*/g;
const RE_BOLD_UNDER = /__(.+?)__/g;
const RE_ITALIC_STAR = /\*(.+?)\*/g;
const RE_ITALIC_UNDER = /_(.+?)_/g;
const RE_STRIKETHROUGH = /~~(.+?)~~/g;
const RE_INLINE_CODE = /`(.+?)`/g;
const RE_LINK = /\[(.+?)\]\((.+?)\)/g;
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
const RE_A_TAG = /<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/g;
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
  const outputBlocks: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let inList = false;
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | 'task' = 'ul';
  let inTable = false;
  let tableLines: string[] = [];
  let pendingBlankLines = 0;

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
  };

  const flushList = () => {
    if (inList && listItems.length > 0) {
      const tag = listType === 'ol' ? 'ol' : 'ul';
      const attr = listType === 'task' ? ' data-type="taskList"' : '';
      pushBlock(`<${tag}${attr}>${listItems.join('')}</${tag}>`);
      listItems = [];
      inList = false;
    }
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

    flushPendingBlankParagraphs();

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      let text = headingMatch[2];
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

      pushBlock(`<h${level}${attrs}>${inlineToHtml(text)}</h${level}>`);
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
    const taskMatch = line.match(/^[-*+]\s+\[([xX ])\]\s*(.*)$/);
    if (taskMatch) {
      if (!inList || listType !== 'task') {
        flushList();
        inList = true;
        listType = 'task';
      }
      const checkedAttr = taskMatch[1].toLowerCase() === 'x' ? ' data-checked="true"' : '';
      listItems.push(
        `<li data-type="taskItem"${checkedAttr}><p>${inlineToHtml(taskMatch[2])}</p></li>`,
      );
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        flushList();
        inList = true;
        listType = 'ul';
      }
      listItems.push(`<li><p>${inlineToHtml(ulMatch[1])}</p></li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        flushList();
        inList = true;
        listType = 'ol';
      }
      listItems.push(`<li><p>${inlineToHtml(olMatch[1])}</p></li>`);
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

    // Task list
    const taskListMatch = remaining.match(/^<ul[^>]*data-type="taskList"[^>]*>(.*?)<\/ul>/s);
    if (taskListMatch) {
      const items = taskListMatch[1].matchAll(/<li[^>]*data-type="taskItem"[^>]*>.*?<\/li>/gs);
      for (const item of items) {
        // Read checked state from the attribute value only — a bare
        // includes('checked') matches the substring in data-checked="false".
        const checked = /data-checked="true"/.test(item[0]);
        // Drop the checkbox chrome (<label>…</label>) before reading text;
        // Tiptap puts the task text in the trailing content node, not the label.
        const body = item[0].replace(/<label\b[^>]*>.*?<\/label>/s, '');
        const text = htmlToInline(body.replace(/<[^>]+>/g, '').trim());
        lines.push(`- [${checked ? 'x' : ' '}] ${text}`.trimEnd());
      }
      lines.push('');
      remaining = remaining.slice(taskListMatch[0].length);
      continue;
    }

    // Unordered list
    const ulMatch = remaining.match(/^<ul>(.*?)<\/ul>/s);
    if (ulMatch) {
      const items = ulMatch[1].matchAll(/<li>(.*?)<\/li>/gs);
      for (const item of items) {
        lines.push(...renderListItem('- ', item[1]));
      }
      lines.push('');
      remaining = remaining.slice(ulMatch[0].length);
      continue;
    }

    // Ordered list
    const olMatch = remaining.match(/^<ol[^>]*>(.*?)<\/ol>/s);
    if (olMatch) {
      const items = [...olMatch[1].matchAll(/<li>(.*?)<\/li>/gs)];
      items.forEach((item, idx) => {
        lines.push(...renderListItem(`${idx + 1}. `, item[1]));
      });
      lines.push('');
      remaining = remaining.slice(olMatch[0].length);
      continue;
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
 * Render a list item's HTML content as one or more markdown lines.
 * Handles `<p>` paragraph breaks (blank line) and `<br>` hard breaks
 * (two trailing spaces). Continuation lines are indented to keep them
 * inside the list item.
 */
function renderListItem(prefix: string, html: string): string[] {
  const indent = ' '.repeat(prefix.length);

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
        textLines.push(prefix + sub);
      } else {
        // Blank line separator between paragraphs (sIdx === 0 means new paragraph)
        if (sIdx === 0) textLines.push('');
        textLines.push(indent + sub);
      }
    });
  });

  if (textLines.length === 0 && media.length === 0) return [prefix];

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
    result.push(prefix + media[0]);
    for (const tag of media.slice(1)) {
      result.push('');
      result.push(indent + tag);
    }
  }
  return result;
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
  const parts = [`<${tag} src="${src}"`];
  if (controls) parts.push(' controls');
  if (width) parts.push(` width="${width}"`);
  if (height) parts.push(` height="${height}"`);
  if (poster) parts.push(` poster="${poster}"`);
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
  // Extract images/mentions/links to opaque placeholders BEFORE running
  // any inline-formatting regexes. Otherwise `_` characters inside a URL
  // (e.g. `mikehome_files/IMG_6829.JPEG`) get turned into `<em>` tags by
  // the underscore-italic rule, mangling the src so the image renders
  // broken after a markdown ↔ WYSIWYG round-trip.
  const placeholders: string[] = [];
  const stash = (html: string): string => {
    const token = `\u0000PH${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };

  // We run extraction on the RAW text (before escapeHtml) so the
  // captured groups are the literal markdown contents; then we
  // selectively escape the parts of each placeholder that need it.

  // Images first: ![alt](src) — must be before links so the `!` prefix is consumed
  let staged = text.replace(RE_IMAGE, (_m, alt, src) =>
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

  // Links: [text](url) — stash but keep the link text available to
  // inline formatting by recursing.
  staged = staged.replace(RE_LINK, (_m, linkText, href) =>
    stash(`<a href="${escapeHtml(href)}">${inlineToHtml(linkText)}</a>`),
  );

  let result = escapeHtml(staged);

  // Bold: **text** or __text__
  result = result.replace(RE_BOLD_STAR, '<strong>$1</strong>');
  result = result.replace(RE_BOLD_UNDER, '<strong>$1</strong>');

  // Italic: *text* or _text_
  result = result.replace(RE_ITALIC_STAR, '<em>$1</em>');
  result = result.replace(RE_ITALIC_UNDER, '<em>$1</em>');

  // Strikethrough: ~~text~~
  result = result.replace(RE_STRIKETHROUGH, '<s>$1</s>');

  // Inline code: `text`
  result = result.replace(RE_INLINE_CODE, '<code>$1</code>');

  // Restore placeholders. escapeHtml turned each `\u0000PHn\u0000` into
  // the same string (the NULs and digits are escape-safe), so the
  // restoration regex still matches.
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\u0000PH(\d+)\u0000/g, (_m, idx) => placeholders[Number(idx)] ?? '');

  return preserveLeadingSpaces(result);
}

/** Convert inline HTML back to markdown */
function htmlToInline(html: string): string {
  let result = html;

  // Soft line breaks — convert <br> to GFM hard-break syntax (two trailing
  // spaces + newline) before stripping tags so the newline survives.
  result = result.replace(/<br\s*\/?>/gi, '  \n');

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

  // Links
  result = result.replace(RE_A_TAG, '[$2]($1)');

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
