/**
 * Shared color normalization for OOXML exporters (DOCX + PPTX).
 *
 * OOXML's `ST_HexColorRGB` simple type (used by `<w:color w:val>`,
 * `<w:shd w:fill>`, `<a:srgbClr val>`, …) is defined as EXACTLY six hex
 * digits — no leading `#`, no 3-digit shorthand, nothing else. Word and
 * PowerPoint respond to a violation with a "repair this file?" prompt
 * rather than a graceful fallback, so every color that reaches an
 * attribute has to be normalized at the boundary.
 *
 * Two real inputs make that non-optional:
 *
 * 1. `themeValidator` deliberately accepts `#rgb` shorthand, so a *valid*
 *    custom theme can carry `#fff`. Merely stripping the hash yields
 *    `fff` — invalid.
 * 2. A programmatic `Doc` with `customThemes` (the `kind: 'doc'` convert
 *    source) never passes through frontmatter validation at all —
 *    `resolveThemeForDoc` uses `doc.customThemes` as-is. An arbitrary
 *    string therefore reaches the exporter and, without normalization,
 *    would be interpolated straight into an XML attribute (`"/><script`
 *    and friends).
 *
 * Because the return value is *always* six characters drawn from
 * `[0-9A-F]`, this function is both a normalizer and the escape barrier:
 * no input can produce a character with meaning in XML attribute context.
 */

/** `#rgb` / `rgb` shorthand. */
const HEX3_RE = /^#?([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
/** `#rrggbb` / `rrggbb`. */
const HEX6_RE = /^#?([0-9a-fA-F]{6})$/;
/** `#rrggbbaa` / `rrggbbaa` — alpha is dropped (OOXML carries it separately). */
const HEX8_RE = /^#?([0-9a-fA-F]{6})[0-9a-fA-F]{2}$/;

/**
 * Normalize a CSS-ish hex color into an OOXML `ST_HexColorRGB` value:
 * six uppercase hex digits, no `#`.
 *
 * Accepts `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha dropped) with or without
 * the leading hash. ANY other input — named colors, `rgb()` / `oklch()`
 * functions, empty strings, or hostile text — yields `fallback`, which is
 * itself normalized and defaults to black. The result is guaranteed to
 * match `/^[0-9A-F]{6}$/`, so it is always safe to interpolate directly
 * into an XML attribute value.
 */
export function toOoxmlHex(color: string | undefined | null, fallback = '000000'): string {
  const normalized = normalizeOoxmlHex(color);
  if (normalized) return normalized;
  // Guard against a caller passing an invalid fallback of their own.
  return normalizeOoxmlHex(fallback) ?? '000000';
}

/**
 * Like {@link toOoxmlHex}, but returns `undefined` for anything that is not a
 * usable hex color instead of substituting a fallback.
 *
 * This is what callers want when "no color" is a meaningful state — e.g. the
 * DOCX exporter omits the `<w:color>` element entirely rather than emitting
 * one, so an unparseable theme color degrades to Word's own default instead of
 * being forced to black (which would be actively wrong on a dark theme).
 */
export function normalizeOoxmlHex(color: string | undefined | null): string | undefined {
  if (typeof color !== 'string') return undefined;
  const trimmed = color.trim();

  const six = HEX6_RE.exec(trimmed);
  if (six) return six[1]!.toUpperCase();

  const eight = HEX8_RE.exec(trimmed);
  if (eight) return eight[1]!.toUpperCase();

  const three = HEX3_RE.exec(trimmed);
  if (three) {
    const [, r, g, b] = three;
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return undefined;
}
