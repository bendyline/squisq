/**
 * TextLayer Component
 *
 * Renders a text layer within an SVG block. Supports multi-line text,
 * styling options (font, color, shadow), and animations like fadeIn
 * and typewriter effects.
 *
 * Two rendering paths:
 *  - Plain text (`PlainTextLayer`) — SVG `<text>` + `<tspan>` per line, one
 *    style for the whole layer. Used for the common case and for
 *    backward-compat with content authored before rich text.
 *  - Rich text (`RichTextLayer`) — when `content.html` is set, the sanitized
 *    inline/block HTML renders inside a `<foreignObject>` so bold/italic/
 *    links (and, for layout textboxes, headings/lists) format individual
 *    runs. `<foreignObject>` is export-safe (video rasterizes via Chromium,
 *    PDF bypasses SVG) and already used by Video/Table layers.
 */

import { useMemo, type CSSProperties } from 'react';
import type { TextLayer as TextLayerType } from '@bendyline/squisq/schemas';
import { DEFAULT_DOC_FONT } from '@bendyline/squisq/schemas';
import {
  parseHtmlToNodes,
  sanitizeHtmlNodes,
  stringifyHtmlNodes,
} from '@bendyline/squisq/markdown';
// Import from the standalone marker module (not the `icons` barrel) so the
// player bundle doesn't pull in the ~2k-entry FontAwesome catalog.
import {
  hasIconMarker,
  splitIconMarkers,
  stripIconMarkers,
  iconClass,
} from '@bendyline/squisq/icon-marker';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue } from '../utils/layerUtils';
import { resolveFill, borderDashArray } from '../utils/fillStyle';

interface TextLayerProps {
  layer: TextLayerType;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start */
  blockTime: number;
}

/**
 * Dispatch between the plain SVG-text renderer and the rich HTML renderer
 * based on whether the layer carries `content.html`.
 */
export function TextLayer(props: TextLayerProps) {
  if (props.layer.content.html?.trim()) return <RichTextLayer {...props} />;
  // Body text carrying inline-icon markers (authored `{[rocket]}` etc.) can't
  // render in the SVG `<text>` path — an icon is an `<i class="fa-…">` glyph,
  // not a code point we can place in a tspan. Route it through a foreignObject
  // instead, sizing the box to the wrapped content so it doesn't clip.
  if (hasIconMarker(props.layer.content.text ?? '')) return <IconTextLayer {...props} />;
  return <PlainTextLayer {...props} />;
}

/** Escape text so it's safe inside the synthesized icon HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turn a marker-bearing string into HTML: text runs escaped, icons as `<i>`. */
function iconRunsToHtml(text: string): string {
  return splitIconMarkers(text)
    .map((run) =>
      run.type === 'icon'
        ? `<i class="${iconClass(run.family, run.name)}" aria-hidden="true"></i>`
        : escapeHtml(run.text).replace(/\n/g, '<br>'),
    )
    .join('');
}

/**
 * Renders template body text that contains inline icons. Geometry mirrors
 * `PlainTextLayer`/`layerBounds` (same anchor math), but the content lives in
 * a `<foreignObject>` so `<i class="fa-…">` glyphs render (export-safe: video
 * rasterizes via Chromium, which has the FA webfont embedded in the render
 * page). Height is derived from the wrapped, icon-free projection when the
 * layer has no explicit height, and overflow is visible to guard estimates.
 */
