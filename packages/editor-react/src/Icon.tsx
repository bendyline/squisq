/**
 * Icon — renders a Font Awesome Free glyph via the webfont CSS that
 * `styles/index.css` imports (`@fortawesome/fontawesome-free`).
 *
 * Icons are decorative: the surrounding control owns the accessible
 * label (`aria-label` / `data-tooltip`), so the glyph is marked
 * `aria-hidden`. Sizing and color flow from the parent's `font-size`
 * and `color`, matching how the inline `{[icon]}` content nodes render
 * (see `InlineIcon.ts`).
 */

import type { CSSProperties } from 'react';

export interface IconProps {
  /** Full Font Awesome class string, e.g. `"fa-solid fa-bold"`. */
  icon: string;
  /** Extra class names appended after the Font Awesome classes. */
  className?: string;
  style?: CSSProperties;
}

export function Icon({ icon, className, style }: IconProps) {
  return (
    <i className={className ? `${icon} ${className}` : icon} style={style} aria-hidden="true" />
  );
}
