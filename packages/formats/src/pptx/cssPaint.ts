/**
 * CSS paint values → DrawingML: colours (`#rgb`, `rgba()`, names) and the
 * gradient strings templates and theme atmosphere paint with.
 *
 * Templates and theme atmosphere paint full-bleed rects with CSS gradient
 * strings (`linear-gradient(155deg, …)`, `radial-gradient(ellipse at 50% 40%,
 * …)`), which the player draws as an HTML background. This parses the subset
 * they use — an angle or `to <side>` line, an ellipse/circle positioned with
 * `at <x> <y>`, and colour stops with optional percentage positions — so a
 * radial tint stays radial and every stop survives, rather than collapsing
 * to a two-stop linear fill.
 */

import { toOoxmlHex } from '../shared/ooxmlColor.js';

export interface ParsedColor {
  hex: string;
  alpha: number;
}

export function parseCssColor(color: string | undefined, fallback: string): ParsedColor {
  if (!color) return { hex: toOoxmlHex(fallback), alpha: 100000 };
  const trimmed = color.trim();
  if (trimmed === 'transparent' || trimmed === 'none') return { hex: '000000', alpha: 0 };

  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (hexMatch) {
    const raw = hexMatch[1];
    const expanded =
      raw.length === 3
        ? raw
            .split('')
            .map((char) => char + char)
            .join('')
        : raw;
    const alpha =
      expanded.length === 8
        ? Math.round((Number.parseInt(expanded.slice(6, 8), 16) / 255) * 100000)
        : 100000;
    return { hex: expanded.slice(0, 6).toUpperCase(), alpha };
  }

  const rgbMatch =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(trimmed);
  if (rgbMatch) {
    const channel = (value: string): string =>
      Math.max(0, Math.min(255, Math.round(Number(value))))
        .toString(16)
        .padStart(2, '0');
    const alpha = rgbMatch[4]
      ? Math.round(Math.max(0, Math.min(1, Number(rgbMatch[4]))) * 100000)
      : 100000;
    return {
      hex: `${channel(rgbMatch[1])}${channel(rgbMatch[2])}${channel(rgbMatch[3])}`.toUpperCase(),
      alpha,
    };
  }

  const named: Record<string, string> = {
    black: '000000',
    white: 'FFFFFF',
    red: 'FF0000',
    blue: '0000FF',
    green: '008000',
    gray: '808080',
    grey: '808080',
  };
  return { hex: named[trimmed.toLowerCase()] ?? toOoxmlHex(fallback), alpha: 100000 };
}

export interface GradientStop {
  color: ParsedColor;
  /** 0 – 1 along the gradient line (linear) or ray (radial). */
  position: number;
}

export type CssGradient =
  | {
      kind: 'linear';
      /** CSS degrees: 0 points up, 90 right, 180 down. */
      angle: number;
      stops: GradientStop[];
    }
  | {
      kind: 'radial';
      /** Centre as a fraction of the box, 0 – 1. */
      centerX: number;
      centerY: number;
      stops: GradientStop[];
    };

/** Split on commas outside parentheses (`rgba(1, 2, 3, 0.5)` stays whole). */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const SIDE_ANGLES: Record<string, number> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
  'top right': 45,
  'right top': 45,
  'bottom right': 135,
  'right bottom': 135,
  'bottom left': 225,
  'left bottom': 225,
  'top left': 315,
  'left top': 315,
};

