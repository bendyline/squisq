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

  // Resolve position values to pixels. `position.x/y` is the layer's
  // anchor *point*; `position.anchor` says where on the box that point
  // sits (matching `layerBounds` in the editor).
  const rawX = resolveValue(position.x, viewport.width);
  const rawY = resolveValue(position.y, viewport.height);
  const boxWidth = position.width != null ? resolveValue(position.width, viewport.width) : undefined;
  const boxHeight =
    position.height != null ? resolveValue(position.height, viewport.height) : undefined;
  const maxWidth = boxWidth;

  const textAnchor = getTextAnchor(style.textAlign, position.anchor);
  const dominantBaseline = getDominantBaseline(style.verticalAlign, position.anchor);

  // Place the text's pivot at the box edge/centre matching the chosen
  // alignment. This is algebraically identical to the legacy point-anchor
  // behavior for existing content (where x/y were already the desired
  // pivot — e.g. templates using x:'50%' + anchor:'center'), and makes
  // box-relative H/V alignment work for layers anchored at their
  // top-left (as the template designer creates them).
  const anchor = position.anchor ?? 'top-left';
  const x = pivotX(rawX, boxWidth, anchor, textAnchor);
  const y = pivotY(rawY, boxHeight, anchor, dominantBaseline);

  // Get animation styles
  const animStyle = getAnimationStyle(animation, blockTime);

  // Split text into lines, and wrap if maxWidth is specified
  const rawLines = (text ?? '').split('\n');
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
 * Map vertical alignment (or, when unset, the position anchor) to SVG
 * dominant-baseline. Explicit `verticalAlign` wins so the editor can set
 * top/middle/bottom independently of the box-placement anchor.
 */
function getDominantBaseline(verticalAlign?: 'top' | 'middle' | 'bottom', anchor?: string): string {
  if (verticalAlign === 'top') return 'text-before-edge';
  if (verticalAlign === 'middle') return 'middle';
  if (verticalAlign === 'bottom') return 'text-after-edge';

  if (anchor?.includes('bottom')) return 'text-after-edge';
  if (anchor === 'center') return 'middle';
  return 'text-before-edge';
}

/**
 * Horizontal pivot for the text. Derives the box's left edge from the
 * anchor point (`rawX`) and the box width, then offsets to the edge/centre
 * matching `textAnchor`. Falls back to the raw point when no width is set.
 */
function pivotX(rawX: number, width: number | undefined, anchor: string, textAnchor: string): number {
  if (width == null) return rawX;
  const boxLeft = rawX - anchorAxis(anchor, width, 'x');
  if (textAnchor === 'middle') return boxLeft + width / 2;
  if (textAnchor === 'end') return boxLeft + width;
  return boxLeft;
}

/**
 * Vertical pivot for the text. Mirror of {@link pivotX} for the box's top
 * edge and the resolved dominant-baseline. Falls back to the raw point
 * when no height is set.
 */
function pivotY(
  rawY: number,
  height: number | undefined,
  anchor: string,
  dominantBaseline: string,
): number {
  if (height == null) return rawY;
  const boxTop = rawY - anchorAxis(anchor, height, 'y');
  if (dominantBaseline === 'middle') return boxTop + height / 2;
  if (dominantBaseline === 'text-after-edge') return boxTop + height;
  return boxTop;
}

/** Anchor-point offset along one axis, matching `layerBounds` in the editor. */
function anchorAxis(anchor: string, size: number, axis: 'x' | 'y'): number {
  if (anchor === 'center') return size / 2;
  if (axis === 'x') return anchor.includes('right') ? size : 0;
  return anchor.includes('bottom') ? size : 0;
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
