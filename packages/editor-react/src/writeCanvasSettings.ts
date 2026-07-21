import type { CSSProperties } from 'react';

/** Host-controlled typography for the markdown Write canvas. */
export interface WriteCanvasSettings {
  /** Base text size in CSS pixels. Headings continue to scale relative to it. */
  textSize?: number;
  /** Unitless line-height multiplier for body text. */
  lineSpacing?: number;
  /**
   * CSS `font-family` value for Write-canvas headings. Applies only when no
   * theme font override is active (the theme's title font always wins) — see
   * the heading rule in `styles/editor.css`. Omit to inherit as before.
   */
  headerFont?: string;
  /**
   * CSS `font-family` value for Write-canvas body text. Applies only when no
   * theme font override is active (the theme's body font always wins) — see
   * the editor rule in `styles/editor.css`. Omit to inherit as before.
   */
  bodyFont?: string;
}

type WriteCanvasCSSProperties = CSSProperties & {
  '--squisq-write-text-size'?: string;
  '--squisq-write-line-spacing'?: string;
  '--squisq-write-header-font'?: string;
  '--squisq-write-body-font'?: string;
};

/** Translate public Write-canvas settings into the CSS variables consumed by the editor. */
export function writeCanvasSettingsStyle(settings?: WriteCanvasSettings): WriteCanvasCSSProperties {
  const style: WriteCanvasCSSProperties = {};
  if (isPositiveFinite(settings?.textSize)) {
    style['--squisq-write-text-size'] = `${settings.textSize}px`;
  }
  if (isPositiveFinite(settings?.lineSpacing)) {
    style['--squisq-write-line-spacing'] = String(settings.lineSpacing);
  }
  const headerFont = safeFontFamily(settings?.headerFont);
  if (headerFont) {
    style['--squisq-write-header-font'] = headerFont;
  }
  const bodyFont = safeFontFamily(settings?.bodyFont);
  if (bodyFont) {
    style['--squisq-write-body-font'] = bodyFont;
  }
  return style;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Accept a host-provided CSS `font-family` value, or return undefined for
 * anything unusable. The value is only ever assigned to a custom property via
 * the inline `style` object, so it cannot terminate the declaration; we still
 * reject the characters that could break out of a declaration (plus control
 * characters) as defense in depth. Spaces, commas, hyphens and quotes are all
 * valid in a font-family value ("PT Serif", Georgia, serif / -apple-system).
 */
function safeFontFamily(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[;{}<>]/.test(trimmed)) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return undefined;
  return trimmed;
}
