/** Canonical and legacy keys for frontmatter settings managed by the editor. */
export const FRONTMATTER_SETTING_KEYS = {
  theme: { canonical: 'squisq-theme', legacy: ['themeId', 'theme'] as const },
  transform: { canonical: 'squisq-transform', legacy: 'transform-style' as const },
  captions: { canonical: 'squisq-captions', legacy: 'caption-style' as const },
  coverSlide: { canonical: 'squisq-cover-slide', legacy: 'cover-slide' as const },
} as const;

/** Runtime defaults whose equivalent frontmatter entries can be omitted. */
export const FRONTMATTER_SETTING_DEFAULTS = {
  theme: 'standard',
  transform: '',
  captions: 'standard',
  coverSlide: true,
} as const;

/** Return `null` when a setting matches its runtime default so writers remove it. */
export function omitFrontmatterDefault<T extends string | number | boolean>(
  value: T,
  defaultValue: T,
): T | null {
  return value === defaultValue ? null : value;
}
