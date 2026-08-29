import {
  COVER_SLIDE_FRONTMATTER_KEYS,
  DASHBOARD_FRONTMATTER_KEYS,
  DEFAULT_COVER_SLIDE_SETTINGS,
  DEFAULT_DASHBOARD_SETTINGS,
} from '@bendyline/squisq/doc';
import { DEFAULT_PROOF_SETTINGS, PROOF_FRONTMATTER_KEYS } from '@bendyline/squisq/proof';

/** Canonical and legacy keys for frontmatter settings managed by the editor. */
export const FRONTMATTER_SETTING_KEYS = {
  theme: { canonical: 'squisq-theme', legacy: ['themeId', 'theme'] as const },
  transform: { canonical: 'squisq-transform', legacy: 'transform-style' as const },
  captions: { canonical: 'squisq-captions', legacy: 'caption-style' as const },
  coverSlide: COVER_SLIDE_FRONTMATTER_KEYS.enabled,
  coverTemplate: COVER_SLIDE_FRONTMATTER_KEYS.template,
  coverDuration: COVER_SLIDE_FRONTMATTER_KEYS.duration,
  coverPlayback: COVER_SLIDE_FRONTMATTER_KEYS.playback,
  videoLoop: { canonical: 'squisq-video-loop', legacy: 'video-loop' as const },
  videoPresentation: {
    canonical: 'squisq-video-presentation',
    legacy: 'video-presentation' as const,
  },
  pipSize: { canonical: 'squisq-pip-size', legacy: 'pip-size' as const },
  pipShape: { canonical: 'squisq-pip-shape', legacy: 'pip-shape' as const },
  pipPosition: { canonical: 'squisq-pip-position', legacy: 'pip-position' as const },
  dashboardLayout: DASHBOARD_FRONTMATTER_KEYS.layout,
  dashboardTitle: DASHBOARD_FRONTMATTER_KEYS.showTitle,
  dashboardStyle: DASHBOARD_FRONTMATTER_KEYS.style,
  proofing: PROOF_FRONTMATTER_KEYS.enabled,
  proofDialect: PROOF_FRONTMATTER_KEYS.dialect,
} as const;

/** Runtime defaults whose equivalent frontmatter entries can be omitted. */
export const FRONTMATTER_SETTING_DEFAULTS = {
  theme: 'standard',
  transform: '',
  captions: 'standard',
  coverSlide: DEFAULT_COVER_SLIDE_SETTINGS.enabled,
  coverTemplate: DEFAULT_COVER_SLIDE_SETTINGS.template,
  coverDuration: DEFAULT_COVER_SLIDE_SETTINGS.duration,
  coverPlayback: DEFAULT_COVER_SLIDE_SETTINGS.playback,
  videoLoop: false,
  videoPresentation: 'background',
  pipSize: 'small',
  pipShape: 'square',
  pipPosition: 'bottom-right',
  dashboardLayout: DEFAULT_DASHBOARD_SETTINGS.layout,
  dashboardTitle: DEFAULT_DASHBOARD_SETTINGS.showTitle,
  dashboardStyle: DEFAULT_DASHBOARD_SETTINGS.style,
  proofing: DEFAULT_PROOF_SETTINGS.enabled,
  proofDialect: DEFAULT_PROOF_SETTINGS.dialect,
} as const;

/** Return `null` when a setting matches its runtime default so writers remove it. */
export function omitFrontmatterDefault<T extends string | number | boolean>(
  value: T,
  defaultValue: T,
): T | null {
  return value === defaultValue ? null : value;
}
