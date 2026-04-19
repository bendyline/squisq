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

// Hoisted regex patterns for inline markdown ↔ HTML conversion
const RE_BOLD_STAR = /\*\*(.+?)\*\*/g;
const RE_BOLD_UNDER = /__(.+?)__/g;
const RE_ITALIC_STAR = /\*(.+?)\*/g;
const RE_ITALIC_UNDER = /_(.+?)_/g;
const RE_STRIKETHROUGH = /~~(.+?)~~/g;
const RE_INLINE_CODE = /`(.+?)`/g;
const RE_LINK = /\[(.+?)\]\((.+?)\)/g;
const RE_IMAGE = /!\[(.+?)\]\((.+?)\)/g;
// Mentions: `@[Display](scheme:id)` — scheme-part must start with a letter
// so plain `$100` or price-style parentheticals don't accidentally match.
// remark-stringify may round-trip the colon as `\:` — tolerate either.
const RE_MENTION = /@\[([^\]]+?)\]\(([a-z][a-z0-9+.-]*)\\?:([^)\s]+)\)/gi;
const RE_MENTION_TAG = /<span\b[^>]*?\bdata-mention\b[^>]*?>(?:<[^>]+>)*([^<]*)<\/span>/gi;
const RE_STRONG_TAG = /<strong>(.*?)<\/strong>/g;
const RE_B_TAG = /<b>(.*?)<\/b>/g;
const RE_EM_TAG = /<em>(.*?)<\/em>/g;
const RE_I_TAG = /<i>(.*?)<\/i>/g;
const RE_S_TAG = /<s>(.*?)<\/s>/g;
const RE_DEL_TAG = /<del>(.*?)<\/del>/g;
const RE_CODE_TAG = /<code>(.*?)<\/code>/g;
const RE_A_TAG = /<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/g;
const RE_IMG_TAG = /<img[^>]+alt="([^"]*)"[^>]+src="([^"]*)"[^>]*>/g;
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

  const flushList = () => {
    if (inList && listItems.length > 0) {
      const tag = listType === 'ol' ? 'ol' : 'ul';
      const attr = listType === 'task' ? ' data-type="taskList"' : '';
      outputBlocks.push(`<${tag}${attr}>${listItems.join('')}</${tag}>`);
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
        outputBlocks.push(`<p>${inlineToHtml(tl)}</p>`);
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

    outputBlocks.push(`<table><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);

    inTable = false;
    tableLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fence handling
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushList();
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        const langAttr = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
        outputBlocks.push(
          `<pre><code${langAttr}>${escapeHtml(codeBlockLines.join('\n'))}</code></pre>`,
        );
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
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      let text = headingMatch[2];
      let attrs = '';

      // Extract {[template key=value …]} annotation
      const annotMatch = text.match(/\s*\{\[([^\]]+)\]\}\s*$/);
      if (annotMatch) {
        text = text.slice(0, annotMatch.index!).trimEnd();
        const tokens = annotMatch[1].trim().split(/\s+/);
        attrs = ` data-template="${escapeHtml(tokens[0])}"`;
        const params = tokens.slice(1).filter((t) => t.includes('='));
        if (params.length > 0) {
          attrs += ` data-template-params="${escapeHtml(params.join(' '))}"`;
        }
      }

      outputBlocks.push(`<h${level}${attrs}>${inlineToHtml(text)}</h${level}>`);
      continue;
    }

    // Thematic break
    if (/^(---|\*\*\*|___)(\s*)$/.test(line.trim())) {
      flushList();
      outputBlocks.push('<hr>');
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      outputBlocks.push(`<blockquote><p>${inlineToHtml(line.slice(2))}</p></blockquote>`);
      continue;
    }

    // Task list item
    const taskMatch = line.match(/^[-*+]\s+\[([xX ])\]\s+(.+)$/);
    if (taskMatch) {
      if (!inList || listType !== 'task') {
        flushList();
        inList = true;
        listType = 'task';
      }
      const checked = taskMatch[1].toLowerCase() === 'x' ? ' data-checked="true"' : '';
      listItems.push(
        `<li data-type="taskItem"${checked}><label><input type="checkbox"${checked ? ' checked' : ''}>${inlineToHtml(taskMatch[2])}</label></li>`,
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

    // Regular paragraph
    flushList();
    outputBlocks.push(`<p>${inlineToHtml(line)}</p>`);
  }

  // Close any remaining open blocks
  if (inCodeBlock) {
    const langAttr = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
    outputBlocks.push(
      `<pre><code${langAttr}>${escapeHtml(codeBlockLines.join('\n'))}</code></pre>`,
    );
  }
  flushList();
  flushTable();

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
      let text = htmlToInline(headingMatch[3]);

      // Re-inject template annotation from data attributes
      const tmplMatch = attrs.match(/data-template="([^"]+)"/);
      if (tmplMatch) {
        let annotation = tmplMatch[1];
        const paramsMatch = attrs.match(/data-template-params="([^"]+)"/);
        if (paramsMatch) {
          annotation += ' ' + unescapeHtml(paramsMatch[1]);
        }
        text += ` {[${annotation}]}`;
      }

      lines.push('#'.repeat(level) + ' ' + text);
      lines.push('');
      remaining = remaining.slice(headingMatch[0].length);
      continue;
    }

    // Code blocks
    const codeMatch = remaining.match(
      /^<pre><code(?:\s+class="language-([^"]*)")?>(.*?)<\/code><\/pre>/s,
    );
    if (codeMatch) {
      const lang = codeMatch[1] || '';
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
      const inner = htmlToInline(bqMatch[1].replace(/<\/?p>/g, ''));
      lines.push('> ' + inner);
      lines.push('');
      remaining = remaining.slice(bqMatch[0].length);
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
      const items = taskListMatch[1].matchAll(
        /<li[^>]*data-type="taskItem"[^>]*(data-checked="true")?[^>]*>.*?<\/li>/gs,
      );
      for (const item of items) {
        const checked = item[0].includes('data-checked="true"') || item[0].includes('checked');
        const textMatch = item[0].match(/<label>.*?<\/label>|<p>(.*?)<\/p>/s);
        const text = textMatch ? htmlToInline(textMatch[0].replace(/<[^>]+>/g, '')) : '';
        lines.push(`- [${checked ? 'x' : ' '}] ${text}`);
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
      }
      remaining = remaining.slice(pMatch[0].length);
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

  // Clean up trailing blank lines
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

/**
 * Render a list item's HTML content as one or more markdown lines.
 * Handles `<p>` paragraph breaks (blank line) and `<br>` hard breaks
 * (two trailing spaces). Continuation lines are indented to keep them
 * inside the list item.
 */
function renderListItem(prefix: string, html: string): string[] {
  const indent = ' '.repeat(prefix.length);

  // Split on </p><p> to detect paragraph breaks within the item
  const paragraphs = html
    .split(/<\/p>\s*<p[^>]*>/i)
    .map((p) => p.replace(/^<p[^>]*>/i, '').replace(/<\/p>\s*$/i, ''));

  const result: string[] = [];
  paragraphs.forEach((paragraph, pIdx) => {
    const inline = htmlToInline(paragraph).trim();
    if (!inline) return;

    // Each <br> already became "  \n" in htmlToInline; split on it now.
    const subLines = inline.split('\n');
    subLines.forEach((sub, sIdx) => {
      if (pIdx === 0 && sIdx === 0) {
        result.push(prefix + sub);
      } else {
        // Blank line separator between paragraphs (sIdx === 0 means new paragraph)
        if (sIdx === 0) result.push('');
        result.push(indent + sub);
      }
    });
  });

  return result.length > 0 ? result : [prefix];
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
    .replace(/&amp;/g, '&');
}

/** Convert inline markdown to HTML for Tiptap consumption */
function inlineToHtml(text: string): string {
  let result = escapeHtml(text);

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

  // Images first: ![alt](src) — must be before links so the `!` prefix is consumed
  result = result.replace(RE_IMAGE, '<img alt="$1" src="$2">');

  // Mentions: @[Display](scheme:id) — must run before links so the
  // bracket+paren isn't consumed as a regular link. The input here has
  // already been run through escapeHtml at the top of this function, so
  // the captured groups are safe to interpolate directly.
  result = result.replace(
    RE_MENTION,
    (_match, label, kind, id) =>
      `<span data-mention="true" data-kind="${kind}" data-id="${id}" data-label="${label}" class="mention">@${label}</span>`,
  );

  // Links: [text](url)
  result = result.replace(RE_LINK, '<a href="$2">$1</a>');

  return result;
}

/** Convert inline HTML back to markdown */
function htmlToInline(html: string): string {
  let result = html;

  // Soft line breaks — convert <br> to GFM hard-break syntax (two trailing
  // spaces + newline) before stripping tags so the newline survives.
  result = result.replace(/<br\s*\/?>/gi, '  \n');

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

  // Images
  result = result.replace(RE_IMG_TAG, '![$1]($2)');

  // Strip remaining tags
  result = result.replace(RE_STRIP_TAGS, '');

  return unescapeHtml(result);
}
