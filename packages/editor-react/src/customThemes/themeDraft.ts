/**
 * themeDraft — the editable subset of the Theme schema, shared by the
 * ThemeCustomizerPanel popover and the CustomThemeDialog.
 *
 * A `Draft` mirrors the handful of fields a user actually edits (name, seed
 * colors, N accents, fonts, style presets, and a base theme to inherit from).
 * `compileDraft` turns it into a full validated `Theme` via `compileTheme`;
 * everything the draft doesn't mention inherits from the chosen base (or the
 * compiler's neutral STARTER_THEME when no base is picked).
 */

import type {
  Theme,
  FontFamily,
  ThemeSeedColors,
  ThemeColorScheme,
} from '@bendyline/squisq/schemas';
import { compileTheme, deriveScale, isHex } from '@bendyline/squisq/schemas';

// ── Preset → schema-value tables ────────────────────────────────────

export const BORDER_RADIUS_PRESETS = {
  sharp: 0,
  soft: 6,
  rounded: 16,
} as const;
export type BorderRadiusPreset = keyof typeof BORDER_RADIUS_PRESETS;

export const ANIMATION_SPEED_PRESETS = {
  static: 0,
  subtle: 1.4,
  normal: 1.0,
  expressive: 0.7,
} as const;
export type AnimationSpeedPreset = keyof typeof ANIMATION_SPEED_PRESETS;

export const TEXT_SHADOW_PRESETS = {
  off: false,
  on: true,
} as const;
export type TextShadowPreset = keyof typeof TEXT_SHADOW_PRESETS;

export const CONTRAST_PRESETS = ['subtle', 'balanced', 'high'] as const;
export type ContrastPreset = (typeof CONTRAST_PRESETS)[number];

export const IMAGE_TREATMENT_PRESETS = ['none', 'mono', 'duotone', 'warm', 'cool'] as const;
export type ImageTreatmentPreset = (typeof IMAGE_TREATMENT_PRESETS)[number];

export const FALLBACK_OPTIONS = ['sans-serif', 'serif', 'monospace', 'system-ui'] as const;
export type FallbackOption = (typeof FALLBACK_OPTIONS)[number];

// ── Draft state — reflects the editable subset of the schema ────────

export interface CustomFontInput {
  kind: 'curated' | 'custom';
  stackId?: string;
  customName?: string;
  customFallback?: FallbackOption;
}

/** One editable accent: a color plus the colorScheme key it maps to. */
export interface AccentInput {
  key: string;
  color: string;
}

export interface Draft {
  name: string;
  /** Id of the base theme this draft inherits render style / layout from. */
  baseId?: string;
  seeds: ThemeSeedColors;
  /** The "N accents" — each becomes a `colorSchemes` entry. */
  accents: AccentInput[];
  /** True once the user has touched the accent list; gates wholesale replace. */
  accentsEdited: boolean;
  titleFont: CustomFontInput;
  bodyFont: CustomFontInput;
  borderRadius: BorderRadiusPreset;
  animationSpeed: AnimationSpeedPreset;
  textShadow: TextShadowPreset;
  contrast: ContrastPreset;
  imageTreatment: ImageTreatmentPreset;
}

export const DEFAULT_DRAFT: Draft = {
  name: 'My Theme',
  seeds: {
    primary: '#3182ce',
    secondary: '#4a5568',
    accent: '#63b3ed',
    background: '#1a202c',
    text: '#f7fafc',
  },
  accents: [],
  accentsEdited: false,
  titleFont: { kind: 'curated', stackId: 'system-serif' },
  bodyFont: { kind: 'curated', stackId: 'system-sans' },
  borderRadius: 'soft',
  animationSpeed: 'normal',
  textShadow: 'on',
  contrast: 'balanced',
  imageTreatment: 'none',
};

function findRadiusPreset(value: number | undefined): BorderRadiusPreset {
  if (value === undefined) return 'soft';
  let best: BorderRadiusPreset = 'soft';
  let bestDist = Infinity;
  (Object.entries(BORDER_RADIUS_PRESETS) as [BorderRadiusPreset, number][]).forEach(([k, v]) => {
    const d = Math.abs(v - value);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  });
  return best;
}

function findAnimationPreset(value: number | undefined): AnimationSpeedPreset {
  if (value === undefined || value === 0) return value === 0 ? 'static' : 'normal';
  let best: AnimationSpeedPreset = 'normal';
  let bestDist = Infinity;
  (Object.entries(ANIMATION_SPEED_PRESETS) as [AnimationSpeedPreset, number][]).forEach(
    ([k, v]) => {
      if (v === 0) return; // 'static' handled above
      const d = Math.abs(v - value);
      if (d < bestDist) {
        best = k;
        bestDist = d;
      }
    },
  );
  return best;
}

