/**
 * Source-level Markdown fenced-code detection for editor features that cannot
 * operate on the parsed AST. The returned mask includes opening and closing
 * fence lines, and an unclosed fence remains active through EOF.
 */

interface FenceState {
  marker: '`' | '~';
  length: number;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function openingFence(line: string): FenceState | null {
  const match = FENCE_RE.exec(line);
  if (!match) return null;
  const run = match[1];
  const marker = run[0] as '`' | '~';
  // CommonMark forbids backticks in a backtick fence's info string.
  if (marker === '`' && match[2].includes('`')) return null;
  return { marker, length: run.length };
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const match = CLOSING_FENCE_RE.exec(line);
  return !!match && match[1][0] === fence.marker && match[1].length >= fence.length;
}

/** One boolean per physical source line; true means the whole line is fenced code. */
export function markdownFencedCodeLineMask(source: string): boolean[] {
  const lines = source.split(/\r\n|\r|\n/);
  const mask: boolean[] = [];
  let fence: FenceState | null = null;

  for (const line of lines) {
    if (fence) {
      mask.push(true);
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }

    const opening = openingFence(line);
    mask.push(opening != null);
    fence = opening;
  }

  return mask;
}

/** Whether a 1-based physical source line is an opening, body, or closing fence line. */
export function isMarkdownFencedCodeLine(source: string, lineNumber: number): boolean {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return false;
  return markdownFencedCodeLineMask(source)[lineNumber - 1] ?? false;
}

/**
 * Replace fenced-code line contents with spaces while retaining every line
 * ending and character offset. Raw-source scanners can safely inspect the
 * result and use any match offsets against the original source.
 */
export function maskMarkdownFencedCode(source: string): string {
  const mask = markdownFencedCodeLineMask(source);
  let lineIndex = 0;
  return source
    .split(/(\r\n|\r|\n)/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return mask[lineIndex++] ? ' '.repeat(part.length) : part;
    })
    .join('');
}
