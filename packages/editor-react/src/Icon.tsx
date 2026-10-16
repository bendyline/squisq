/**
 * Icon — renders an editor-chrome glyph.
 *
 * Call sites name glyphs by Font Awesome class string (`"fa-solid fa-bold"`)
 * or by bare chrome glyph name (`"layout-template"`). A name with an entry in
 * {@link CHROME_ICONS} draws as a Lucide outline, so the chrome shares one icon
 * family at one stroke weight; anything else — brand marks, unmapped names —
 * falls back to the Font Awesome webfont that `styles/index.css` imports.
 *
 * Icons are decorative: the surrounding control owns the accessible
 * label (`aria-label` / `data-tooltip`), so the glyph is marked
 * `aria-hidden`. Sizing and color flow from the parent's `font-size`
 * and `color`, as they did for the webfont glyphs, so existing sizing rules
 * keep working (they match `.squisq-icon` alongside `i`).
 */

import type { CSSProperties } from 'react';
import { chromeIconFor } from './chromeIcons';

export interface IconProps {
  /** Font Awesome class string, e.g. `"fa-solid fa-bold"`, or a bare chrome glyph name. */
  icon: string;
  /** Extra class names appended after the glyph's own classes. */
  className?: string;
  style?: CSSProperties;
}

/** 1.75 on Lucide's 24px grid draws a ~1px line at the chrome's 13–16px sizes. */
const STROKE_WIDTH = 1.75;

export function Icon({ icon, className, style }: IconProps) {
  const Glyph = chromeIconFor(icon);
  if (Glyph) {
    return (
      <Glyph
        className={className ? `squisq-icon ${className}` : 'squisq-icon'}
        style={style}
        strokeWidth={STROKE_WIDTH}
        aria-hidden="true"
        focusable="false"
      />
    );
  }
  return (
    <i className={className ? `${icon} ${className}` : icon} style={style} aria-hidden="true" />
  );
}
