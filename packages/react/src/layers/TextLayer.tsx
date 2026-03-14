/**
 * TextLayer Component
 *
 * Renders a text layer within an SVG block. Supports multi-line text,
 * styling options (font, color, shadow), and animations like fadeIn
 * and typewriter effects.
 *
 * Text is rendered using SVG <text> elements with <tspan> for line breaks.
 */

import type { TextLayer as TextLayerType } from '@bendyline/squisq/schemas';
import { DEFAULT_DOC_FONT } from '@bendyline/squisq/schemas';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue } from '../utils/layerUtils';

interface TextLayerProps {
  layer: TextLayerType;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start */
  blockTime: number;
}

export function TextLayer({ layer, viewport, blockTime }: TextLayerProps) {
  const { content, position, animation } = layer;
  const { text, style } = content;

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const maxWidth = position.width ? resolveValue(position.width, viewport.width) : undefined;

  // Apply anchor offset for text alignment
  const textAnchor = getTextAnchor(style.textAlign, position.anchor);
  const dominantBaseline = getDominantBaseline(position.anchor);

  // Get animation styles
  const animStyle = getAnimationStyle(animation, blockTime);

  // Split text into lines, and wrap if maxWidth is specified
  const rawLines = text.split('\n');
  let lines = maxWidth
    ? rawLines.reduce<string[]>(
        (acc, line) => acc.concat(wrapText(line, style.fontSize, maxWidth)),
        [],
      )
    : rawLines;

  // Truncate to maxLines if specified
  if (style.maxLines && lines.length > style.maxLines) {
    lines = lines.slice(0, style.maxLines);
    // Add ellipsis to last visible line
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.replace(/\s*$/, '') + '...';
  }
  const lineHeight = style.lineHeight || 1.4;
  const lineHeightPx = style.fontSize * lineHeight;

  // Build text styles
  const textStyles: Record<string, string | number> = {
    fontSize: `${style.fontSize}px`,
    fontFamily: style.fontFamily || DEFAULT_DOC_FONT,
    fontWeight: style.fontWeight || 'normal',
    fill: style.color,
    ...animStyle.style,
  };

  // Add shadow filter if requested
  const filterId = style.shadow ? `shadow-${layer.id}` : undefined;

  return (
    <g className={`block-layer block-layer--text ${animStyle.className}`} data-layer-id={layer.id}>
      {/* Shadow filter definition */}
      {style.shadow && (
        <defs>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.7)" />
          </filter>
        </defs>
      )}

      {/* Background box if specified */}
      {style.background && (
        <rect
          x={x - (style.padding || 16)}
          y={y - style.fontSize - (style.padding || 16)}
          width={getTextBoxWidth(lines, style) + (style.padding || 16) * 2}
          height={lines.length * lineHeightPx + (style.padding || 16) * 2}
          fill={style.background}
          rx={4}
          ry={4}
        />
      )}

      {/* Text element with tspans for each line */}
      <text
        x={x}
        y={y}
        textAnchor={textAnchor as 'start' | 'middle' | 'end'}
        dominantBaseline={dominantBaseline as 'text-before-edge' | 'middle' | 'text-after-edge'}
        style={textStyles}
        filter={filterId ? `url(#${filterId})` : undefined}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={x} dy={i === 0 ? 0 : lineHeightPx}>
            {line || '\u00A0'} {/* Non-breaking space for empty lines */}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/**
 * Map text alignment to SVG text-anchor.
 */
function getTextAnchor(align?: 'left' | 'center' | 'right', anchor?: string): string {
  // Explicit alignment takes precedence
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  if (align === 'left') return 'start';

  // Otherwise infer from position anchor
  if (anchor?.includes('right')) return 'end';
  if (anchor === 'center') return 'middle';
  return 'start';
}

/**
 * Map position anchor to SVG dominant-baseline.
 */
function getDominantBaseline(anchor?: string): string {
  if (anchor?.includes('bottom')) return 'text-after-edge';
  if (anchor === 'center') return 'middle';
  return 'text-before-edge';
}

/**
 * Estimate text box width based on content (rough approximation).
 */
function getTextBoxWidth(lines: string[], style: { fontSize: number }): number {
  const maxLineLength = Math.max(...lines.map((l) => l.length));
  // Rough estimate: average character width is ~0.5 * fontSize
  return maxLineLength * style.fontSize * 0.55;
}

/**
 * Wrap text to fit within a maximum width.
 * Uses character-based estimation for line breaking.
 */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  if (!text.trim()) return [''];

  // Estimate characters per line (average char width ~0.5 * fontSize for most fonts)
  const avgCharWidth = fontSize * 0.5;
  const charsPerLine = Math.floor(maxWidth / avgCharWidth);

  if (charsPerLine <= 0) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length <= charsPerLine) {
      currentLine = testLine;
    } else {
      // Current line is full, start new line
      if (currentLine) {
        lines.push(currentLine);
      }
      // Handle words longer than a line
      if (word.length > charsPerLine) {
        // Break long word
        let remaining = word;
        while (remaining.length > charsPerLine) {
          lines.push(remaining.slice(0, charsPerLine));
          remaining = remaining.slice(charsPerLine);
        }
        currentLine = remaining;
      } else {
        currentLine = word;
      }
    }
  }

  // Add remaining text
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

export default TextLayer;
