import type { Doc, Theme } from '@bendyline/squisq/schemas';
import { resolveThemeForDoc } from '@bendyline/squisq/doc';
import type { PipPosition, PipShape, PipSize, VideoPresentation } from '../types.js';

export interface DocPlayerAppearanceOverrides {
  theme?: Theme;
  videoPresentation?: VideoPresentation;
  pipSize?: PipSize;
  pipShape?: PipShape;
  pipPosition?: PipPosition;
  showCoverSlide?: boolean;
}

export interface ResolvedDocPlayerAppearance {
  theme: Theme;
  videoPresentation: VideoPresentation;
  pipSize: PipSize;
  pipShape: PipShape;
  pipPosition: PipPosition;
  showCoverSlide: boolean;
}

function readFrontmatterSetting(
  frontmatter: Record<string, unknown> | undefined,
  canonical: string,
  legacy: string,
): unknown {
  if (!frontmatter) return undefined;
  return Object.prototype.hasOwnProperty.call(frontmatter, canonical)
    ? frontmatter[canonical]
    : frontmatter[legacy];
}

function resolveVideoPresentation(value: unknown): VideoPresentation | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'background' || normalized === 'behind') return 'background';
  if (normalized === 'full-frame' || normalized === 'fullscreen' || normalized === 'full') {
    return 'full-frame';
  }
  if (normalized === 'picture-in-picture' || normalized === 'pip' || normalized === 'overlay') {
    return 'picture-in-picture';
  }
  return undefined;
}

function resolvePipSize(value: unknown): PipSize | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'small' || normalized === 'sm' || normalized === 'pip-small') return 'small';
  if (
    normalized === 'large' ||
    normalized === 'lg' ||
    normalized === 'big' ||
    normalized === 'pip-large'
  ) {
    return 'large';
  }
  return undefined;
}

function resolvePipShape(value: unknown): PipShape | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'square' || normalized === '1:1') return 'square';
  if (normalized === 'wide' || normalized === '16:9' || normalized === 'widescreen') return 'wide';
  return undefined;
}

function resolvePipPosition(value: unknown): PipPosition | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  const aliases: Record<string, PipPosition> = {
    'top-left': 'top-left',
    'upper-left': 'top-left',
    'top-right': 'top-right',
    'upper-right': 'top-right',
    'bottom-left': 'bottom-left',
    'lower-left': 'bottom-left',
    'bottom-right': 'bottom-right',
    'lower-right': 'bottom-right',
  };
  return aliases[normalized];
}

function resolveBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === 'show' ||
    normalized === 'visible'
  ) {
    return true;
  }
  if (
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off' ||
    normalized === 'hide' ||
    normalized === 'hidden'
  ) {
    return false;
  }
  return undefined;
}

/** Resolve the visual settings a standalone/export player must inherit from its Doc. */
export function resolveDocPlayerAppearance(
  doc: Doc,
  overrides: DocPlayerAppearanceOverrides = {},
): ResolvedDocPlayerAppearance {
  const frontmatter = doc.frontmatter;
  return {
    theme: overrides.theme ?? resolveThemeForDoc(doc),
    videoPresentation:
      overrides.videoPresentation ??
      resolveVideoPresentation(
        readFrontmatterSetting(frontmatter, 'squisq-video-presentation', 'video-presentation'),
      ) ??
      'background',
    pipSize:
      overrides.pipSize ??
      resolvePipSize(readFrontmatterSetting(frontmatter, 'squisq-pip-size', 'pip-size')) ??
      'small',
    pipShape:
      overrides.pipShape ??
      resolvePipShape(readFrontmatterSetting(frontmatter, 'squisq-pip-shape', 'pip-shape')) ??
      'square',
    pipPosition:
      overrides.pipPosition ??
      resolvePipPosition(
        readFrontmatterSetting(frontmatter, 'squisq-pip-position', 'pip-position'),
      ) ??
      'bottom-right',
    showCoverSlide:
      overrides.showCoverSlide ??
      resolveBoolean(readFrontmatterSetting(frontmatter, 'squisq-cover-slide', 'cover-slide')) ??
      true,
  };
}
