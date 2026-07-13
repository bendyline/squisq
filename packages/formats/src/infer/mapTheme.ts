/**
 * Map a raw OOXML theme extraction onto a compiled Squisq `Theme`.
 *
 * Only a handful of seeds are taken from the file (lead accents, background,
 * text, major/minor fonts); `compileTheme` derives the rest of the palette
 * via OKLCh so the result is always a complete, validated theme that stays
 * re-editable in the customizer (seeds are recorded on `Theme.seedColors`).
 */

import type {
  DeepPartial,
  Theme,
  ThemeColorScheme,
  ThemeSeedColors,
} from '@bendyline/squisq/schemas';
import {
  accentToColorScheme,
  compileTheme,
  contrastRatio,
  isHex,
  matchFontFamily,
  relativeLuminance,
} from '@bendyline/squisq/schemas';
import type { PptxColorHints } from '../pptx/layouts.js';
import type { ExtractedFileTheme } from './types.js';

export interface CompileExtractedOptions {
  /** Preferred display name for the compiled theme (e.g. the file's basename). */
  nameHint?: string;
}

export interface MappedThemePartial {
  partial: DeepPartial<Theme>;
  warnings: string[];
}

/** Neutral primary used when a theme resolves no usable accent slots. */
const FALLBACK_PRIMARY = '#3182ce';

/** Accents closer to the background than this contrast are dropped (near-invisible). */
const MIN_ACCENT_CONTRAST = 1.3;

const ACCENT_SLOTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

/** Companion slot providing `backgroundLight` for each background slot. */
const COMPANION_SLOT = { lt1: 'lt2', dk1: 'dk2', lt2: 'lt1', dk2: 'dk1' } as const;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'imported';
}

/**
 * Build the `DeepPartial<Theme>` for an extraction. Exported for tests; most
 * callers want {@link compileExtractedTheme}.
 */
export function extractedThemeToPartial(
  extraction: ExtractedFileTheme,
  opts: CompileExtractedOptions = {},
): MappedThemePartial {
  const warnings: string[] = [];
  const { colors, colorMap, fonts } = extraction;

  const name = opts.nameHint?.trim() || extraction.themeName || 'Imported Theme';
  const partial: DeepPartial<Theme> = {
    id: `custom-${slugify(name)}`,
    name,
    description: `Imported from a ${extraction.sourceFormat} file${
      extraction.themeName ? ` (theme "${extraction.themeName}")` : ''
    }.`,
  };

  if (colors) {
    const primary = colors.accent1 ?? colors.accent2;
    if (!primary) {
      warnings.push('theme: no usable accent colors; primary defaults to Squisq blue');
    }

    let background: string | undefined = colors[colorMap.bg1];
    let text: string | undefined = colors[colorMap.tx1];
    // Pathological color maps can land background and text on similar
    // surfaces; when they don't contrast, let the compiler derive both
    // from the primary instead of shipping unreadable seeds.
    if (
      background &&
      text &&
      Math.abs(relativeLuminance(background) - relativeLuminance(text)) < 0.2
    ) {
      warnings.push('theme: background and text colors are too close; deriving surfaces instead');
      background = undefined;
      text = undefined;
    }

    const seeds: ThemeSeedColors = {
      primary: primary ?? FALLBACK_PRIMARY,
      ...(colors.accent2 ? { secondary: colors.accent2 } : {}),
      ...(colors.accent3 ? { accent: colors.accent3 } : {}),
      ...(background ? { background } : {}),
      ...(text ? { text } : {}),
    };
    partial.seedColors = seeds;

    const explicitColors: DeepPartial<Theme>['colors'] = {};
    const companion = background ? colors[COMPANION_SLOT[colorMap.bg1]] : undefined;
    if (background && companion && companion !== background) {
      explicitColors.backgroundLight = companion;
    }
    if (colors.hlink && isHex(colors.hlink)) {
      explicitColors.highlight = colors.hlink;
    }
    if (Object.keys(explicitColors).length > 0) partial.colors = explicitColors;

    const schemes: Record<string, ThemeColorScheme> = {};
    const seenHexes = new Set<string>();
    const schemeBackground = background ?? colors[colorMap.bg1];
    for (const slot of ACCENT_SLOTS) {
      const hex = colors[slot];
      if (!hex || seenHexes.has(hex)) continue;
      if (schemeBackground && contrastRatio(hex, schemeBackground) < MIN_ACCENT_CONTRAST) {
        warnings.push(`theme: ${slot} is too close to the background; dropped from accents`);
        continue;
      }
      seenHexes.add(hex);
      schemes[slot] = accentToColorScheme(hex);
    }
    if (Object.keys(schemes).length > 0) partial.colorSchemes = schemes;
  }

  if (fonts?.majorLatin || fonts?.minorLatin) {
    partial.typography = {
      ...(fonts.majorLatin ? { titleFont: matchFontFamily(fonts.majorLatin) } : {}),
      ...(fonts.minorLatin ? { bodyFont: matchFontFamily(fonts.minorLatin) } : {}),
    };
  }

  return { partial, warnings };
}

/**
 * Compile an extraction into a full validated Squisq theme. Mapping warnings
 * (dropped accents, low-contrast surfaces) are returned alongside; extraction
 * warnings stay on `extraction.warnings`.
 */
export function compileExtractedTheme(
  extraction: ExtractedFileTheme,
  opts: CompileExtractedOptions = {},
): { theme: Theme; warnings: string[] } {
  const { partial, warnings } = extractedThemeToPartial(extraction, opts);
  return { theme: compileTheme(partial), warnings };
}

/**
 * Build the color hints the PPTX layout generator uses to resolve scheme
 * color references (`a:schemeClr val="accent1"`, `bg1`, `tx1`, …) on
 * decorative shapes.
 */
export function colorHintsFromExtraction(extraction: ExtractedFileTheme): PptxColorHints {
  const { colors, colorMap } = extraction;
  if (!colors) return {};
  const schemeColors: Record<string, string> = {};
  for (const [slot, hex] of Object.entries(colors)) {
    if (typeof hex === 'string') schemeColors[slot] = hex;
  }
  const background = colors[colorMap.bg1];
  const text = colors[colorMap.tx1];
  if (background) schemeColors['bg1'] = background;
  if (text) schemeColors['tx1'] = text;
  return {
    ...(background ? { background } : {}),
    ...(text ? { text } : {}),
    schemeColors,
  };
}
