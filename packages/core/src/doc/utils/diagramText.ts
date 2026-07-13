/** Text fitting shared by the live diagram canvas and template renderer. */

export const DIAGRAM_LABEL_LINE_HEIGHT = 1.25;
export const DIAGRAM_LABEL_HORIZONTAL_PADDING = 24;
export const DIAGRAM_LABEL_VERTICAL_PADDING = 16;
export const DIAGRAM_LABEL_MIN_FONT_SIZE = 10;

export interface DiagramLabelFit {
  fontSize: number;
  lineCount: number;
  /** Upward shift that centers the full line group around the node midpoint. */
  firstLineOffset: number;
  textWidth: number;
}

/**
 * Fit a plain diagram label inside a node card using the same character-width
 * estimate and word wrapping as React's `TextLayer`.
 */
export function fitDiagramLabel(
  text: string,
  boxWidth: number,
  boxHeight: number,
  preferredFontSize: number,
): DiagramLabelFit {
  const textWidth = Math.max(1, boxWidth - DIAGRAM_LABEL_HORIZONTAL_PADDING);
  const textHeight = Math.max(1, boxHeight - DIAGRAM_LABEL_VERTICAL_PADDING);
  const preferred = Math.max(DIAGRAM_LABEL_MIN_FONT_SIZE, Math.floor(preferredFontSize));

  let fontSize = preferred;
  let lineCount = countWrappedLines(text, fontSize, textWidth);
  while (
    fontSize > DIAGRAM_LABEL_MIN_FONT_SIZE &&
    lineCount * fontSize * DIAGRAM_LABEL_LINE_HEIGHT > textHeight
  ) {
    fontSize--;
    lineCount = countWrappedLines(text, fontSize, textWidth);
  }

  return {
    fontSize,
    lineCount,
    firstLineOffset:
      lineCount === 1 ? 0 : -((lineCount - 1) * fontSize * DIAGRAM_LABEL_LINE_HEIGHT) / 2,
    textWidth,
  };
}

function countWrappedLines(text: string, fontSize: number, maxWidth: number): number {
  return text
    .split('\n')
    .reduce((count, line) => count + wrappedLineCount(line, fontSize, maxWidth), 0);
}

function wrappedLineCount(text: string, fontSize: number, maxWidth: number): number {
  if (!text.trim()) return 1;
  const charsPerLine = Math.floor(maxWidth / (fontSize * 0.5));
  if (charsPerLine <= 0) return 1;

  let lines = 0;
  let currentLength = 0;
  for (const word of text.split(/\s+/)) {
    const testLength = currentLength > 0 ? currentLength + 1 + word.length : word.length;
    if (testLength <= charsPerLine) {
      currentLength = testLength;
      continue;
    }
    if (currentLength > 0) lines++;
    if (word.length > charsPerLine) {
      lines += Math.floor((word.length - 1) / charsPerLine);
      currentLength = word.length % charsPerLine || charsPerLine;
    } else {
      currentLength = word.length;
    }
  }
  if (currentLength > 0) lines++;
  return Math.max(1, lines);
}
