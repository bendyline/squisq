/**
 * Page Style Defaults
 *
 * Derives a complete `ThemePageStyle` from a theme's existing fields so
 * legacy themes, customizer themes, and file-inferred themes get a
 * coherent page art direction without declaring one. Built-in themes
 * ship explicit `pageStyle` blocks in their JSON; this derivation is the
 * fallback used by `compileTheme` and by `resolvePageStyle` at read time.
 *
 * Derivation signals:
 * - `renderStyle.name` → design family (documentary → documentary,
 *   magazine → editorial, bold → brutalist, tech-dark → terminal, …)
 * - `style.borderRadius` → cornerRadius + rounded vs flush image framing
 * - `style.imageTreatment` (mono/duotone) → letterboxed framing
 * - `style.textShadow` → shadow language
 * - `persistentLayers` patternBackground → page pattern
 */

import type { Theme } from './Theme.js';
import type {
  PageDesignFamily,
  PageTokens,
  ThemePageStyle,
  PageHeadingTreatment,
} from './PageStyle.js';

/** renderStyle.name → design family. Unknown names fall back to 'clean'. */
const FAMILY_BY_RENDER_STYLE: Record<string, PageDesignFamily> = {
  standard: 'clean',
  minimalist: 'clean',
  documentary: 'documentary',
  magazine: 'editorial',
  bold: 'brutalist',
  'tech-dark': 'terminal',
  cinematic: 'cinematic',
  'warm-earth': 'organic',
  'morning-light': 'soft',
  gezellig: 'soft',
};

interface FamilyDefaults {
  sectionSpacing: PageTokens['sectionSpacing'];
  divider: PageTokens['divider'];
  backgroundRhythm: PageTokens['backgroundRhythm'];
  heroStyle: PageTokens['heroStyle'];
  headingTreatment: PageHeadingTreatment;
  quoteMark: PageTokens['quoteMark'];
  numeralStyle: PageTokens['numeralStyle'];
  accentStrategy: ThemePageStyle['accentRotation']['strategy'];
}

const FAMILY_DEFAULTS: Record<PageDesignFamily, FamilyDefaults> = {
  clean: {
    sectionSpacing: 'comfortable',
    divider: 'hairline',
    backgroundRhythm: 'alternate',
    heroStyle: 'stacked',
    headingTreatment: { eyebrow: 'kicker', scale: 'regular', underline: 'none' },
    quoteMark: 'accent-bar',
    numeralStyle: 'plain',
    accentStrategy: 'cycle',
  },
  editorial: {
    sectionSpacing: 'comfortable',
    divider: 'double-rule',
    backgroundRhythm: 'flat',
    heroStyle: 'split',
    headingTreatment: { eyebrow: 'kicker', scale: 'display', underline: 'none' },
    quoteMark: 'oversized-glyph',
    numeralStyle: 'oversized',
    accentStrategy: 'alternate-two',
  },
  brutalist: {
    sectionSpacing: 'compact',
    divider: 'thick-rule',
    backgroundRhythm: 'accent-bands',
    heroStyle: 'oversized-type',
    headingTreatment: { eyebrow: 'kicker', scale: 'oversized', case: 'uppercase' },
    quoteMark: 'none',
    numeralStyle: 'oversized',
    accentStrategy: 'cycle',
  },
  terminal: {
    sectionSpacing: 'compact',
    divider: 'hairline',
    backgroundRhythm: 'tinted-panels',
    heroStyle: 'stacked',
    headingTreatment: { eyebrow: 'mono-tag', scale: 'regular', underline: 'none' },
    quoteMark: 'none',
    numeralStyle: 'mono',
    accentStrategy: 'primary-only',
  },
  cinematic: {
    sectionSpacing: 'generous',
    divider: 'gap-only',
    backgroundRhythm: 'flat',
    heroStyle: 'full-bleed',
    headingTreatment: { eyebrow: 'kicker', scale: 'display', case: 'uppercase' },
    quoteMark: 'none',
    numeralStyle: 'oversized',
    accentStrategy: 'primary-only',
  },
  documentary: {
    sectionSpacing: 'generous',
    divider: 'thick-rule',
    backgroundRhythm: 'flat',
    heroStyle: 'letterbox',
    headingTreatment: { eyebrow: 'numbered', scale: 'display', underline: 'none' },
    quoteMark: 'accent-bar',
    numeralStyle: 'boxed',
    accentStrategy: 'primary-only',
  },
  organic: {
    sectionSpacing: 'comfortable',
    divider: 'thick-rule',
    backgroundRhythm: 'tinted-panels',
    heroStyle: 'stacked',
    headingTreatment: { eyebrow: 'kicker', scale: 'regular', underline: 'accent-bar' },
    quoteMark: 'oversized-glyph',
    numeralStyle: 'boxed',
    accentStrategy: 'alternate-two',
  },
  soft: {
    sectionSpacing: 'comfortable',
    divider: 'dotted',
    backgroundRhythm: 'tinted-panels',
    heroStyle: 'split',
    headingTreatment: { eyebrow: 'kicker', scale: 'regular', underline: 'none' },
    quoteMark: 'oversized-glyph',
    numeralStyle: 'plain',
    accentStrategy: 'alternate-two',
  },
};

/** Read the first patternBackground pattern from a theme's persistent layers. */
function derivePattern(theme: Theme): PageTokens['pattern'] {
  const layers = [
    ...(theme.persistentLayers?.bottomLayers ?? []),
    ...(theme.persistentLayers?.topLayers ?? []),
  ];
  for (const layer of layers) {
    if (
      typeof layer === 'object' &&
      layer !== null &&
      'template' in layer &&
      (layer as { template?: unknown }).template === 'patternBackground'
    ) {
      const config = (layer as { config?: { pattern?: unknown } }).config;
      const pattern = config?.pattern;
      if (
        pattern === 'dots' ||
        pattern === 'grid' ||
        pattern === 'diagonal' ||
        pattern === 'noise'
      ) {
        return pattern;
      }
    }
  }
  return undefined;
}

/**
 * Derive a complete `ThemePageStyle` from a theme's existing fields.
 * Deterministic and read-only; explicit `theme.pageStyle` always wins
 * (callers check before deriving — see `resolvePageStyle`).
 */
export function defaultPageStyle(theme: Theme): ThemePageStyle {
  const family = FAMILY_BY_RENDER_STYLE[theme.renderStyle?.name ?? ''] ?? 'clean';
  const defaults = FAMILY_DEFAULTS[family];

  const cornerRadius = theme.style?.borderRadius ?? 6;
  const treatmentType = theme.style?.imageTreatment?.type;
  const imageFraming: PageTokens['imageFraming'] =
    treatmentType === 'mono' || treatmentType === 'duotone'
      ? 'letterboxed'
      : cornerRadius > 0
        ? 'rounded'
        : 'flush';

  const tokens: PageTokens = {
    contentMaxWidth: 760,
    wideMaxWidth: 1100,
    sectionSpacing: defaults.sectionSpacing,
    cornerRadius,
    divider: defaults.divider,
    backgroundRhythm: defaults.backgroundRhythm,
    heroStyle: defaults.heroStyle,
    headingTreatment: { ...defaults.headingTreatment },
    imageFraming,
    shadow: theme.style?.textShadow ? 'soft' : 'none',
    quoteMark: defaults.quoteMark,
    numeralStyle: defaults.numeralStyle,
  };

  const pattern = derivePattern(theme);
  if (pattern) tokens.pattern = pattern;

  return {
    family,
    tokens,
    accentRotation: { strategy: defaults.accentStrategy },
  };
}
