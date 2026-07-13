/**
 * Plain-text selection conversions used by the toolbar's Convert menu.
 * Keeping delimiter detection separate from the editor integrations makes
 * the behavior identical in Monaco and Tiptap.
 */

export type SelectionTableDelimiter = 'pipe' | 'comma' | 'tab' | 'multispace' | null;

export interface SelectionTable {
  delimiter: SelectionTableDelimiter;
  rows: string[][];
}

export interface SelectionTaskItem {
  checked: boolean;
  text: string;
}

type CandidateDelimiter = Exclude<SelectionTableDelimiter, null>;

/** Non-empty selected lines, trimmed without changing their order. */
export function selectionLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function splitPipeLine(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\' && value[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** A small CSV-row parser so quoted commas remain inside their cell. */
function splitCommaLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !quoted && cell.trim().length === 0) {
      // A quote only opens CSV quoting at the start of a field. Literal
      // quotes elsewhere (for example 5" screen) remain part of the value.
      quoted = true;
      cell = '';
    } else if (char === '"' && quoted) {
      if (line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) return line.split(',').map((value) => value.trim());
  cells.push(cell.trim());
  return cells;
}

function splitLine(line: string, delimiter: CandidateDelimiter): string[] {
  switch (delimiter) {
    case 'pipe':
      return splitPipeLine(line);
    case 'comma':
      return splitCommaLine(line);
    case 'tab':
      return line
        .trim()
        .split('\t')
        .map((cell) => cell.trim());
    case 'multispace':
      return line
        .trim()
        .split(/[ \u00a0]{2,}/)
        .map((cell) => cell.trim());
  }
}

/**
 * Detect a delimiter only when at least two lines use it and every line
 * produces the same number of columns. Inconsistent prose therefore falls
 * back to a useful one-column table instead of losing text.
 */
export function selectionToTable(text: string): SelectionTable {
  const lines = selectionLines(text);
  const candidates: CandidateDelimiter[] = ['pipe', 'comma', 'tab', 'multispace'];

  if (lines.length >= 2) {
    for (const delimiter of candidates) {
      const rows = lines.map((line) => splitLine(line, delimiter));
      const columnCount = rows[0]?.length ?? 0;
      if (columnCount >= 2 && rows.every((row) => row.length === columnCount)) {
        return { delimiter, rows };
      }
    }
  }

  return { delimiter: null, rows: lines.map((line) => [line]) };
}

function escapeTableCell(cell: string): string {
  return cell.replace(/\|/g, '\\|');
}

/** Render a selection as a GFM table, using its first row as the header. */
export function selectionToTableMarkdown(text: string): string {
  const { rows } = selectionToTable(text);
  if (rows.length === 0) return '';

  const formatRow = (row: string[]) => `| ${row.map(escapeTableCell).join(' | ')} |`;
  const separator = rows[0].map(() => '---');
  return [formatRow(rows[0]), formatRow(separator), ...rows.slice(1).map(formatRow)].join('\n');
}

/** Convert selected lines to task items, normalizing existing list markers. */
export function selectionToTaskItems(text: string): SelectionTaskItem[] {
  return selectionLines(text).map((line) => {
    const task = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(line);
    if (task) return { checked: task[1].toLowerCase() === 'x', text: task[2].trim() };

    const withoutListMarker = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '');
    return { checked: false, text: withoutListMarker.trim() };
  });
}

export function selectionToTaskListMarkdown(text: string): string {
  return selectionToTaskItems(text)
    .map((item) => `- [${item.checked ? 'x' : ' '}] ${item.text}`)
    .join('\n');
}
