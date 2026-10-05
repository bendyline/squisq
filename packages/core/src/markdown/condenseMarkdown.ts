import { parseMarkdown } from './parse.js';
import { getChildren, splitFrontmatterBlock } from './utils.js';
import type { MarkdownNode, MarkdownTable } from './types.js';

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Remove only GFM cell padding and unescaped boundary pipes. */
function cellSource(source: string): string {
  let text = trimPadding(source);
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) {
    let backslashes = 0;
    for (let i = text.length - 2; i >= 0 && text[i] === '\\'; i--) backslashes++;
    if (backslashes % 2 === 0) text = text.slice(0, -1);
  }
  return trimPadding(text);
}

// An unanchored /[ \t]+$/ retries every offset when padding precedes a pipe,
// making imported cells with hundreds of thousands of spaces quadratic.
function trimPadding(source: string): string {
  let start = 0;
  let end = source.length;
  while (start < end && (source[start] === ' ' || source[start] === '\t')) start++;
  while (end > start && (source[end - 1] === ' ' || source[end - 1] === '\t')) end--;
  return source.slice(start, end);
}

function tableEdits(source: string, table: MarkdownTable): Edit[] {
  const edits: Edit[] = [];
  for (const row of table.children) {
    const start = row.position?.start.offset;
    const end = row.position?.end.offset;
    if (start === undefined || end === undefined) throw new Error('Table row has no source span');
    let boundary = start;
    const cells: string[] = [];
    for (const cell of row.children) {
      const a = cell.position?.start.offset;
      const b = cell.position?.end.offset;
      // Never discard unrepresented cells or reconstruct inline content from
      // a lossy rendering. Code, URLs, escaped pipes and citations stay raw.
      if (a !== boundary || b === undefined || b < a) {
        throw new Error('Table cell spans do not cover their row');
      }
      cells.push(cellSource(source.slice(a, b)));
      boundary = b;
    }
    if (boundary !== end) throw new Error('Table cell spans do not cover their row');
    edits.push({ start, end, text: `| ${cells.join(' | ')} |` });
  }

  const headerEnd = table.children[0]?.position?.end.offset;
  if (headerEnd === undefined) throw new Error('Table has no header span');
  const start = source.indexOf('\n', headerEnd) + 1;
  const newline = source.indexOf('\n', start);
  let end = newline === -1 ? source.length : newline;
  if (source[end - 1] === '\r') end--;
  const divider = source.slice(start, end);
  const prefix = /^[ \t>]*/.exec(divider)?.[0] ?? '';
  if (start === 0 || !/^[|:\- \t]+$/.test(divider.slice(prefix.length))) {
    throw new Error('Table has no recognizable delimiter row');
  }
  const columns = table.children[0]?.children.length ?? 0;
  const cells = Array.from({ length: columns }, (_, i) => {
    const align = table.align?.[i];
    return `${align === 'left' || align === 'center' ? ':' : ''}---${align === 'right' || align === 'center' ? ':' : ''}`;
  });
  edits.push({ start: start + prefix.length, end, text: `| ${cells.join(' | ')} |` });
  return edits;
}

/**
 * Compact table padding/delimiters and thematic breaks without removing data.
 * Other source spans (including frontmatter, code, HTML, citations and prose)
 * remain byte-identical. Reparse and compare every AST property except source
 * positions before returning; throw if equivalence cannot be established.
 * Run after reference/image edits, which may re-serialize a table with padding.
 */
export function condenseMarkdownSource(source: string): string {
  const { frontmatter, body } = splitFrontmatterBlock(source);
  const options = { frontmatter: false, parseHtml: false };
  const document = parseMarkdown(body, options);
  const edits: Edit[] = [];
  const visit = (node: MarkdownNode): void => {
    if (node.type === 'table') {
      edits.push(...tableEdits(body, node));
      return;
    }
    if (node.type === 'thematicBreak') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const marker = body.slice(start, end).match(/[-*_]/)?.[0];
        if (marker) edits.push({ start, end, text: marker.repeat(3) });
      }
    }
    for (const child of getChildren(node)) visit(child);
  };
  visit(document);
  const parts: string[] = [];
  let boundary = 0;
  let changed = false;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    if (edit.start < boundary) throw new Error('Overlapping Markdown condensation edits');
    parts.push(body.slice(boundary, edit.start), edit.text);
    changed ||= body.slice(edit.start, edit.end) !== edit.text;
    boundary = edit.end;
  }
  if (!changed) return source;
  parts.push(body.slice(boundary));
  const output = parts.join('');
  const withoutPositions = (key: string, value: unknown): unknown =>
    key === 'position' ? undefined : value;
  if (
    JSON.stringify(document, withoutPositions) !==
    JSON.stringify(parseMarkdown(output, options), withoutPositions)
  ) {
    throw new Error('Condensed Markdown no longer parses to an equivalent document');
  }
  return (frontmatter ?? '') + output;
}
