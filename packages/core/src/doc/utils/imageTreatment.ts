/**
 * Image treatment → CSS filter derivation.
 *
 * Treatments are theme-level photographic grades (see `ImageTreatment` in
 * [Doc.ts](../../schemas/Doc.ts)). They compile to plain CSS `filter`
 * functions so the same string works on a foreignObject `<img>`, an SVG
 * `<image>` element, and in headless frame capture — no SVG filter defs to
 * coordinate, no renderer-specific code paths.
 */

import type { ImageTreatment } from '../../schemas/Doc.js';
import { hexHueDegrees } from '../../schemas/colorUtils.js';

/** Sepia's intrinsic tint hue (deg) — duotone rotates from here to the target. */
const SEPIA_HUE_DEGREES = 40;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Build the CSS `filter` value for a treatment and/or blur.
 * Returns `undefined` when there is nothing to apply.
 */
export function cssFilterForTreatment(
  treatment?: ImageTreatment,
  blur?: number,
): string | undefined {
  const parts: string[] = [];

  if (blur != null && blur > 0) {
    parts.push(`blur(${Math.round(blur)}px)`);
  }

  if (treatment && treatment.type !== 'none') {
    const s = clamp01(treatment.strength ?? 0.6);
    switch (treatment.type) {
      case 'mono':
        // Archival black & white with a whisper of contrast to keep depth.
        parts.push(`grayscale(${r2(s)})`, `contrast(${r2(1 + 0.05 * s)})`);
        break;
      case 'duotone': {
        // Classic CSS duotone approximation: flatten to gray, tint through
        // sepia (intrinsic hue ~40°), rotate to the target hue, re-saturate.
        const hue = hexHueDegrees(treatment.color ?? '#3d5a80');
        parts.push(
          'grayscale(1)',
          `sepia(${r2(Math.max(0.35, s))})`,
          `hue-rotate(${Math.round(hue - SEPIA_HUE_DEGREES)}deg)`,
          `saturate(${r2(1 + s)})`,
        );
        break;
      }
      case 'warm':
        // Partial sepia is a well-behaved warmer; slight saturation lift.
        parts.push(`sepia(${r2(0.4 * s)})`, `saturate(${r2(1 + 0.15 * s)})`);
        break;
      case 'cool':
        // Desaturate a touch and nudge warm tones toward magenta/blue —
        // small rotations read as a grade, large ones wreck hues.
        parts.push(
          `saturate(${r2(1 - 0.25 * s)})`,
          `hue-rotate(${Math.round(-12 * s)}deg)`,
          `contrast(${r2(1 + 0.06 * s)})`,
        );
        break;
    }
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}
