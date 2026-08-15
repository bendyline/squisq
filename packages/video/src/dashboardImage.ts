/**
 * Dashboard image export presets and dimension helpers.
 *
 * Lives in @bendyline/squisq-video (browser-pure, depended on by both the
 * CLI and the browser export UI) so the `squisq image` command and the
 * DashboardImageExportModal share one resolution table and one validator.
 *
 * These are EXPORT resolutions (physical pixels), distinct from core's
 * `VIEWPORT_PRESETS` (virtual design-space viewports) — each preset names
 * the viewport family its aspect ratio implies so layouts pick the right
 * orientation variant. Validation follows the cover-image ruleset (whole
 * pixels, sane bounds, megapixel cap), NOT the H.264 even-dimension rule:
 * that constraint exists for yuv420p video encoding and has no meaning
 * for a PNG.
 */

import type { ViewportPreset } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';

export interface DashboardResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  /** The `VIEWPORT_PRESETS` family this aspect ratio implies. */
  family: ViewportPreset;
}

/** Named export resolutions offered by the CLI and the export dialog. */
export const DASHBOARD_RESOLUTIONS = [
  { id: 'hd', label: 'HD 1280×720', width: 1280, height: 720, family: 'landscape' },
  { id: 'fhd', label: 'Full HD 1920×1080', width: 1920, height: 1080, family: 'landscape' },
  { id: '4k', label: '4K UHD 3840×2160', width: 3840, height: 2160, family: 'landscape' },
  { id: 'square', label: 'Square 1080×1080', width: 1080, height: 1080, family: 'square' },
  { id: 'square-2k', label: 'Square 2160×2160', width: 2160, height: 2160, family: 'square' },
  { id: 'portrait', label: 'Portrait 1080×1920', width: 1080, height: 1920, family: 'portrait' },
  {
    id: 'portrait-4k',
    label: 'Portrait 4K 2160×3840',
    width: 2160,
    height: 3840,
    family: 'portrait',
  },
  { id: 'standard', label: '4:3 1440×1080', width: 1440, height: 1080, family: 'standard' },
] as const satisfies readonly DashboardResolutionPreset[];

export type DashboardResolutionId = (typeof DASHBOARD_RESOLUTIONS)[number]['id'];

export const DEFAULT_DASHBOARD_RESOLUTION: DashboardResolutionId = 'fhd';

/** Minimum edge length for a dashboard image, in pixels. */
export const MIN_DASHBOARD_IMAGE_DIMENSION = 64;
/** Maximum edge length for a dashboard image, in pixels (8K width). */
export const MAX_DASHBOARD_IMAGE_DIMENSION = 7680;
/** Maximum total pixels (4× the 1080p-based cover-image budget: 7680×4320). */
export const MAX_DASHBOARD_IMAGE_PIXELS = 33_177_600;

/**
 * Validate custom dashboard-image dimensions. Returns a human-readable
 * problem description, or null when the dimensions are acceptable.
 */
export function validateDashboardImageDimensions(width: number, height: number): string | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    return 'Width and height must be whole pixel counts.';
  }
  if (width < MIN_DASHBOARD_IMAGE_DIMENSION || height < MIN_DASHBOARD_IMAGE_DIMENSION) {
    return `Each dimension must be at least ${MIN_DASHBOARD_IMAGE_DIMENSION} pixels.`;
  }
  if (width > MAX_DASHBOARD_IMAGE_DIMENSION || height > MAX_DASHBOARD_IMAGE_DIMENSION) {
    return `Each dimension must be at most ${MAX_DASHBOARD_IMAGE_DIMENSION} pixels.`;
  }
  if (width * height > MAX_DASHBOARD_IMAGE_PIXELS) {
    return `The image may not exceed ${MAX_DASHBOARD_IMAGE_PIXELS.toLocaleString('en-US')} total pixels.`;
  }
  return null;
}

/**
 * The viewport family whose aspect ratio is nearest to `width`/`height` —
 * a uniform log-ratio comparison over all four `VIEWPORT_PRESETS`
 * families (core's `getViewportOrientation` has no 4:3 notion, so 1440×1080
 * would misreport as plain landscape there).
 */
export function dashboardFamilyForDimensions(width: number, height: number): ViewportPreset {
  const aspect = width / Math.max(1, height);
  let best: ViewportPreset = 'landscape';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const family of Object.keys(VIEWPORT_PRESETS) as ViewportPreset[]) {
    const preset = VIEWPORT_PRESETS[family];
    const distance = Math.abs(Math.log(aspect / (preset.width / preset.height)));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = family;
    }
  }
  return best;
}

export interface ResolveDashboardDimensionsInput {
  /** Named preset id (default {@link DEFAULT_DASHBOARD_RESOLUTION}). */
  resolution?: string;
  /** Custom width; requires `height` and excludes `resolution`. */
  width?: number;
  /** Custom height; requires `width` and excludes `resolution`. */
  height?: number;
}

export interface ResolvedDashboardDimensions {
  width: number;
  height: number;
  family: ViewportPreset;
}

/**
 * Resolve the export dimensions from a preset id or explicit pixels — the
 * single resolution-logic implementation shared by the programmatic API,
 * the `png` format, and the `squisq image` command. Throws `RangeError`
 * on contradictory or invalid input so callers fail before any expensive
 * rendering starts.
 */
export function resolveDashboardDimensions(
  input: ResolveDashboardDimensionsInput = {},
): ResolvedDashboardDimensions {
  const hasCustom = input.width !== undefined || input.height !== undefined;
  if (hasCustom && input.resolution !== undefined) {
    throw new RangeError('Pass either a resolution preset or custom width/height, not both.');
  }
  if (hasCustom) {
    if (input.width === undefined || input.height === undefined) {
      throw new RangeError('Custom dimensions require both width and height.');
    }
    const problem = validateDashboardImageDimensions(input.width, input.height);
    if (problem) throw new RangeError(problem);
    return {
      width: input.width,
      height: input.height,
      family: dashboardFamilyForDimensions(input.width, input.height),
    };
  }
  const id = input.resolution ?? DEFAULT_DASHBOARD_RESOLUTION;
  const preset = DASHBOARD_RESOLUTIONS.find((entry) => entry.id === id);
  if (!preset) {
    const known = DASHBOARD_RESOLUTIONS.map((entry) => entry.id).join(', ');
    throw new RangeError(`Unknown resolution preset "${id}". Valid presets: ${known}.`);
  }
  return { width: preset.width, height: preset.height, family: preset.family };
}