function IconTextLayer({ layer, viewport, blockTime }: TextLayerProps) {
  const { content, position, animation } = layer;
  const { text, style } = content;

  const rawX = resolveValue(position.x, viewport.width);
  const rawY = resolveValue(position.y, viewport.height);
  const boxWidth =
    position.width != null ? resolveValue(position.width, viewport.width) : viewport.width;
  const anchor = position.anchor ?? 'top-left';
  const lineHeight = style.lineHeight || 1.4;
  const lineHeightPx = style.fontSize * lineHeight;
  const padding = style.padding ?? 0;

  // Estimate wrapped line count from the icon-free text so the box is tall
  // enough. Icons roughly occupy one character; the estimate need not be exact
  // because the foreignObject is `overflow: visible`.
  const plain = stripIconMarkers(text ?? '');
  const lines = plain.split('\n').flatMap((line) => wrapText(line, style.fontSize, boxWidth));
  const boxHeight =
    position.height != null
      ? resolveValue(position.height, viewport.height)
      : Math.max(lineHeightPx, lines.length * lineHeightPx) + padding * 2;

  const boxX = rawX - anchorAxis(anchor, boxWidth, 'x');
  const boxY = rawY - anchorAxis(anchor, boxHeight, 'y');

  const animStyle = getAnimationStyle(animation, blockTime);
  const html = useMemo(() => iconRunsToHtml(text ?? ''), [text]);

  const verticalJustify =
    style.verticalAlign === 'top'
      ? 'flex-start'
      : style.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'center';

  const boxStyle: CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: verticalJustify,
    padding,
    color: style.color,
    fontSize: `${style.fontSize}px`,
    fontFamily: style.fontFamily || DEFAULT_DOC_FONT,
    fontWeight: style.fontWeight || 'normal',
    fontStyle: style.fontStyle || 'normal',
    lineHeight,
    textAlign: style.textAlign ?? 'left',
    ...(style.shadow ? { textShadow: '0 2px 3px rgba(0,0,0,0.7)' } : {}),
    ...animStyle.style,
  };

  return (
    <g className={`block-layer block-layer--text ${animStyle.className}`} data-layer-id={layer.id}>
      <foreignObject
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        style={{ overflow: 'visible' }}
      >
        {/* Outer box owns the flex/vertical-centering; the inner div is a
            single flex item so the rich content (text + inline `<i>` icons)
            flows inline instead of each node becoming a stacked flex item. */}
        <div
          {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as Record<string, string>)}
          style={boxStyle}
        >
          <div
            style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            aria-label={plain}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </foreignObject>
    </g>
  );
}