function parseAngle(token: string): number | null {
  const side = /^to\s+(.+)$/i.exec(token);
  if (side) return SIDE_ANGLES[side[1]!.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
  const match = /^(-?[\d.]+)(deg|turn|rad|grad)$/i.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (!Number.isFinite(value)) return null;
  if (unit === 'turn') return value * 360;
  if (unit === 'rad') return (value * 180) / Math.PI;
  if (unit === 'grad') return value * 0.9;
  return value;
}

const POSITION_KEYWORDS: Record<string, number> = {
  left: 0,
  top: 0,
  center: 0.5,
  right: 1,
  bottom: 1,
};

/** `at 50% 40%` / `at center` / `at top left` → fractional centre. */
function parseRadialCenter(token: string): { x: number; y: number } {
  const at = /\bat\s+(.+)$/i.exec(token);
  if (!at) return { x: 0.5, y: 0.5 };
  const parts = at[1]!.trim().toLowerCase().split(/\s+/);
  const value = (part: string | undefined): number | undefined => {
    if (part === undefined) return undefined;
    if (part in POSITION_KEYWORDS) return POSITION_KEYWORDS[part];
    const percent = /^(-?[\d.]+)%$/.exec(part);
    return percent ? Number(percent[1]) / 100 : undefined;
  };
  // Keywords may come in either order (`top left`); percentages are x then y.
  if (parts.length === 1) {
    const only = parts[0]!;
    if (only === 'top' || only === 'bottom') return { x: 0.5, y: value(only) ?? 0.5 };
    return { x: value(only) ?? 0.5, y: 0.5 };
  }
  const [first, second] = parts;
  if (first === 'top' || first === 'bottom' || second === 'left' || second === 'right') {
    return { x: value(second) ?? 0.5, y: value(first) ?? 0.5 };
  }
  return { x: value(first) ?? 0.5, y: value(second) ?? 0.5 };
}

/** Colour syntaxes `parseCssColor` reads; anything else is not a stop. */
const CSS_COLOR =
  /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([^)]*\)|transparent|black|white|red|blue|green|gr[ae]y)$/i;

/** One colour stop: the colour, then up to two optional `%` positions. */
function parseStop(token: string): Array<{ color: ParsedColor; position?: number }> | null {
  const positions: number[] = [];
  let rest = token.trim();
  for (;;) {
    const match = /\s+(-?[\d.]+)%$/.exec(rest);
    if (!match) break;
    positions.unshift(Number(match[1]) / 100);
    rest = rest.slice(0, match.index).trim();
  }
  if (!CSS_COLOR.test(rest)) return null;
  const color = parseCssColor(rest, '000000');
  if (positions.length === 0) return [{ color }];
  return positions.slice(0, 2).map((position) => ({ color: { ...color }, position }));
}

/**
 * Fill in missing stop positions the way CSS does: the first defaults to 0,
 * the last to 1, interior gaps spread evenly, and no stop sits before the
 * one ahead of it.
 */
function resolveStopPositions(
  raw: Array<{ color: ParsedColor; position?: number }>,
): GradientStop[] {
  const positions = raw.map((stop) => stop.position);
  if (positions[0] === undefined) positions[0] = 0;
  if (positions[positions.length - 1] === undefined) positions[positions.length - 1] = 1;
  let previous = 0;
  for (let index = 0; index < positions.length; index++) {
    const value = positions[index];
    if (value === undefined) continue;
    positions[index] = Math.max(previous, value);
    previous = positions[index]!;
  }
  for (let index = 1; index < positions.length; index++) {
    if (positions[index] !== undefined) continue;
    const start = index - 1;
    let end = index;
    while (positions[end] === undefined) end++;
    const from = positions[start]!;
    const to = positions[end]!;
    for (let gap = index; gap < end; gap++) {
      positions[gap] = from + ((to - from) * (gap - start)) / (end - start);
    }
  }
  return raw.map((stop, index) => ({
    color: stop.color,
    position: Math.max(0, Math.min(1, positions[index]!)),
  }));
}

/**
 * A fully transparent stop takes its neighbour's hue. CSS interpolates in
 * premultiplied alpha, so `transparent` fades a colour out without darkening;
 * DrawingML interpolates straight RGB, so `transparent` (black, alpha 0)
 * would drag every midpoint toward grey.
 */
function borrowTransparentHues(stops: GradientStop[]): GradientStop[] {
  return stops.map((stop, index) => {
    if (stop.color.alpha > 0) return stop;
    const neighbour =
      stops.slice(index + 1).find((candidate) => candidate.color.alpha > 0) ??
      [...stops.slice(0, index)].reverse().find((candidate) => candidate.color.alpha > 0);
    return neighbour ? { ...stop, color: { hex: neighbour.color.hex, alpha: 0 } } : stop;
  });
}

