/**
 * Color Utilities
 *
 * Pure-JS color math used by theme compilation and contrast checks.
 * No dependencies. Operates on `#rrggbb` hex strings.
 *
 * Internally uses OKLCh — perceptually uniform, so lightening by 0.1
 * looks like the same change at any starting point. Out-of-gamut
 * results are clamped to sRGB.
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Test whether a string is a valid `#rgb` or `#rrggbb` hex color. */
export function isHex(value: string): boolean {
  return HEX_RE.test(value);
}

/** Parse `#rgb` or `#rrggbb` into 0..1 sRGB triplet. Returns null on failure. */
function parseHex(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null;
  let body = hex.slice(1);
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  return [
    parseInt(body.slice(0, 2), 16) / 255,
    parseInt(body.slice(2, 4), 16) / 255,
    parseInt(body.slice(4, 6), 16) / 255,
  ];
}

function toHex(rgb: [number, number, number]): string {
  const ch = (v: number) => {
    const c = Math.max(0, Math.min(255, Math.round(v * 255)));
    return c.toString(16).padStart(2, '0');
  };
  return '#' + ch(rgb[0]) + ch(rgb[1]) + ch(rgb[2]);
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

interface OKLCh {
  L: number;
  C: number;
  h: number;
}

function rgbToOklch(rgb: [number, number, number]): OKLCh {
  const [sr, sg, sb] = rgb;
  const r = srgbToLinear(sr);
  const g = srgbToLinear(sg);
  const b = srgbToLinear(sb);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

function oklchToRgb({ L, C, h }: OKLCh): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const bb = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [
    Math.max(0, Math.min(1, linearToSrgb(r))),
    Math.max(0, Math.min(1, linearToSrgb(g))),
    Math.max(0, Math.min(1, linearToSrgb(b))),
  ];
}

/**
 * Lighten a color by `amount` (0..1) in OKLCh L space.
 * Falls back to the input on parse failure.
 */
export function oklchLighten(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const lch = rgbToOklch(rgb);
  lch.L = Math.max(0, Math.min(1, lch.L + amount));
  return toHex(oklchToRgb(lch));
}

/**
 * Darken a color by `amount` (0..1) in OKLCh L space.
 * Falls back to the input on parse failure.
 */
export function oklchDarken(hex: string, amount: number): string {
  return oklchLighten(hex, -amount);
}

/**
 * Adjust the OKLCh chroma of a color by a multiplier (e.g. 0.7 to mute).
 */
export function oklchSetChroma(hex: string, multiplier: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const lch = rgbToOklch(rgb);
  lch.C = Math.max(0, lch.C * multiplier);
  return toHex(oklchToRgb(lch));
}

/**
 * WCAG relative luminance of a hex color, returned as 0..1.
 */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(srgbToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two hex colors. Returns 1..21.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick a near-white or near-black text color that contrasts well against `bg`.
 */
export function pickContrastingText(bg: string, light = '#f7fafc', dark = '#1a202c'): string {
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}

/**
 * Derive a 5-step lighter→darker scale from a seed color.
 * Stops are evenly spaced in OKLCh L space around the seed.
 * `spread` controls amplitude (0.05 = subtle, 0.15 = balanced, 0.22 = high).
 */
export function deriveScale(seedHex: string, spread = 0.15): {
  lighter2: string;
  lighter1: string;
  base: string;
  darker1: string;
  darker2: string;
} {
  return {
    lighter2: oklchLighten(seedHex, spread),
    lighter1: oklchLighten(seedHex, spread / 2),
    base: seedHex,
    darker1: oklchDarken(seedHex, spread / 2),
    darker2: oklchDarken(seedHex, spread),
  };
}
