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
 * using prodcore's own parser.
 */

/**
 * Convert raw markdown source to Tiptap-consumable HTML content.
 * Uses a simple markdown-to-HTML conversion that maps cleanly to
 * Tiptap's ProseMirror schema.
 */
export function markdownToTiptap(markdown: string): string {
  if (!markdown.trim()) return '<p></p>';

  // Simple conversion of markdown constructs to HTML that Tiptap understands.
  // This is intentionally straightforward — Tiptap's parser handles the HTML.
  let html = markdown;

  // Process blocks line by line for accurate conversion
  const lines = html.split('\n');
  const outputBlocks: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let inList = false;
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | 'task' = 'ul';

  const flushList = () => {
    if (inList && listItems.length > 0) {
      const tag = listType === 'ol' ? 'ol' : 'ul';
      const attr = listType === 'task' ? ' data-type="taskList"' : '';
      outputBlocks.push(`<${tag}${attr}>${listItems.join('')}</${tag}>`);
      listItems = [];
      inList = false;
    }
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
        const params = tokens.slice(1).filter(t => t.includes('='));
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
    const codeMatch = remaining.match(/^<pre><code(?:\s+class="language-([^"]*)")?>(.*?)<\/code><\/pre>/s);
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
    if (remaining.startsWith('<hr>') || remaining.startsWith('<hr/>') || remaining.startsWith('<hr />')) {
      const hrMatch = remaining.match(/^<hr\s*\/?>/);
      lines.push('---');
      lines.push('');
      remaining = remaining.slice(hrMatch![0].length);
      continue;
    }

    // Task list
    const taskListMatch = remaining.match(/^<ul[^>]*data-type="taskList"[^>]*>(.*?)<\/ul>/s);
    if (taskListMatch) {
      const items = taskListMatch[1].matchAll(/<li[^>]*data-type="taskItem"[^>]*(data-checked="true")?[^>]*>.*?<\/li>/gs);
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
        lines.push('- ' + htmlToInline(item[1].replace(/<\/?p>/g, '')));
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
        lines.push(`${idx + 1}. ` + htmlToInline(item[1].replace(/<\/?p>/g, '')));
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
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
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
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  result = result.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Inline code: `text`
  result = result.replace(/`(.+?)`/g, '<code>$1</code>');

  // Links: [text](url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Images: ![alt](src)
  result = result.replace(/!\[(.+?)\]\((.+?)\)/g, '<img alt="$1" src="$2">');

  return result;
}

/** Convert inline HTML back to markdown */
function htmlToInline(html: string): string {
  let result = html;

  // Strong
  result = result.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
  result = result.replace(/<b>(.*?)<\/b>/g, '**$1**');

  // Em
  result = result.replace(/<em>(.*?)<\/em>/g, '*$1*');
  result = result.replace(/<i>(.*?)<\/i>/g, '*$1*');

  // Strikethrough
  result = result.replace(/<s>(.*?)<\/s>/g, '~~$1~~');
  result = result.replace(/<del>(.*?)<\/del>/g, '~~$1~~');

  // Code
  result = result.replace(/<code>(.*?)<\/code>/g, '`$1`');

  // Links
  result = result.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)');

  // Images
  result = result.replace(/<img[^>]+alt="([^"]*)"[^>]+src="([^"]*)"[^>]*>/g, '![$1]($2)');

  // Strip remaining tags
  result = result.replace(/<[^>]+>/g, '');

  return unescapeHtml(result);
}