function fontFamilyToInput(f: FontFamily | undefined, fallbackStackId: string): CustomFontInput {
  if (!f) return { kind: 'curated', stackId: fallbackStackId };
  if ('stackId' in f) return { kind: 'curated', stackId: f.stackId };
  if ('custom' in f)
    return {
      kind: 'custom',
      customName: f.custom.name,
      customFallback: f.custom.fallback,
    };
  return { kind: 'curated', stackId: fallbackStackId };
}

function inputToFontFamily(input: CustomFontInput): FontFamily {
  if (input.kind === 'curated') {
    return { stackId: input.stackId ?? 'system-sans' };
  }
  return {
    custom: {
      name: input.customName ?? 'Sans',
      fallback: input.customFallback ?? 'sans-serif',
    },
  };
}

/** Read a theme's per-block color schemes back into the editable accent list. */
export function accentsFromTheme(theme: Theme | null): AccentInput[] {
  if (!theme) return [];
  return Object.entries(theme.colorSchemes).map(([key, scheme]) => ({ key, color: scheme.accent }));
}

/**
 * Expand one accent color into a full `{bg, text, accent}` color scheme via
 * the OKLCh scale — dark saturated bg, light readable text, the picked accent.
 * Falls back to a neutral scheme when the input isn't a valid hex.
 */
export function schemeFromAccent(accent: string): ThemeColorScheme {
  if (!isHex(accent)) return { bg: '#1a202c', text: '#e2e8f0', accent: '#63b3ed' };
  const scale = deriveScale(accent, 0.3);
  return { bg: scale.darker2, text: scale.lighter2, accent: scale.base };
}

export function themeToDraft(theme: Theme | null): Draft {
  if (!theme) return { ...DEFAULT_DRAFT };
  const seeds: ThemeSeedColors = theme.seedColors ?? {
    primary: theme.colors.primary,
    secondary: theme.colors.secondary,
    accent: theme.colors.highlight,
    background: theme.colors.background,
    text: theme.colors.text,
  };
  return {
    name: theme.name,
    baseId: theme.basedOn,
    seeds: {
      primary: seeds.primary,
      secondary: seeds.secondary,
      accent: seeds.accent,
      background: seeds.background,
      text: seeds.text,
    },
    accents: accentsFromTheme(theme),
    // Populated for display, but NOT treated as authored by default: with
    // `accentsEdited` false the compiled theme inherits the base's color
    // schemes verbatim. The dialog flips this true when the user actually
    // edits an accent (or when re-opening an existing custom theme, so its
    // own accents survive a re-save). The popover panel never edits accents,
    // so it always inherits — preserving its prior behavior.
    accentsEdited: false,
    titleFont: fontFamilyToInput(theme.typography.titleFont, 'system-serif'),
    bodyFont: fontFamilyToInput(theme.typography.bodyFont, 'system-sans'),
    borderRadius: findRadiusPreset(theme.style.borderRadius),
    animationSpeed: findAnimationPreset(theme.style.animationSpeed),
    textShadow: theme.style.textShadow === false ? 'off' : 'on',
    contrast: 'balanced',
    imageTreatment: theme.style.imageTreatment?.type ?? 'none',
  };
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom'
  );
}

export interface CompileDraftOptions {
  /** Existing id to preserve across edits (keeps `squisq-theme` selection stable). */
  existingId?: string;
  /** Base theme to inherit render style / color schemes / typography from. */
  base?: Theme;
}

/**
 * Compile a `Draft` into a full validated `Theme`. Colors derive from the seed
 * colors; the accent list (when edited) replaces `colorSchemes` wholesale; and
 * everything else inherits from `opts.base` (or the neutral STARTER_THEME).
 */
export function compileDraft(draft: Draft, opts: CompileDraftOptions = {}): Theme {
  const existingId = opts.existingId;
  const id =
    existingId && existingId.startsWith('custom-') ? existingId : `custom-${slugify(draft.name)}`;

  const colorSchemes =
    draft.accentsEdited && draft.accents.length > 0
      ? Object.fromEntries(draft.accents.map((a) => [a.key, schemeFromAccent(a.color)]))
      : undefined;

  return compileTheme(
    {
      id,
      name: draft.name,
      seedColors: draft.seeds,
      typography: {
        titleFont: inputToFontFamily(draft.titleFont),
        bodyFont: inputToFontFamily(draft.bodyFont),
      },
      style: {
        borderRadius: BORDER_RADIUS_PRESETS[draft.borderRadius],
        animationSpeed: ANIMATION_SPEED_PRESETS[draft.animationSpeed],
        textShadow: TEXT_SHADOW_PRESETS[draft.textShadow],
        ...(draft.imageTreatment !== 'none'
          ? { imageTreatment: { type: draft.imageTreatment, strength: 0.5 } }
          : {}),
      },
      ...(colorSchemes ? { colorSchemes } : {}),
    },
    { contrast: draft.contrast, base: opts.base },
  );
}

/** Add a fresh accent slot with a sensible starting color. */
export function nextAccent(accents: AccentInput[]): AccentInput {
  const n = accents.length + 1;
  return { key: `accent${n}`, color: '#63b3ed' };
}
