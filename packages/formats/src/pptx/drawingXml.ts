/**
 * DrawingML property primitives shared by the layer shape writers: CSS
 * colors as `srgbClr` (with alpha), fills, outlines and the one typeface
 * DrawingML accepts for a CSS font stack — plus the plain shape writer,
 * which slides, layouts and the master all use.
 */

import type { ShapeLayer, ShapePattern } from '@bendyline/squisq/schemas';
import { resolveFontFamily } from '@bendyline/squisq/schemas';
import {
  cssGradientFillXml,
  parseCssColor,
  parseCssGradient,
  type ParsedColor,
} from './cssPaint.js';
import { escapeXml } from '../ooxml/xmlUtils.js';
import { EMU_PER_CANVAS_PX, resolveLayerRect, toEmuRect } from './geometry.js';

export { parseCssColor, type ParsedColor } from './cssPaint.js';

/** DrawingML accepts one typeface, not a CSS fallback stack. */
export function officeTypeface(
  family: Parameters<typeof resolveFontFamily>[0],
  fallback: string,
): string {
  const resolved = resolveFontFamily(family, fallback);
  const first = resolved
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  return first || fallback;
}

export function solidColorXml(color: ParsedColor): string {
  const alpha = color.alpha < 100000 ? `<a:alpha val="${color.alpha}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${color.hex}">${alpha}</a:srgbClr></a:solidFill>`;
}

export function fillXml(
  fill: string | undefined,
  opacity: number | undefined,
  gradient: { from: string; to: string; angle?: number } | undefined,
): string {
  if (gradient) return gradientFillXml(gradient.from, gradient.to, gradient.angle ?? 0, opacity);
  if (!fill || fill === 'none' || fill === 'transparent') return '<a:noFill/>';
  if (fill.includes('gradient(')) {
    const parsed = parseCssGradient(fill);
    if (parsed) return cssGradientFillXml(parsed, opacity ?? 1);
    const colors = fill.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/gi) ?? [];
    if (colors.length >= 2) {
      const angle = Number.parseFloat(
        /(?:linear-gradient\()\s*([\d.-]+)deg/i.exec(fill)?.[1] ?? '0',
      );
      return gradientFillXml(colors[0]!, colors[colors.length - 1]!, angle, opacity);
    }
  }
  const color = parseCssColor(fill, '000000');
  if (opacity !== undefined)
    color.alpha = Math.round(color.alpha * Math.max(0, Math.min(1, opacity)));
  return solidColorXml(color);
}

export function gradientFillXml(
  from: string,
  to: string,
  angle: number,
  opacity: number | undefined,
): string {
  const first = parseCssColor(from, '000000');
  const second = parseCssColor(to, first.hex);
  if (opacity !== undefined) {
    const factor = Math.max(0, Math.min(1, opacity));
    first.alpha = Math.round(first.alpha * factor);
    second.alpha = Math.round(second.alpha * factor);
  }
  const ooxmlAngle = Math.round(((((90 - angle) % 360) + 360) % 360) * 60000);
  return (
    `<a:gradFill rotWithShape="1"><a:gsLst>` +
    `<a:gs pos="0"><a:srgbClr val="${first.hex}">${first.alpha < 100000 ? `<a:alpha val="${first.alpha}"/>` : ''}</a:srgbClr></a:gs>` +
    `<a:gs pos="100000"><a:srgbClr val="${second.hex}">${second.alpha < 100000 ? `<a:alpha val="${second.alpha}"/>` : ''}</a:srgbClr></a:gs>` +
    `</a:gsLst><a:lin ang="${ooxmlAngle}" scaled="1"/></a:gradFill>`
  );
}

export function lineXml(
  color: string | undefined,
  widthPx: number | undefined,
  borderStyle: 'solid' | 'dashed' | 'dotted' | undefined,
): string {
  if (!color || !widthPx || widthPx <= 0) return '<a:ln><a:noFill/></a:ln>';
  const width = Math.max(1, Math.round(widthPx * EMU_PER_CANVAS_PX));
  return `<a:ln w="${width}">${solidColorXml(parseCssColor(color, '000000'))}${dashXml(borderStyle)}</a:ln>`;
}

export function dashXml(
  style: 'solid' | 'dashed' | 'dotted' | undefined,
  dasharray?: string,
): string {
  if (style === 'dashed' || (dasharray && dasharray !== 'none')) return '<a:prstDash val="dash"/>';
  if (style === 'dotted') return '<a:prstDash val="dot"/>';
  return '';
}

/**
 * A shape's repeating pattern as a DrawingML preset pattern fill, over a
 * transparent ground or the opaque `ground` colour. Office patterns are fixed small tiles, so this keeps
 * the motif (dots / grid / `/` diagonals, the player's rotated lines) and
 * its translucent ink rather than the tile size.
 */
export function patternFillXml(pattern: ShapePattern, ground?: string): string {
  const size = pattern.size ?? 24;
  const preset =
    pattern.kind === 'dots'
      ? 'pct5'
      : pattern.kind === 'grid'
        ? size >= 32
          ? 'lgGrid'
          : 'smGrid'
        : size >= 32
          ? 'wdUpDiag'
          : 'ltUpDiag';
  const ink = parseCssColor(pattern.color, 'FFFFFF');
  ink.alpha = Math.round(ink.alpha * Math.max(0, Math.min(1, pattern.opacity ?? 1)));
  const alpha = ink.alpha < 100000 ? `<a:alpha val="${ink.alpha}"/>` : '';
  return (
    `<a:pattFill prst="${preset}">` +
    `<a:fgClr><a:srgbClr val="${ink.hex}">${alpha}</a:srgbClr></a:fgClr>` +
    (ground
      ? `<a:bgClr><a:srgbClr val="${parseCssColor(ground, '000000').hex}"/></a:bgClr>`
      : `<a:bgClr><a:srgbClr val="${ink.hex}"><a:alpha val="0"/></a:srgbClr></a:bgClr>`) +
    `</a:pattFill>`
  );
}

/** A shape layer as a DrawingML shape. */
export function buildLayerShape(layer: ShapeLayer, shapeId: number): string {
  const rect = toEmuRect(resolveLayerRect(layer.position, 100, 100));
  const geometry =
    layer.content.shape === 'circle'
      ? 'ellipse'
      : layer.content.shape === 'line'
        ? 'line'
        : layer.content.borderRadius
          ? 'roundRect'
          : 'rect';
  const fill =
    layer.content.shape === 'line'
      ? '<a:noFill/>'
      : layer.content.pattern
        ? patternFillXml(layer.content.pattern)
        : fillXml(layer.content.fill, layer.content.fillOpacity, layer.content.gradient);
  const stroke = lineXml(
    layer.content.stroke ?? (layer.content.shape === 'line' ? '#ffffff' : undefined),
    layer.content.strokeWidth ?? (layer.content.shape === 'line' ? 2 : undefined),
    layer.content.borderStyle,
  );
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(layer.id)}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.width}" cy="${rect.height}"/></a:xfrm>` +
    `<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>` +
    fill +
    stroke +
    `</p:spPr></p:sp>`
  );
}
