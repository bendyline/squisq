/**
 * Self-contained styling for the teleprompter.
 *
 * Everything the prompter surface needs ships as one CSS string plus a
 * set of inline `--squisq-prompter-*` custom properties derived from the
 * doc Theme. The docked surface, a Document-PiP window, and a popup all
 * inject the SAME string, so the surface never depends on the host
 * page's cascade (the VideoExportModal self-theming strategy).
 */

import { resolveFontFamily, type Theme } from '@bendyline/squisq/schemas';

/** Inline CSS vars for the surface root, derived from the doc theme. */
export function prompterVarsFromTheme(theme: Theme): Record<string, string> {
  const colors = theme.colors;
  return {
    '--squisq-prompter-bg': colors.background,
    '--squisq-prompter-text': colors.text,
    '--squisq-prompter-muted': colors.textMuted ?? colors.text,
    '--squisq-prompter-accent': colors.primary,
    '--squisq-prompter-font': resolveFontFamily(
      theme.typography?.bodyFont,
      'system-ui, sans-serif',
    ),
  };
}

/** Marker attribute used to inject the style block exactly once per document. */
export const TELEPROMPTER_STYLE_ATTR = 'data-squisq-teleprompter';

/** Inject {@link TELEPROMPTER_CSS} into a document once (main doc or a float window). */
export function ensureTeleprompterStyles(doc: Document): void {
  if (doc.querySelector(`style[${TELEPROMPTER_STYLE_ATTR}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(TELEPROMPTER_STYLE_ATTR, '');
  style.textContent = TELEPROMPTER_CSS;
  doc.head.appendChild(style);
}

export const TELEPROMPTER_CSS = `
.squisq-teleprompter-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--squisq-bg, #f5f5f5);
  outline: none;
}
.squisq-teleprompter-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.squisq-teleprompter-surface {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--squisq-prompter-bg, #101014);
  color: var(--squisq-prompter-text, #f5f5f2);
  font-family: var(--squisq-prompter-font, system-ui, sans-serif);
  user-select: none;
}
.squisq-teleprompter-flip {
  position: absolute;
  inset: 0;
}
.squisq-teleprompter-surface--mirrored .squisq-teleprompter-flip {
  transform: scaleX(-1);
}
.squisq-teleprompter-scroll {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  will-change: transform;
  padding: 40vh 8% 60vh;
  box-sizing: border-box;
}
.squisq-teleprompter-line-guide {
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 2;
}
.squisq-teleprompter-line-guide::before,
.squisq-teleprompter-line-guide::after {
  content: '';
  position: absolute;
  top: 50%;
  border: 9px solid transparent;
  transform: translateY(-50%);
}
.squisq-teleprompter-line-guide::before {
  left: 6px;
  border-left-color: var(--squisq-prompter-accent, #e8b64c);
}
.squisq-teleprompter-line-guide::after {
  right: 6px;
  border-right-color: var(--squisq-prompter-accent, #e8b64c);
}
.squisq-teleprompter-guide-band {
  position: absolute;
  left: 0;
  right: 0;
  background: color-mix(in srgb, var(--squisq-prompter-accent, #e8b64c) 9%, transparent);
  pointer-events: none;
  z-index: 1;
}

.squisq-teleprompter-block-marker {
  display: block;
  margin: 1.1em 0 0.35em;
  font-size: 0.38em;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--squisq-prompter-muted, #9a9aa0);
  border-top: 1px solid color-mix(in srgb, var(--squisq-prompter-muted, #9a9aa0) 35%, transparent);
  padding-top: 0.6em;
}
.squisq-teleprompter-para {
  margin: 0 0 0.55em;
  line-height: 1.4;
  font-weight: 500;
}
.squisq-teleprompter-word {
  opacity: 0.45;
  transition: color 0.1s linear, opacity 0.1s linear;
}
.squisq-teleprompter-word--read {
  opacity: 0.9;
}
.squisq-teleprompter-word--active {
  opacity: 1;
  font-weight: 800;
  color: var(--squisq-prompter-accent, #e8b64c);
}

.squisq-teleprompter-countdown {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  background: color-mix(in srgb, var(--squisq-prompter-bg, #101014) 72%, transparent);
}
.squisq-teleprompter-countdown-digit {
  font-size: 18vmin;
  font-weight: 800;
  color: var(--squisq-prompter-accent, #e8b64c);
  animation: squisq-prompter-pulse 1s ease-in-out infinite;
}
.squisq-teleprompter-recdot {
  position: absolute;
  top: 14px;
  right: 16px;
  z-index: 4;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e5484d;
  box-shadow: 0 0 0 3px color-mix(in srgb, #e5484d 30%, transparent);
  animation: squisq-prompter-pulse 1.4s ease-in-out infinite;
}
/* Counter-flip overlays so they stay readable in mirror mode. */
.squisq-teleprompter-surface--mirrored .squisq-teleprompter-countdown,
.squisq-teleprompter-surface--mirrored .squisq-teleprompter-recdot {
  transform: scaleX(-1);
}

.squisq-teleprompter-selfview {
  position: absolute;
  right: 14px;
  bottom: 14px;
  width: 160px;
  border-radius: 8px;
  border: 2px solid color-mix(in srgb, #e5484d 60%, transparent);
  z-index: 5;
  background: #000;
}

.squisq-teleprompter-review {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--squisq-border, #e5e7eb);
  background: var(--squisq-surface, var(--squisq-bg, #fff));
  color: var(--squisq-text, #111827);
  font-size: 12.5px;
}
.squisq-teleprompter-review audio {
  height: 28px;
  max-width: 260px;
}
.squisq-teleprompter-review button {
  font: inherit;
  color: inherit;
  background: var(--squisq-input-bg, #fff);
  border: 1px solid var(--squisq-border, #d1d5db);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}

.squisq-teleprompter-float-note {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--squisq-text-muted, #6b7280);
  font-size: 14px;
}

.squisq-teleprompter-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--squisq-border, #e5e7eb);
  background: var(--squisq-surface, var(--squisq-bg, #fff));
  color: var(--squisq-text, #111827);
  font-size: 12.5px;
}
.squisq-teleprompter-controls .squisq-teleprompter-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.squisq-teleprompter-controls button {
  font: inherit;
  color: inherit;
  background: var(--squisq-input-bg, #fff);
  border: 1px solid var(--squisq-border, #d1d5db);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.squisq-teleprompter-controls button:hover {
  background: var(--squisq-surface-hover, #f3f4f6);
}
.squisq-teleprompter-controls button[aria-pressed='true'] {
  background: var(--squisq-text, #111827);
  color: var(--squisq-bg, #fff);
  border-color: var(--squisq-text, #111827);
}
.squisq-teleprompter-controls select,
.squisq-teleprompter-controls input[type='range'] {
  font: inherit;
  color: inherit;
  background: var(--squisq-input-bg, #fff);
  border: 1px solid var(--squisq-border, #d1d5db);
  border-radius: 6px;
  max-width: 170px;
}
.squisq-teleprompter-controls input[type='range'] {
  border: none;
  background: transparent;
  width: 110px;
}
.squisq-teleprompter-meter {
  position: relative;
  width: 64px;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--squisq-border, #e5e7eb);
}
.squisq-teleprompter-meter-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: #9ca3af;
  transition: width 0.08s linear;
}
.squisq-teleprompter-meter--voice .squisq-teleprompter-meter-fill {
  background: #30a46c;
}

@keyframes squisq-prompter-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .squisq-teleprompter-countdown-digit,
  .squisq-teleprompter-recdot {
    animation: none;
  }
  .squisq-teleprompter-word {
    transition: none;
  }
}
`;
