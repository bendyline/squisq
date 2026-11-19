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
  gap: 8px 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--squisq-border, #e5e7eb);
  background: var(--squisq-surface, var(--squisq-bg, #fff));
  color: var(--squisq-text, #111827);
  font-family: var(--squisq-ux-font, inherit);
  font-size: 12.5px;
}
.squisq-teleprompter-review audio {
  height: 28px;
  max-width: 260px;
}

/* ── Tool buttons: icon + label, shared by the rail, review bar, float note ── */
.squisq-teleprompter-tool,
.squisq-teleprompter-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 11px;
  box-sizing: border-box;
  font: inherit;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  color: var(--squisq-text-soft, #374151);
  background: var(--squisq-input-bg, #fff);
  border: 1px solid var(--squisq-border, #d1d5db);
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.squisq-teleprompter-tool:hover,
.squisq-teleprompter-toggle:hover {
  background: var(--squisq-surface-hover, #f3f4f6);
  color: var(--squisq-text-strong, #111827);
}
.squisq-teleprompter-tool .squisq-icon,
.squisq-teleprompter-toggle .squisq-icon,
.squisq-teleprompter-controls .squisq-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.squisq-teleprompter-toggle[aria-pressed='true'],
.squisq-teleprompter-toggle[aria-pressed='true']:hover {
  background: var(--squisq-accent-soft, #e0e7ff);
  color: var(--squisq-accent-strong, #1d4ed8);
  border-color: var(--squisq-accent-border, #a5b4fc);
}
.squisq-teleprompter-tool--record .squisq-icon {
  color: #e5484d;
  fill: #e5484d;
}
.squisq-teleprompter-tool--stop .squisq-icon {
  fill: currentColor;
}
.squisq-teleprompter-tool--stop {
  color: var(--squisq-danger, #c2272d);
  border-color: color-mix(in srgb, var(--squisq-danger, #c2272d) 45%, transparent);
}
.squisq-teleprompter-tool--primary {
  background: var(--squisq-accent, #2563eb);
  border-color: var(--squisq-accent, #2563eb);
  color: var(--squisq-text-on-accent, #fff);
}
.squisq-teleprompter-tool--primary:hover {
  background: var(--squisq-accent-hover, var(--squisq-accent, #2563eb));
  color: var(--squisq-text-on-accent, #fff);
}
.squisq-teleprompter-tool:focus-visible,
.squisq-teleprompter-toggle:focus-visible,
.squisq-teleprompter-tab:focus-visible,
.squisq-teleprompter-controls select:focus-visible,
.squisq-teleprompter-controls input:focus-visible {
  outline: 2px solid var(--squisq-accent, #2563eb);
  outline-offset: 1px;
}

.squisq-teleprompter-float-note {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--squisq-text-muted, #4b5563);
  font-size: 14px;
}

/* ── Control rail ─────────────────────────────────────────────────────
   Toolbar row (playback, countdown, record, pop out) over three settings
   areas (Pacing, Microphone, Display). The rail is a size container: a
   wide rail lays the areas out as columns; a narrow one (phone, recorder
   dialog column) swaps them for a tab strip and shows one at a time. */
.squisq-teleprompter-controls {
  container: squisq-prompter-rail / inline-size;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--squisq-border, #e5e7eb);
  background: var(--squisq-surface, var(--squisq-bg, #fff));
  color: var(--squisq-text, #111827);
  font-family: var(--squisq-ux-font, inherit);
  font-size: 12.5px;
}

.squisq-teleprompter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 8px 12px;
}

/* Playback: Start/Pause and Restart as one connected segment. */
.squisq-teleprompter-seg,
.squisq-teleprompter-split {
  display: inline-flex;
  align-items: stretch;
  flex: 0 0 auto;
  border: 1px solid var(--squisq-border, #d1d5db);
  border-radius: 7px;
  overflow: hidden;
  background: var(--squisq-input-bg, #fff);
}
.squisq-teleprompter-seg > .squisq-teleprompter-tool,
.squisq-teleprompter-split > .squisq-teleprompter-tool {
  border: none;
  border-radius: 0;
  background: transparent;
}
.squisq-teleprompter-seg > .squisq-teleprompter-tool + .squisq-teleprompter-tool {
  border-left: 1px solid var(--squisq-border, #d1d5db);
}
.squisq-teleprompter-seg > .squisq-teleprompter-tool:hover,
.squisq-teleprompter-split > .squisq-teleprompter-tool:hover {
  background: var(--squisq-surface-hover, #f3f4f6);
}
.squisq-teleprompter-tool--play {
  min-width: 5.6em;
  color: var(--squisq-text-strong, #111827);
}
.squisq-teleprompter-tool--play .squisq-icon {
  color: var(--squisq-accent, #2563eb);
  fill: var(--squisq-accent, #2563eb);
}
.squisq-teleprompter-seg > .squisq-teleprompter-tool--play[data-rolling] {
  background: var(--squisq-accent-soft, #e0e7ff);
  color: var(--squisq-accent-strong, #1d4ed8);
}

.squisq-teleprompter-countdown-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--squisq-text-muted, #6b7280);
}
.squisq-teleprompter-bar-label {
  color: var(--squisq-text-soft, #374151);
}
.squisq-teleprompter-countdown-field select {
  color: var(--squisq-text, #111827);
}

.squisq-teleprompter-record {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.squisq-teleprompter-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--squisq-text-soft, #374151);
  cursor: pointer;
}
.squisq-teleprompter-check input {
  margin: 0;
  accent-color: var(--squisq-accent, #2563eb);
}

.squisq-teleprompter-float {
  display: inline-flex;
  margin-left: auto;
}
/* Pop out + window-type chooser: a split button whose chevron is a native
   select (so phones get the platform picker), invisible over the glyph. */
.squisq-teleprompter-split-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  border-left: 1px solid var(--squisq-border, #d1d5db);
  color: var(--squisq-text-muted, #6b7280);
}
.squisq-teleprompter-split-menu:hover {
  background: var(--squisq-surface-hover, #f3f4f6);
  color: var(--squisq-text-strong, #111827);
}
.squisq-teleprompter-controls .squisq-teleprompter-split-menu .squisq-icon {
  width: 13px;
  height: 13px;
  pointer-events: none;
}
.squisq-teleprompter-controls .squisq-teleprompter-split-menu select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  border: none;
  opacity: 0;
  cursor: pointer;
}
.squisq-teleprompter-split-menu:has(select:focus-visible) {
  outline: 2px solid var(--squisq-accent, #2563eb);
  outline-offset: -2px;
}

.squisq-teleprompter-controls select {
  min-height: 30px;
  max-width: 100%;
  padding: 0 6px;
  box-sizing: border-box;
  font: inherit;
  color: inherit;
  background: var(--squisq-input-bg, #fff);
  border: 1px solid var(--squisq-border, #d1d5db);
  border-radius: 7px;
}
.squisq-teleprompter-controls select:disabled {
  opacity: 0.6;
}

/* Settings tab strip: narrow rails only (see the container query below). */
.squisq-teleprompter-tabs {
  display: none;
}

.squisq-teleprompter-sections {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid var(--squisq-border-subtle, #eef0f3);
}
.squisq-teleprompter-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 9px 14px 11px;
}
.squisq-teleprompter-section + .squisq-teleprompter-section {
  border-left: 1px solid var(--squisq-border-subtle, #eef0f3);
}
.squisq-teleprompter-section-title {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--squisq-text-muted, #6b7280);
}
.squisq-teleprompter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  min-width: 0;
}
.squisq-teleprompter-row-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  color: var(--squisq-text-soft, #374151);
}
.squisq-teleprompter-row-label .squisq-icon {
  color: var(--squisq-text-muted, #6b7280);
}
.squisq-teleprompter-value {
  min-width: 4.4em;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--squisq-text-soft, #374151);
}
.squisq-teleprompter-hint {
  font-size: 11.5px;
  color: var(--squisq-text-muted, #6b7280);
}
.squisq-teleprompter-warning {
  font-size: 11.5px;
  color: var(--squisq-danger, #c2272d);
}
.squisq-teleprompter-mic-select {
  flex: 1 1 8em;
  min-width: 0;
}

/* Sliders: one look on every platform, filled to the value with the accent.
   --squisq-range-pct is set inline by the control. */
.squisq-teleprompter-controls input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  flex: 1 1 72px;
  min-width: 56px;
  height: 22px;
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
}
.squisq-teleprompter-controls input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    var(--squisq-accent, #2563eb) 0 var(--squisq-range-pct, 50%),
    var(--squisq-border, #d1d5db) var(--squisq-range-pct, 50%) 100%
  );
}
.squisq-teleprompter-controls input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border-radius: 50%;
  box-sizing: border-box;
  background: var(--squisq-input-bg, #fff);
  border: 2px solid var(--squisq-accent, #2563eb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
.squisq-teleprompter-controls input[type='range']::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--squisq-border, #d1d5db);
}
.squisq-teleprompter-controls input[type='range']::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: var(--squisq-accent, #2563eb);
}
.squisq-teleprompter-controls input[type='range']::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--squisq-input-bg, #fff);
  border: 2px solid var(--squisq-accent, #2563eb);
}

.squisq-teleprompter-meter {
  position: relative;
  flex: 0 0 56px;
  width: 56px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--squisq-border, #e5e7eb);
}
.squisq-teleprompter-meter-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: #9ca3af;
  transition: width 0.08s linear;
}
/* With no microphone picker, the meter spans the row like the sliders below. */
.squisq-teleprompter-meter--wide {
  flex: 1 1 auto;
  width: auto;
}
.squisq-teleprompter-meter--voice .squisq-teleprompter-meter-fill {
  background: #30a46c;
}

/* ── Narrow rail: one settings area at a time behind a tab strip ──
   Labels that collapse to their icon stay in the accessibility tree
   (visually hidden, never display: none) so they keep naming the control. */
@container squisq-prompter-rail (max-width: 679px) {
  .squisq-teleprompter-bar {
    gap: 8px 6px;
    padding: 8px 10px;
  }
  .squisq-teleprompter-countdown-field {
    gap: 4px;
  }
  /* Playback, countdown, and Pop out share the first line; Record (and its
     camera toggle and size note) takes a line of its own beneath them. */
  .squisq-teleprompter-record {
    order: 1;
    flex-basis: 100%;
  }
  .squisq-teleprompter-bar-label,
  .squisq-teleprompter-float .squisq-teleprompter-tool-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .squisq-teleprompter-tabs {
    display: flex;
    padding: 0 8px;
    border-top: 1px solid var(--squisq-border-subtle, #eef0f3);
  }
  .squisq-teleprompter-tab {
    flex: 1 1 0;
    appearance: none;
    margin: 0;
    padding: 8px 4px 6px;
    font: inherit;
    font-weight: 500;
    color: var(--squisq-text-muted, #6b7280);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .squisq-teleprompter-tab:hover {
    color: var(--squisq-text-strong, #111827);
  }
  .squisq-teleprompter-tab[aria-pressed='true'] {
    color: var(--squisq-text-strong, #111827);
    border-bottom-color: var(--squisq-accent, #2563eb);
  }
  .squisq-teleprompter-sections {
    display: block;
  }
  .squisq-teleprompter-section {
    display: none;
    padding: 10px 12px 12px;
  }
  .squisq-teleprompter-section + .squisq-teleprompter-section {
    border-left: none;
  }
  .squisq-teleprompter-sections[data-active-section='pacing'] > [data-section='pacing'],
  .squisq-teleprompter-sections[data-active-section='mic'] > [data-section='mic'],
  .squisq-teleprompter-sections[data-active-section='display'] > [data-section='display'] {
    display: flex;
  }
  .squisq-teleprompter-section-title {
    display: none;
  }
}
@container squisq-prompter-rail (max-width: 339px) {
  .squisq-teleprompter-tool--restart .squisq-teleprompter-tool-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

/* Touch: finger-sized targets. */
@media (pointer: coarse) {
  .squisq-teleprompter-tool,
  .squisq-teleprompter-toggle,
  .squisq-teleprompter-controls select {
    min-height: 36px;
  }
  .squisq-teleprompter-tab {
    padding: 10px 4px 8px;
  }
  .squisq-teleprompter-controls input[type='range'] {
    height: 30px;
  }
  .squisq-teleprompter-controls input[type='range']::-webkit-slider-thumb {
    width: 22px;
    height: 22px;
    margin-top: -9px;
  }
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
