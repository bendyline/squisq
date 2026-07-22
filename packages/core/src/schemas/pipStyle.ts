/**
 * Theme-driven picture-in-picture framing.
 *
 * {@link pipStyleVars} turns a {@link Theme} into the CSS custom properties the
 * player's PiP stylesheet consumes, so scheduled presenter video is framed to
 * match the theme (border, shadow, corner radius). An explicit
 * `theme.style.pip` wins; anything it omits is derived from the palette and the
 * theme's card border-radius, so every theme — including ones with no `pip`
 * block — gets a fitting PiP. Pure: no DOM, deterministic.
 */

import type { Theme } from './Theme.js';
import { withAlpha } from './colorUtils.js';

/** CSS custom properties that style the picture-in-picture frame. */
export interface PipStyleVars {
  /** `border-radius` of the frame. */
  '--squisq-pip-radius': string;
  /** Full `border` shorthand, or `'none'`. */
  '--squisq-pip-border': string;
  /** Full `box-shadow`, or `'none'`. */
  '--squisq-pip-shadow': string;
}

/** Soft neutral shadow used when a theme doesn't specify one. */
const DEFAULT_SHADOW = '0 0.75em 2em rgba(0, 0, 0, 0.34)';
/** Border width used for the derived rim (scales gently with the viewport). */
const DERIVED_BORDER_WIDTH = 'max(1px, 0.12vw)';

function cssLength(value: number | string): string {
  return typeof value === 'number' ? `${value}px` : value;
}

function resolveRadius(theme: Theme): string {
  const explicit = theme.style.pip?.cornerRadius;
  if (explicit != null) {
    if (typeof explicit === 'number') return explicit <= 0 ? '0' : `${explicit}px`;
    return explicit;
  }
  // Derive from the theme's card border-radius (px): 0 stays square, otherwise a
  // proportional percentage capped short of a full circle.
  const br = theme.style.borderRadius ?? 0;
  if (br <= 0) return '0';
  return `${Math.min(28, Math.max(6, Math.round(br)))}%`;
}

function resolveBorder(theme: Theme): string {
  const border = theme.style.pip?.border;
  if (border === 'none') return 'none';
  if (border && typeof border === 'object') {
    const width = border.width == null ? DERIVED_BORDER_WIDTH : cssLength(border.width);
    const color = border.color ?? withAlpha(theme.colors.text, 0.35);
    return `${width} solid ${color}`;
  }
  // Derived: a subtle rim in the theme's text color — light on dark themes,
  // dark on light themes — so it reads as a deliberate frame either way.
  return `${DERIVED_BORDER_WIDTH} solid ${withAlpha(theme.colors.text, 0.35)}`;
}

function resolveShadow(theme: Theme): string {
  const shadow = theme.style.pip?.shadow;
  if (shadow === false || shadow === 'none') return 'none';
  if (typeof shadow === 'string') return shadow;
  return DEFAULT_SHADOW;
}

/**
 * Derive the CSS custom properties that frame scheduled picture-in-picture
 * video for `theme`. An explicit `theme.style.pip` wins field-by-field; the
 * rest is derived from the palette and border-radius.
 */
export function pipStyleVars(theme: Theme): PipStyleVars {
  return {
    '--squisq-pip-radius': resolveRadius(theme),
    '--squisq-pip-border': resolveBorder(theme),
    '--squisq-pip-shadow': resolveShadow(theme),
  };
}