/** Parse a CSS `linear-gradient(…)` / `radial-gradient(…)` value, or null. */
export function parseCssGradient(value: string): CssGradient | null {
  const match = /(linear|radial)-gradient\(\s*([\s\S]*)\)\s*$/i.exec(value.trim());
  if (!match) return null;
  const kind = match[1]!.toLowerCase() as 'linear' | 'radial';
  const args = splitTopLevel(match[2]!);
  if (args.length === 0) return null;

  const first = args[0]!;
  let angle = 180;
  let center = { x: 0.5, y: 0.5 };
  let stopTokens = args;
  if (kind === 'linear') {
    const parsed = parseAngle(first);
    if (parsed !== null) {
      angle = parsed;
      stopTokens = args.slice(1);
    }
  } else if (/^(circle|ellipse|closest-|farthest-|at\s)/i.test(first) || /\bat\s/i.test(first)) {
    center = parseRadialCenter(first);
    stopTokens = args.slice(1);
  }
  const raw = stopTokens.flatMap((token) => parseStop(token) ?? []);
  if (raw.length < 2) return null;
  const stops = borrowTransparentHues(resolveStopPositions(raw));
  return kind === 'linear'
    ? { kind, angle, stops }
    : { kind, centerX: center.x, centerY: center.y, stops };
}

/** True when every stop is fully opaque. */
export function isOpaqueGradient(gradient: CssGradient): boolean {
  return gradient.stops.every((stop) => stop.color.alpha >= 100000);
}

/**
 * DrawingML `gradFill` for a parsed gradient, its alpha scaled by `opacity`.
 *
 * Linear: CSS measures the angle from "up" clockwise, DrawingML's `lin` from
 * "right" clockwise, and the gradient follows the box's real geometry
 * (`scaled="0"`) as CSS's does. Radial: a `circle` path whose focus is the
 * CSS centre — stop 0 at the focus, the last stop at the box's edge, the
 * same outward order CSS uses.
 */
export function cssGradientFillXml(gradient: CssGradient, opacity = 1): string {
  const factor = Math.max(0, Math.min(1, opacity));
  const stops = gradient.stops
    .map(({ color, position }) => {
      const alpha = Math.round(color.alpha * factor);
      return (
        `<a:gs pos="${Math.round(position * 100000)}"><a:srgbClr val="${color.hex}">` +
        (alpha < 100000 ? `<a:alpha val="${alpha}"/>` : '') +
        `</a:srgbClr></a:gs>`
      );
    })
    .join('');
  if (gradient.kind === 'linear') {
    const angle = Math.round(((((gradient.angle - 90) % 360) + 360) % 360) * 60000);
    return (
      `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>` +
      `<a:lin ang="${angle}" scaled="0"/></a:gradFill>`
    );
  }
  const edge = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 100000);
  return (
    `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>` +
    `<a:path path="circle"><a:fillToRect l="${edge(gradient.centerX)}" t="${edge(gradient.centerY)}"` +
    ` r="${edge(1 - gradient.centerX)}" b="${edge(1 - gradient.centerY)}"/></a:path></a:gradFill>`
  );
}

/** `src` painted over the opaque colour `dst` (straight alpha), as six hex digits. */
export function blendOver(dst: string, src: ParsedColor): string {
  const alpha = Math.max(0, Math.min(1, src.alpha / 100000));
  const channel = (offset: number) => {
    const under = Number.parseInt(dst.slice(offset, offset + 2), 16);
    const over = Number.parseInt(src.hex.slice(offset, offset + 2), 16);
    return Math.round(over * alpha + under * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  };
  return `${channel(0)}${channel(2)}${channel(4)}`.toUpperCase();
}

/** A parsed gradient back as CSS, which `parseCssGradient` reads unchanged. */
export function cssGradientToString(gradient: CssGradient): string {
  const stops = gradient.stops
    .map(({ color, position }) => {
      const alpha = color.alpha / 100000;
      const value =
        alpha >= 1
          ? `#${color.hex}`
          : `rgba(${Number.parseInt(color.hex.slice(0, 2), 16)}, ${Number.parseInt(color.hex.slice(2, 4), 16)}, ${Number.parseInt(color.hex.slice(4, 6), 16)}, ${alpha})`;
      return `${value} ${+(position * 100).toFixed(3)}%`;
    })
    .join(', ');
  return gradient.kind === 'linear'
    ? `linear-gradient(${gradient.angle}deg, ${stops})`
    : `radial-gradient(ellipse at ${+(gradient.centerX * 100).toFixed(3)}% ${+(gradient.centerY * 100).toFixed(3)}%, ${stops})`;
}
