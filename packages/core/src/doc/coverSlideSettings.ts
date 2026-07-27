/**
 * Managed cover-slide settings persisted in Markdown frontmatter.
 *
 * This module is framework-free so the editor, player, and export pipelines
 * resolve one canonical document contract.
 */

/** Built-in visual treatments that can render a document start block. */
export type CoverSlideTemplate = 'cover' | 'title' | 'sectionHeader' | 'imageWithCaption';

/** How an exported video's story clock behaves while the cover is visible. */
export type CoverSlidePlayback = 'overlay' | 'preroll';

export interface CoverSlideSettings {
  enabled: boolean;
  template: CoverSlideTemplate;
  duration: number;
  playback: CoverSlidePlayback;
}

export interface CoverSlideTemplateOption {
  id: CoverSlideTemplate;
  label: string;
  description: string;
  requiresHeroImage?: boolean;
}

export const COVER_SLIDE_TEMPLATE_OPTIONS: readonly CoverSlideTemplateOption[] = Object.freeze([
  {
    id: 'cover',
    label: 'Hero cover',
    description: 'The classic Squisq cover with title, subtitle, and optional hero image.',
  },
  {
    id: 'title',
    label: 'Title',
    description: 'A theme-led title card without a full-bleed image.',
  },
  {
    id: 'sectionHeader',
    label: 'Section header',
    description: 'A bold section divider using the hero image when one is available.',
  },
  {
    id: 'imageWithCaption',
    label: 'Image with title',
    description: 'A full-bleed image with the title and subtitle overlaid.',
    requiresHeroImage: true,
  },
]);

export const COVER_SLIDE_FRONTMATTER_KEYS = Object.freeze({
  enabled: { canonical: 'squisq-cover-slide', legacy: 'cover-slide' },
  template: { canonical: 'squisq-cover-template', legacy: 'cover-template' },
  duration: { canonical: 'squisq-cover-duration', legacy: 'cover-duration' },
  playback: { canonical: 'squisq-cover-playback', legacy: 'cover-playback' },
});

export const DEFAULT_COVER_SLIDE_SETTINGS: Readonly<CoverSlideSettings> = Object.freeze({
  enabled: true,
  template: 'cover',
  duration: 2,
  playback: 'preroll',
});

export const MAX_COVER_SLIDE_DURATION_SECONDS = 60;

function readSetting(
  frontmatter: Record<string, unknown> | undefined,
  keys: { canonical: string; legacy: string },
): unknown {
  if (!frontmatter) return undefined;
  return Object.prototype.hasOwnProperty.call(frontmatter, keys.canonical)
    ? frontmatter[keys.canonical]
    : frontmatter[keys.legacy];
}

function resolveBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'on', 'show', 'visible'].includes(normalized)) return true;
  if (['false', 'no', 'off', 'hide', 'hidden'].includes(normalized)) return false;
  return undefined;
}

function resolveTemplate(value: unknown): CoverSlideTemplate | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '');
  if (normalized === 'cover' || normalized === 'hero' || normalized === 'managedcover') {
    return 'cover';
  }
  if (normalized === 'title' || normalized === 'titleblock') return 'title';
  if (normalized === 'sectionheader' || normalized === 'section') return 'sectionHeader';
  if (
    normalized === 'imagewithcaption' ||
    normalized === 'imagetitle' ||
    normalized === 'fullbleedimage'
  ) {
    return 'imageWithCaption';
  }
  return undefined;
}

function resolveDuration(value: unknown): number | undefined {
  const duration =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_COVER_SLIDE_DURATION_SECONDS) {
    return undefined;
  }
  return duration;
}

function resolvePlayback(value: unknown): CoverSlidePlayback | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  if (['overlay', 'over', 'concurrent', 'play-over'].includes(normalized)) return 'overlay';
  if (['preroll', 'pre-roll', 'delay', 'push', 'shift'].includes(normalized)) return 'preroll';
  return undefined;
}

/** Resolve cover settings from frontmatter, then apply explicit caller overrides. */
export function resolveCoverSlideSettings(
  frontmatter: Record<string, unknown> | undefined,
  overrides: Partial<CoverSlideSettings> = {},
): CoverSlideSettings {
  const resolved: CoverSlideSettings = {
    enabled:
      resolveBoolean(readSetting(frontmatter, COVER_SLIDE_FRONTMATTER_KEYS.enabled)) ??
      DEFAULT_COVER_SLIDE_SETTINGS.enabled,
    template:
      resolveTemplate(readSetting(frontmatter, COVER_SLIDE_FRONTMATTER_KEYS.template)) ??
      DEFAULT_COVER_SLIDE_SETTINGS.template,
    duration:
      resolveDuration(readSetting(frontmatter, COVER_SLIDE_FRONTMATTER_KEYS.duration)) ??
      DEFAULT_COVER_SLIDE_SETTINGS.duration,
    playback:
      resolvePlayback(readSetting(frontmatter, COVER_SLIDE_FRONTMATTER_KEYS.playback)) ??
      DEFAULT_COVER_SLIDE_SETTINGS.playback,
  };

  return {
    enabled: overrides.enabled ?? resolved.enabled,
    template: overrides.template ?? resolved.template,
    duration: resolveDuration(overrides.duration) ?? resolved.duration,
    playback: overrides.playback ?? resolved.playback,
  };
}
