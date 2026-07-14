import type { CSSProperties } from 'react';

/** Host-controlled typography for the markdown Write canvas. */
export interface WriteCanvasSettings {
  /** Base text size in CSS pixels. Headings continue to scale relative to it. */
  textSize?: number;
  /** Unitless line-height multiplier for body text. */
  lineSpacing?: number;
}

type WriteCanvasCSSProperties = CSSProperties & {
  '--squisq-write-text-size'?: string;
  '--squisq-write-line-spacing'?: string;
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
  return style;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