function PlainTextLayer({ layer, viewport, blockTime }: TextLayerProps) {
  const { content, position, animation } = layer;
  const { text, style } = content;

  // Resolve position values to pixels. `position.x/y` is the layer's
  // anchor *point*; `position.anchor` says where on the box that point
  // sits (matching `layerBounds` in the editor).
  const rawX = resolveValue(position.x, viewport.width);
  const rawY = resolveValue(position.y, viewport.height);
  const boxWidth =
    position.width != null ? resolveValue(position.width, viewport.width) : undefined;
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
    fontStyle: style.fontStyle || 'normal',
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

      {/* Background / border box. When the layer has an explicit box
          (width + height — as the template designer always creates), the
          fill and border cover that rectangle: text is, after all, a
          rectangle. Without a box we fall back to a snug rect hugging the
          text (legacy behavior for point-anchored text). */}
      <TextBox
        layerId={layer.id}
        style={style}
        box={
          boxWidth != null && boxHeight != null
            ? {
                x: rawX - anchorAxis(anchor, boxWidth, 'x'),
                y: rawY - anchorAxis(anchor, boxHeight, 'y'),
                width: boxWidth,
                height: boxHeight,
              }
            : {
                x: x - (style.padding || 16),
                y: y - style.fontSize - (style.padding || 16),
                width: getTextBoxWidth(lines, style) + (style.padding || 16) * 2,
                height: lines.length * lineHeightPx + (style.padding || 16) * 2,
              }
        }
      />

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
 * Rich-text path: render `content.html` as sanitized HTML inside a
 * `<foreignObject>` so individual runs can carry their own formatting
 * (bold/italic/links, and headings/lists for layout textboxes). The box
 * geometry matches `PlainTextLayer`/`layerBounds`, so selection and
 * drag/resize stay aligned. `content.text` remains the plain projection
 * used by export/search.
 */
function RichTextLayer({ layer, viewport, blockTime }: TextLayerProps) {
  const { content, position, animation } = layer;
  const { html, style } = content;

  const rawX = resolveValue(position.x, viewport.width);
  const rawY = resolveValue(position.y, viewport.height);
  const boxWidth =
    position.width != null ? resolveValue(position.width, viewport.width) : viewport.width;
  const boxHeight =
    position.height != null
      ? resolveValue(position.height, viewport.height)
      : style.fontSize * (style.lineHeight || 1.4) * 2;
  const anchor = position.anchor ?? 'top-left';
  const boxX = rawX - anchorAxis(anchor, boxWidth, 'x');
  const boxY = rawY - anchorAxis(anchor, boxHeight, 'y');

  // Re-sanitize at render time — `html` is untrusted. Memoized so the
  // per-frame `blockTime` updates don't re-parse the HTML each frame.
  const safeHtml = useMemo(
    () => stringifyHtmlNodes(sanitizeHtmlNodes(parseHtmlToNodes(html ?? ''))),
    [html],
  );

  const animStyle = getAnimationStyle(animation, blockTime);

  const verticalJustify =
    style.verticalAlign === 'middle'
      ? 'center'
      : style.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'flex-start';

  const hasBorder = !!(style.borderColor && (style.borderWidth ?? 0) > 0);
  // Box decoration uses CSS (foreignObject is HTML); gradients/backgroundOpacity
  // are deferred to the SVG path — solid background covers the common case.
  const boxStyle: CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: verticalJustify,
    padding: style.padding ?? 0,
    color: style.color,
    fontSize: `${style.fontSize}px`,
    fontFamily: style.fontFamily || DEFAULT_DOC_FONT,
    fontWeight: style.fontWeight || 'normal',
    fontStyle: style.fontStyle || 'normal',
    lineHeight: style.lineHeight || 1.4,
    textAlign: style.textAlign ?? 'left',
    overflow: 'hidden',
    ...(style.background ? { background: style.background } : {}),
    ...(hasBorder
      ? {
          border: `${style.borderWidth}px ${style.borderStyle ?? 'solid'} ${style.borderColor}`,
          borderRadius: 4,
        }
      : {}),
    ...(style.shadow ? { textShadow: '0 2px 3px rgba(0,0,0,0.7)' } : {}),
    ...animStyle.style,
  };

  // Scoped reset so authored block elements (headings, lists, paragraphs)
  // render tightly inside the box rather than with the UA's large margins.
  const cls = `squisq-rich-text-${cssId(layer.id)}`;
  const scopedCss =
    `.${cls}{margin:0}` +
    `.${cls} p{margin:0 0 .4em}` +
    `.${cls} h1,.${cls} h2,.${cls} h3,.${cls} h4,.${cls} h5,.${cls} h6{margin:0 0 .3em;line-height:1.2}` +
    // `list-style-position: inside` keeps the bullet/number next to its text
    // — with `outside` (the default) a centered or middle-aligned list leaves
    // the marker stranded at the box's left padding, far from the text. The
    // editor wraps each item's text in a `<p>`, so flatten that to inline or
    // the block paragraph drops below the (inline) marker.
    `.${cls} ul,.${cls} ol{margin:0 0 .4em;padding-left:1.2em;list-style-position:inside}` +
    `.${cls} li{margin:0}` +
    `.${cls} li>p{display:inline;margin:0}` +
    `.${cls} *:first-child{margin-top:0}.${cls} *:last-child{margin-bottom:0}` +
    `.${cls} a{color:inherit;text-decoration:underline}`;

  return (
    <g className={`block-layer block-layer--text ${animStyle.className}`} data-layer-id={layer.id}>
      <foreignObject x={boxX} y={boxY} width={boxWidth} height={boxHeight}>
        {/* xmlns is required for HTML inside SVG foreignObject (see TableLayer) */}
        <div
          {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as Record<string, string>)}
          style={boxStyle}
        >
          <style>{scopedCss}</style>
          <div
            className={cls}
            aria-label={content.text}
            style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        </div>
      </foreignObject>
    </g>
  );
}

/** Sanitize a layer id into a CSS-class-safe suffix. */
function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * The text layer's background + border rect. Renders nothing unless a
 * fill (solid or gradient) or a visible border is configured.
 */
function TextBox({
  layerId,
  style,
  box,
}: {
  layerId: string;
  style: import('@bendyline/squisq/schemas').TextStyle;
  box: { x: number; y: number; width: number; height: number };
}) {
  const hasFill = !!(style.background || style.backgroundGradient);
  const hasBorder = !!(style.borderColor && (style.borderWidth ?? 0) > 0);
  if (!hasFill && !hasBorder) return null;

  const { fill, def } = resolveFill(layerId, style.background, style.backgroundGradient);
  const dash = borderDashArray(style.borderStyle, style.borderWidth);
  return (
    <>
      {def && <defs>{def}</defs>}
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={hasFill ? fill : 'none'}
        fillOpacity={hasFill ? style.backgroundOpacity : undefined}
        stroke={hasBorder ? style.borderColor : undefined}
        strokeWidth={hasBorder ? style.borderWidth : undefined}
        strokeDasharray={hasBorder ? dash : undefined}
        rx={4}
        ry={4}
      />
    </>
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
function pivotX(
  rawX: number,
  width: number | undefined,
  anchor: string,
  textAnchor: string,
): number {
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
