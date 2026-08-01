/**
 * Page CSS — the single source of truth for Page (linear) mode styling.
 *
 * `PAGE_BASE_CSS` is structural and theme-independent: every color, font,
 * and dimension flows through `--squisq-page-*` custom properties
 * (`buildPageCssVars`) and the token data-attributes the renderer stamps on
 * the `.squisq-page` wrapper (`pageStyleDataAttributes`). One stylesheet
 * therefore serves all themes and all design families — a theme changes the
 * page's look purely through vars + data attributes, never through
 * generated CSS.
 *
 * Consumers:
 * - React `LinearDocView` injects `<style data-squisq-page>` with
 *   `PAGE_BASE_CSS` and sets the vars inline (self-contained — no CSS
 *   import needed, which keeps the standalone bundle and single-file HTML
 *   exports working).
 * - A string-HTML exporter can call `buildPageCss(theme)` for the same
 *   bytes plus a `.squisq-page { … }` var block.
 *
 * Responsive behavior uses container queries against the scroll container
 * (named `squisq-page`), with a media-query fallback for engines without
 * container support.
 */

import type { Theme } from '../schemas/Theme.js';
import type { ThemePageStyle } from '../schemas/PageStyle.js';
import { resolveFontFamily } from '../schemas/fontStacks.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { resolvePageStyle } from './page/materializePageSection.js';

/** Subtle noise texture (tiny inline SVG) for the `noise` page pattern. */
const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E\")";

/**
 * Custom-property values for a theme's page rendition. Set these inline on
 * the `.squisq-page` wrapper (React) or in a `.squisq-page { … }` rule
 * (string export). Per-section accent vars (`--squisq-page-accent*`) get
 * page-level defaults here and are overridden per section by the renderer.
 */
export function buildPageCssVars(
  theme?: Theme,
  pageStyle?: ThemePageStyle,
): Record<string, string> {
  const t = theme ?? DEFAULT_THEME;
  const style = pageStyle ?? resolvePageStyle(t);
  const colors = t.colors;
  const typography = t.typography;
  return {
    '--squisq-page-bg': colors.background,
    '--squisq-page-bg-alt': colors.backgroundLight,
    '--squisq-page-text': colors.text,
    '--squisq-page-text-muted': colors.textMuted,
    '--squisq-page-primary': colors.primary,
    '--squisq-page-secondary': colors.secondary,
    '--squisq-page-highlight': colors.highlight,
    '--squisq-page-title-font': resolveFontFamily(typography.titleFont, 'Georgia, serif'),
    '--squisq-page-body-font': resolveFontFamily(typography.bodyFont, 'system-ui, sans-serif'),
    '--squisq-page-mono-font': resolveFontFamily(
      typography.monoFont,
      'ui-monospace, SFMono-Regular, Menlo, monospace',
    ),
    '--squisq-page-line-height': String(typography.lineHeight ?? 1.65),
    '--squisq-page-title-weight': typography.titleWeight === 'normal' ? '400' : '700',
    '--squisq-page-content-max': `${style.tokens.contentMaxWidth}px`,
    '--squisq-page-wide-max': `${style.tokens.wideMaxWidth}px`,
    '--squisq-page-radius': `${style.tokens.cornerRadius}px`,
    // Per-section accent defaults; the renderer overrides these per section.
    '--squisq-page-accent': colors.primary,
    '--squisq-page-accent-bg': colors.backgroundLight,
    '--squisq-page-accent-text': colors.text,
  };
}

/**
 * The token data-attributes the renderer stamps on `.squisq-page` so the
 * structural CSS can branch per design decision. Shared by React and any
 * string exporter so both emit identical markup.
 */
export function pageStyleDataAttributes(pageStyle: ThemePageStyle): Record<string, string> {
  const tokens = pageStyle.tokens;
  const attrs: Record<string, string> = {
    'data-family': pageStyle.family,
    'data-spacing': tokens.sectionSpacing,
    'data-divider': tokens.divider,
    'data-rhythm': tokens.backgroundRhythm,
    'data-hero-style': tokens.heroStyle,
    'data-eyebrow': tokens.headingTreatment.eyebrow,
    'data-heading-scale': tokens.headingTreatment.scale,
    'data-framing': tokens.imageFraming,
    'data-shadow': tokens.shadow,
    'data-quote-mark': tokens.quoteMark,
    'data-numerals': tokens.numeralStyle,
  };
  if (tokens.headingTreatment.case && tokens.headingTreatment.case !== 'none') {
    attrs['data-heading-case'] = tokens.headingTreatment.case;
  }
  if (tokens.headingTreatment.underline && tokens.headingTreatment.underline !== 'none') {
    attrs['data-underline'] = tokens.headingTreatment.underline;
  }
  if (tokens.pattern && tokens.pattern !== 'none') {
    attrs['data-pattern'] = tokens.pattern;
  }
  return attrs;
}

/** Shared responsive collapse rules (referenced from both query forms). */
const NARROW_RULES = `
.squisq-page-hero-grid { grid-template-columns: 1fr; gap: 1.5rem; }
.squisq-page-feature { grid-template-columns: 1fr; }
.squisq-page-feature--media-right .squisq-page-feature-media { order: 0; }
.squisq-page-stats { flex-direction: column; gap: 1.75rem; }
.squisq-page-cards { grid-template-columns: 1fr; }
.squisq-page-gallery { grid-template-columns: repeat(2, 1fr); }
.squisq-page-milestone { grid-template-columns: 1fr; gap: 0.5rem; }
.squisq-page-milestone-rail { display: none; }
.squisq-page-section-inner { padding-inline: 18px; }
`;

/**
 * Structural, theme-independent stylesheet for the page rendition.
 * Everything is scoped under `.squisq-page`.
 */
export const PAGE_BASE_CSS = `
/* ── Base ─────────────────────────────────────────────────────────── */
.squisq-page {
  background: var(--squisq-page-bg);
  color: var(--squisq-page-text);
  font-family: var(--squisq-page-body-font);
  line-height: var(--squisq-page-line-height);
  --squisq-page-divider-color: color-mix(in srgb, var(--squisq-page-text) 16%, transparent);
  --squisq-page-section-pad: 3.5rem;
  --squisq-page-shadow: none;
}
.squisq-page *, .squisq-page *::before, .squisq-page *::after { box-sizing: border-box; }
.squisq-page img { max-width: 100%; height: auto; }
.squisq-page a {
  color: var(--squisq-page-primary);
  text-decoration-color: color-mix(in srgb, var(--squisq-page-primary) 40%, transparent);
}

/* Page pattern washes (very low intensity) */
.squisq-page[data-pattern='dots'] {
  background-image: radial-gradient(color-mix(in srgb, var(--squisq-page-text) 7%, transparent) 1px, transparent 1px);
  background-size: 22px 22px;
}
.squisq-page[data-pattern='grid'] {
  background-image:
    linear-gradient(color-mix(in srgb, var(--squisq-page-primary) 7%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--squisq-page-primary) 7%, transparent) 1px, transparent 1px);
  background-size: 44px 44px;
}
.squisq-page[data-pattern='diagonal'] {
  background-image: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--squisq-page-text) 4%, transparent) 0 1px,
    transparent 1px 14px
  );
}
.squisq-page[data-pattern='noise'] { background-image: ${NOISE_DATA_URI}; }

/* Spacing scale */
.squisq-page[data-spacing='compact'] { --squisq-page-section-pad: 2.25rem; }
.squisq-page[data-spacing='comfortable'] { --squisq-page-section-pad: 3.5rem; }
.squisq-page[data-spacing='generous'] { --squisq-page-section-pad: 5.25rem; }

/* Shadow language */
.squisq-page[data-shadow='soft'] { --squisq-page-shadow: 0 14px 36px color-mix(in srgb, var(--squisq-page-text) 14%, transparent); }
.squisq-page[data-shadow='crisp'] { --squisq-page-shadow: 0 2px 10px color-mix(in srgb, var(--squisq-page-text) 26%, transparent); }
.squisq-page[data-shadow='heavy'] { --squisq-page-shadow: 10px 10px 0 color-mix(in srgb, var(--squisq-page-text) 82%, transparent); }

/* ── Sections ─────────────────────────────────────────────────────── */
.squisq-page-section { position: relative; padding-block: var(--squisq-page-section-pad); }
.squisq-page-section-inner {
  max-width: var(--squisq-page-content-max);
  margin-inline: auto;
  padding-inline: 24px;
}
/* Backdrops anchor to the section; these content roots stack above them. */
.squisq-page-hero-body,
.squisq-page-banner-body,
.squisq-page-quote-figure { position: relative; }
.squisq-page-section--feature-split .squisq-page-section-inner,
.squisq-page-section--gallery .squisq-page-section-inner,
.squisq-page-section--table-section .squisq-page-section-inner,
.squisq-page-section--canvas-embed .squisq-page-section-inner,
.squisq-page-section--stat-band .squisq-page-section-inner,
.squisq-page-section--card-grid .squisq-page-section-inner,
.squisq-page-section--media-figure .squisq-page-section-inner,
.squisq-page-section--hero .squisq-page-section-inner {
  max-width: var(--squisq-page-wide-max);
}

/* Background rhythm */
.squisq-page-section--bg-alternate { background: var(--squisq-page-bg-alt); }
.squisq-page-section--bg-accent {
  background: var(--squisq-page-accent-bg);
  color: var(--squisq-page-accent-text);
}
.squisq-page-section--bg-media { color: #ffffff; }

/* Dividers between adjacent sections */
.squisq-page[data-divider='hairline'] .squisq-page-section + .squisq-page-section { border-top: 1px solid var(--squisq-page-divider-color); }
.squisq-page[data-divider='thick-rule'] .squisq-page-section + .squisq-page-section { border-top: 3px solid var(--squisq-page-primary); }
.squisq-page[data-divider='double-rule'] .squisq-page-section + .squisq-page-section { border-top: 4px double var(--squisq-page-divider-color); }
.squisq-page[data-divider='dotted'] .squisq-page-section + .squisq-page-section { border-top: 2px dotted var(--squisq-page-divider-color); }
/* Banded sections carry their own edges; media sections never need rules. */
.squisq-page .squisq-page-section--bg-media,
.squisq-page .squisq-page-section--bg-media + .squisq-page-section,
.squisq-page .squisq-page-section--timeline-rail + .squisq-page-section--timeline-rail { border-top: none; }

/* ── Headings, eyebrows ───────────────────────────────────────────── */
.squisq-page-section-title {
  font-family: var(--squisq-page-title-font);
  font-weight: var(--squisq-page-title-weight);
  line-height: 1.15;
  margin: 0 0 0.5em;
}
.squisq-page[data-heading-case='uppercase'] .squisq-page-section-title { text-transform: uppercase; letter-spacing: 0.03em; }
.squisq-page[data-underline='accent-bar'] .squisq-page-section-title::after {
  content: '';
  display: block;
  width: 56px;
  height: 4px;
  margin-top: 0.4em;
  border-radius: 2px;
  background: var(--squisq-page-accent);
}
.squisq-page[data-underline='full-rule'] .squisq-page-section-title {
  border-bottom: 1px solid var(--squisq-page-divider-color);
  padding-bottom: 0.35em;
}

.squisq-page-eyebrow {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--squisq-page-accent);
  margin: 0 0 0.9em;
}
.squisq-page[data-eyebrow='numbered'] .squisq-page-eyebrow::after { content: ' —'; color: var(--squisq-page-text-muted); }
.squisq-page[data-eyebrow='mono-tag'] .squisq-page-eyebrow {
  display: inline-block;
  font-family: var(--squisq-page-mono-font);
  text-transform: none;
  letter-spacing: 0.06em;
  border: 1px solid color-mix(in srgb, var(--squisq-page-accent) 55%, transparent);
  border-radius: var(--squisq-page-radius);
  padding: 0.15em 0.6em;
  background: color-mix(in srgb, var(--squisq-page-accent) 10%, transparent);
}
.squisq-page[data-eyebrow='mono-tag'] .squisq-page-eyebrow::before { content: '['; opacity: 0.6; }
.squisq-page[data-eyebrow='mono-tag'] .squisq-page-eyebrow::after { content: ']'; opacity: 0.6; }

/* ── Hero ─────────────────────────────────────────────────────────── */
.squisq-page-section--hero { padding-block: calc(var(--squisq-page-section-pad) * 1.5); }
.squisq-page-hero-title {
  font-family: var(--squisq-page-title-font);
  font-weight: var(--squisq-page-title-weight);
  line-height: 1.08;
  margin: 0;
  font-size: 2.75rem;
}
.squisq-page[data-heading-scale='display'] .squisq-page-hero-title { font-size: 3.4rem; }
.squisq-page[data-heading-scale='oversized'] .squisq-page-hero-title { font-size: 4rem; font-size: clamp(3rem, 9cqw, 6rem); line-height: 1.02; }
.squisq-page[data-heading-case='uppercase'] .squisq-page-hero-title { text-transform: uppercase; letter-spacing: 0.02em; }
.squisq-page-hero-subtitle {
  margin: 1.1em 0 0;
  font-size: 1.25rem;
  color: var(--squisq-page-text-muted);
  max-width: 42em;
  white-space: pre-line;
}
.squisq-page-section--bg-media .squisq-page-hero-subtitle { color: rgba(255, 255, 255, 0.88); }

/* Stacked (default): centered column */
.squisq-page[data-hero-style='stacked'] .squisq-page-hero-body { text-align: center; }
.squisq-page[data-hero-style='stacked'] .squisq-page-hero-subtitle { margin-inline: auto; }

/* Oversized type: hard left, no decoration */
.squisq-page[data-hero-style='oversized-type'] .squisq-page-hero-title { font-size: 4.25rem; font-size: clamp(3.25rem, 10cqw, 6.5rem); line-height: 0.98; }

/* Split: text and media side by side */
.squisq-page-hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; align-items: center; }
.squisq-page-hero-grid .squisq-page-hero-media img { width: 100%; object-fit: cover; }

/* Full-bleed & letterbox: media behind text */
.squisq-page-section--hero-media {
  padding-block: 0;
  min-height: min(72svh, 620px);
  display: flex;
  align-items: flex-end;
}
.squisq-page[data-hero-style='letterbox'] .squisq-page-section--hero-media { min-height: min(52svh, 460px); }
.squisq-page-hero-backdrop { position: absolute; inset: 0; overflow: hidden; }
.squisq-page-hero-backdrop img { width: 100%; height: 100%; object-fit: cover; }
.squisq-page-hero-backdrop::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.1) 30%, rgba(0, 0, 0, 0.68) 100%);
}
.squisq-page[data-hero-style='letterbox'] .squisq-page-hero-backdrop img { filter: saturate(0.9); }
.squisq-page-section--hero-media .squisq-page-section-inner { padding-block: 3rem; width: 100%; }

/* ── Banner (sectionHeader) ───────────────────────────────────────── */
.squisq-page-banner-title { font-size: 2rem; }
.squisq-page[data-heading-scale='display'] .squisq-page-banner-title { font-size: 2.5rem; }
.squisq-page[data-heading-scale='oversized'] .squisq-page-banner-title { font-size: 3rem; font-size: clamp(2.25rem, 6cqw, 3.75rem); }
.squisq-page-section--banner.squisq-page-section--bg-media { padding-block: 0; min-height: 280px; display: flex; align-items: flex-end; }
.squisq-page-section--banner.squisq-page-section--bg-media .squisq-page-section-inner { padding-block: 2rem; width: 100%; }
.squisq-page-section--banner .squisq-page-section-title { margin-bottom: 0; }

/* ── Stat band ────────────────────────────────────────────────────── */
.squisq-page-stats { display: flex; gap: 3rem; justify-content: center; text-align: center; flex-wrap: wrap; }
.squisq-page-stat { flex: 1 1 220px; max-width: 420px; }
.squisq-page-stat-value {
  display: block;
  font-family: var(--squisq-page-title-font);
  font-weight: 700;
  font-size: 3.25rem;
  line-height: 1;
  color: var(--squisq-page-accent);
}
.squisq-page[data-numerals='oversized'] .squisq-page-stat-value { font-size: 4.5rem; font-size: clamp(3.5rem, 8cqw, 5.5rem); }
.squisq-page[data-numerals='mono'] .squisq-page-stat-value { font-family: var(--squisq-page-mono-font); letter-spacing: -0.02em; }
.squisq-page[data-numerals='boxed'] .squisq-page-stat-value {
  display: inline-block;
  border: 2px solid var(--squisq-page-accent);
  border-radius: var(--squisq-page-radius);
  padding: 0.18em 0.4em;
}
.squisq-page-stat-title { display: block; margin-top: 0.9em; font-size: 1.125rem; font-weight: 600; }
.squisq-page-stat-body { display: block; margin-top: 0.45em; color: var(--squisq-page-text-muted); font-size: 0.95rem; }
.squisq-page-stat-meta { text-align: center; margin-top: 1.5rem; color: var(--squisq-page-text-muted); font-size: 0.85rem; }
.squisq-page-stat-bar { height: 10px; border-radius: 999px; background: var(--squisq-page-accent); margin-top: 0.8em; }
.squisq-page-stat--bars { text-align: left; }

/* ── Quote band ───────────────────────────────────────────────────── */
.squisq-page-quote {
  margin: 0;
  font-family: var(--squisq-page-title-font);
  font-size: 1.6rem;
  line-height: 1.35;
  white-space: pre-line;
}
.squisq-page-section--em-strong .squisq-page-quote { font-size: 2.1rem; }
.squisq-page-section--em-quiet .squisq-page-quote { font-size: 1.25rem; color: var(--squisq-page-text-muted); }
.squisq-page-quote-attribution { margin-top: 1.1em; font-family: var(--squisq-page-body-font); font-size: 0.95rem; color: var(--squisq-page-text-muted); }
.squisq-page-quote-attribution::before { content: '— '; }
.squisq-page[data-quote-mark='accent-bar'] .squisq-page-quote-figure { border-left: 4px solid var(--squisq-page-accent); padding-left: 1.5rem; }
.squisq-page[data-quote-mark='oversized-glyph'] .squisq-page-quote-figure { position: relative; padding-top: 1.25rem; }
.squisq-page[data-quote-mark='oversized-glyph'] .squisq-page-quote-figure::before {
  content: '\\201C';
  position: absolute;
  top: -0.12em;
  left: -0.05em;
  font-family: var(--squisq-page-title-font);
  font-size: 5.5rem;
  line-height: 1;
  color: color-mix(in srgb, var(--squisq-page-accent) 42%, transparent);
  pointer-events: none;
}
.squisq-page-section--v-display .squisq-page-quote-figure { text-align: center; border-left: none; }
.squisq-page-section--v-display .squisq-page-quote { font-size: 2.4rem; font-size: clamp(1.9rem, 5cqw, 3rem); }
.squisq-page-section--v-editorial .squisq-page-quote-figure {
  border-block: 3px solid var(--squisq-page-primary);
  border-left: none;
  padding: 2rem 0.5rem;
}
/* Full-bleed quote over media */
.squisq-page-section--quote-band.squisq-page-section--bg-media { padding-block: 0; min-height: 380px; display: flex; align-items: center; }
.squisq-page-section--quote-band.squisq-page-section--bg-media .squisq-page-section-inner { padding-block: 3.5rem; }
.squisq-page-quote-backdrop { position: absolute; inset: 0; overflow: hidden; }
.squisq-page-quote-backdrop img, .squisq-page-quote-backdrop video { width: 100%; height: 100%; object-fit: cover; }
.squisq-page-quote-backdrop::after { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.55); }
.squisq-page-section--quote-band[data-hint-vignette] .squisq-page-quote-backdrop::after {
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.75) 100%);
}
.squisq-page-section--quote-band.squisq-page-section--bg-media .squisq-page-quote-figure { border: none; text-align: center; }

/* ── Feature split ────────────────────────────────────────────────── */
.squisq-page-feature { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; align-items: center; }
.squisq-page-feature--media-right .squisq-page-feature-media { order: 2; }
.squisq-page-feature-media img { width: 100%; object-fit: cover; }
.squisq-page-feature-title { font-size: 1.75rem; }
.squisq-page-feature-body { color: var(--squisq-page-text-muted); font-size: 1.05rem; white-space: pre-line; margin: 0; }

/* ── Media figure ─────────────────────────────────────────────────── */
.squisq-page-figure { margin: 0; }
.squisq-page-figure img, .squisq-page-figure video { width: 100%; display: block; }
.squisq-page-figure figcaption { margin-top: 0.9em; font-size: 0.9rem; color: var(--squisq-page-text-muted); text-align: center; }
.squisq-page-media-credit { font-size: 0.78rem; opacity: 0.75; }

/* Media frame treatment (figures, features, gallery tiles, cards) */
.squisq-page-media-frame { overflow: hidden; }
.squisq-page[data-framing='rounded'] .squisq-page-media-frame { border-radius: var(--squisq-page-radius); }
.squisq-page[data-framing='bordered'] .squisq-page-media-frame { border: 3px solid var(--squisq-page-text); }
.squisq-page[data-framing='polaroid'] .squisq-page-media-frame {
  background: #ffffff;
  padding: 10px 10px 16px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 2px;
}
.squisq-page[data-framing='letterboxed'] .squisq-page-media-frame img { aspect-ratio: 21 / 9; object-fit: cover; }
.squisq-page[data-framing='circle-accent'] .squisq-page-media-frame { border-radius: calc(var(--squisq-page-radius) * 2); }
.squisq-page .squisq-page-media-frame { box-shadow: var(--squisq-page-shadow); }

/* Rich body nodes that the selected template did not consume. This universal
 * supplement keeps diagrams/media visible without making every template
 * duplicate the same preservation logic. */
.squisq-page-rich-content {
  margin-top: clamp(1.5rem, 4vw, 3rem);
  padding-top: clamp(1.25rem, 3vw, 2rem);
  border-top: 1px solid var(--squisq-page-divider-color);
}
.squisq-page-rich-content :is(img, video) { display: block; max-width: 100%; height: auto; margin-inline: auto; }
.squisq-page-rich-content .squisq-md-mermaid { min-height: min(520px, 62vh); margin-block: 0; }

/* ── Gallery ──────────────────────────────────────────────────────── */
.squisq-page-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; }
.squisq-page-gallery .squisq-page-media-frame img { width: 100%; height: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.squisq-page-gallery-caption { margin-top: 1.1rem; text-align: center; font-size: 0.9rem; color: var(--squisq-page-text-muted); }

/* ── Callout ──────────────────────────────────────────────────────── */
.squisq-page-callout {
  border-radius: var(--squisq-page-radius);
  border: 1px solid color-mix(in srgb, var(--squisq-page-accent) 32%, transparent);
  border-left: 5px solid var(--squisq-page-accent);
  background: color-mix(in srgb, var(--squisq-page-accent) 7%, var(--squisq-page-bg));
  padding: 1.75rem 2rem;
  box-shadow: var(--squisq-page-shadow);
  display: flex;
  gap: 1.75rem;
  align-items: flex-start;
}
.squisq-page-callout-title { font-family: var(--squisq-page-title-font); font-size: 1.35rem; font-weight: 700; margin: 0 0 0.5em; }
.squisq-page-callout-body { margin: 0; white-space: pre-line; }
.squisq-page-callout-meta { margin-top: 0.9em; font-size: 0.82rem; color: var(--squisq-page-text-muted); }
.squisq-page-callout .squisq-page-media-frame { flex: 0 0 132px; }
.squisq-page-callout .squisq-page-media-frame img { width: 132px; height: 132px; object-fit: cover; }
.squisq-page-callout[data-hint-framing='circle-accent'] .squisq-page-media-frame,
.squisq-page-callout[data-hint-framing='circle-accent'] .squisq-page-media-frame img { border-radius: 50%; }
.squisq-page-section--v-definition .squisq-page-callout-title { font-style: italic; }
.squisq-page-section--v-diagnostic .squisq-page-callout { border-left-color: var(--squisq-page-highlight); }

/* ── Card grid ────────────────────────────────────────────────────── */
.squisq-page-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; }
.squisq-page-card {
  border-radius: var(--squisq-page-radius);
  background: var(--squisq-page-bg-alt);
  border-top: 4px solid var(--squisq-page-card-accent, var(--squisq-page-accent));
  padding: 1.75rem 1.75rem 1.9rem;
  box-shadow: var(--squisq-page-shadow);
}
.squisq-page-card-title { font-family: var(--squisq-page-title-font); font-size: 1.3rem; margin: 0 0 0.4em; }
.squisq-page-card-body { margin: 0; color: var(--squisq-page-text-muted); white-space: pre-line; }
.squisq-page-cards-title { text-align: center; font-size: 1.9rem; margin-bottom: 1.75rem; }

/* ── Item list ────────────────────────────────────────────────────── */
.squisq-page-items { list-style: none; margin: 0; padding: 0; counter-reset: squisq-item; max-width: 40em; }
.squisq-page-items li {
  counter-increment: squisq-item;
  /* Grid + baseline alignment keeps the marker locked to the first text line
     regardless of marker size, body font, or line-height — an absolutely
     positioned marker with a fixed top offset drifts as soon as either
     changes. */
  display: grid;
  grid-template-columns: 3.4em 1fr;
  align-items: baseline;
  padding: 0.9em 0;
  font-size: 1.1rem;
}
.squisq-page-items li + li { border-top: 1px solid var(--squisq-page-divider-color); }
.squisq-page-items li::before {
  content: counter(squisq-item, decimal-leading-zero);
  font-family: var(--squisq-page-title-font);
  font-weight: 700;
  color: var(--squisq-page-accent);
  font-size: 1.15em;
}
/* Item bodies are rendered markdown: neutralize UA paragraph margins (which
   would otherwise push the first line below the marker) and space blocks. */
.squisq-page-item-body { min-width: 0; }
.squisq-page-item-body > * { margin: 0; }
.squisq-page-item-body > * + * { margin-top: 0.6em; }
.squisq-page[data-numerals='mono'] .squisq-page-items li::before { font-family: var(--squisq-page-mono-font); }
.squisq-page-items-title { font-size: 1.9rem; }

/* ── Timeline rail (dateEvent) ────────────────────────────────────── */
.squisq-page-section--timeline-rail { padding-block: 1.4rem; }
.squisq-page-section--timeline-rail:first-child { padding-top: var(--squisq-page-section-pad); }
.squisq-page-milestone { display: grid; grid-template-columns: 150px 1fr; gap: 2rem; align-items: baseline; position: relative; }
.squisq-page-milestone-date {
  font-family: var(--squisq-page-title-font);
  font-weight: 700;
  color: var(--squisq-page-accent);
  font-size: 1.05rem;
  text-align: right;
}
.squisq-page-milestone-rail {
  position: absolute;
  left: 166px;
  top: -1.4rem;
  bottom: -1.4rem;
  width: 2px;
  background: color-mix(in srgb, var(--squisq-page-accent) 35%, transparent);
}
.squisq-page-milestone-rail::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 0.55em;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  transform: translateX(-50%);
  background: var(--squisq-page-accent);
  border: 2px solid var(--squisq-page-bg);
}
.squisq-page-milestone-body { padding-left: 2.25rem; white-space: pre-line; }
.squisq-page-milestone-footer { margin-top: 0.5em; font-size: 0.85rem; color: var(--squisq-page-text-muted); }

/* ── Table section ────────────────────────────────────────────────── */
.squisq-page-table-title { font-size: 1.9rem; }
.squisq-page-table-scroll { overflow-x: auto; border-radius: var(--squisq-page-radius); box-shadow: var(--squisq-page-shadow); }
.squisq-page-table { width: 100%; border-collapse: collapse; font-size: 0.98rem; }
.squisq-page-table th {
  background: var(--squisq-page-accent-bg);
  color: var(--squisq-page-accent-text);
  font-family: var(--squisq-page-title-font);
  text-align: left;
  padding: 0.8em 1em;
}
.squisq-page-table td { padding: 0.7em 1em; border-top: 1px solid var(--squisq-page-divider-color); }
.squisq-page-table tbody tr:nth-child(even) { background: color-mix(in srgb, var(--squisq-page-text) 3.5%, transparent); }

/* ── Canvas embed (spatial SVG) ───────────────────────────────────── */
.squisq-page-canvas {
  width: 100%;
  margin-inline: auto;
  overflow: hidden;
  border-radius: var(--squisq-page-radius);
}
.squisq-page-canvas svg { display: block; width: 100%; height: 100%; }
.squisq-page-canvas--framed { border: 1px solid var(--squisq-page-divider-color); box-shadow: var(--squisq-page-shadow); }
.squisq-page-canvas--terminal { border: 1px solid color-mix(in srgb, var(--squisq-page-accent) 45%, transparent); }
.squisq-page-canvas--terminal::before {
  content: '\\25CF \\25CF \\25CF';
  display: block;
  font-size: 9px;
  letter-spacing: 4px;
  padding: 6px 12px;
  color: color-mix(in srgb, var(--squisq-page-accent) 70%, transparent);
  background: color-mix(in srgb, var(--squisq-page-accent) 9%, var(--squisq-page-bg));
  border-bottom: 1px solid color-mix(in srgb, var(--squisq-page-accent) 30%, transparent);
}

/* ── Prose ────────────────────────────────────────────────────────── */
.squisq-page-section--prose { padding-block: calc(var(--squisq-page-section-pad) * 0.45); }
.squisq-page[data-divider] .squisq-page-section--prose + .squisq-page-section--prose { border-top: none; }
.squisq-page-prose { font-size: 1.05rem; }
.squisq-page-prose p { margin: 0; }
.squisq-page-prose p + p { margin-top: 1.25em; }
.squisq-page-prose > * + * { margin-top: 1.1em; }
.squisq-page-prose code { font-family: var(--squisq-page-mono-font); font-size: 0.9em; }
.squisq-page-prose :not(pre) > code { background: color-mix(in srgb, var(--squisq-page-text) 8%, transparent); border-radius: 4px; padding: 0.12em 0.35em; }
.squisq-page-prose pre { background: color-mix(in srgb, var(--squisq-page-text) 6%, transparent); border-radius: var(--squisq-page-radius); padding: 1em 1.25em; overflow-x: auto; }
.squisq-page-prose pre code { background: none; border-radius: 0; padding: 0; }
.squisq-page .squisq-md-code-frame { position: relative; margin: 1em 0; }
.squisq-page .squisq-md-code-frame > pre { margin: 0; padding-right: 5rem; }
.squisq-page .squisq-md-code-copy {
  position: absolute;
  z-index: 1;
  top: 0.55rem;
  right: 0.55rem;
  min-width: 3.7rem;
  padding: 0.28rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--squisq-page-text) 20%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--squisq-page-bg) 90%, transparent);
  color: inherit;
  font: 500 0.72rem/1.2 system-ui, sans-serif;
  cursor: pointer;
  opacity: 0.58;
  transition: opacity 120ms ease, background-color 120ms ease;
}
.squisq-page .squisq-md-code-frame:hover > .squisq-md-code-copy,
.squisq-page .squisq-md-code-copy:focus-visible,
.squisq-page .squisq-md-code-copy[data-copy-state='copied'],
.squisq-page .squisq-md-code-copy[data-copy-state='failed'] { opacity: 1; }
.squisq-page .squisq-md-code-copy:hover { background: var(--squisq-page-bg); }
.squisq-page .squisq-md-code-copy:disabled { cursor: wait; }
.squisq-page-prose blockquote { margin: 0; border-left: 4px solid var(--squisq-page-accent); padding-left: 1.25em; color: var(--squisq-page-text-muted); }
.squisq-page-prose ul, .squisq-page-prose ol { padding-left: 1.5em; margin: 0; }
.squisq-page-prose li + li { margin-top: 0.4em; }
.squisq-page-prose hr { border: none; border-top: 1px solid var(--squisq-page-divider-color); }
.squisq-page-prose table { width: 100%; border-collapse: collapse; }
.squisq-page-prose th { font-family: var(--squisq-page-title-font); text-align: left; padding: 0.6em 0.8em; border-bottom: 2px solid var(--squisq-page-divider-color); }
.squisq-page-prose td { padding: 0.55em 0.8em; border-bottom: 1px solid var(--squisq-page-divider-color); }
.squisq-page-prose img { border-radius: var(--squisq-page-radius); }
.squisq-page-prose h1, .squisq-page-prose h2, .squisq-page-prose h3,
.squisq-page-prose h4, .squisq-page-prose h5, .squisq-page-prose h6 {
  font-family: var(--squisq-page-title-font);
  font-weight: var(--squisq-page-title-weight);
  line-height: 1.2;
  margin: 0 0 0.45em;
}
.squisq-page-prose h1 { font-size: 2.1rem; }
.squisq-page-prose h2 { font-size: 1.65rem; }
.squisq-page-prose h3 { font-size: 1.35rem; }
.squisq-page-prose h4, .squisq-page-prose h5, .squisq-page-prose h6 { font-size: 1.15rem; }
.squisq-page-section--prose[data-hint-drop-cap] .squisq-page-prose > p:first-child::first-letter {
  font-family: var(--squisq-page-title-font);
  font-size: 3.4em;
  font-weight: 700;
  float: left;
  line-height: 0.85;
  padding-right: 0.12em;
  color: var(--squisq-page-accent);
}

/* ── Footer band ──────────────────────────────────────────────────── */
.squisq-page-section--footer { text-align: center; }

/* ── Thin-margin embedding (chat bubbles) ─────────────────────────── */
.squisq-page--thin .squisq-page-section-inner { padding-inline: 0; }
.squisq-page--thin .squisq-page-section { padding-block: 1.5rem; }

/* Thumbnail image mode */
.squisq-page--thumbnail-images .squisq-page-prose img,
.squisq-page--thumbnail-images .squisq-page-figure img { max-width: 100px; max-height: 100px; object-fit: cover; }

/* ── Reveal animation (progressive enhancement) ───────────────────── */
@media (prefers-reduced-motion: no-preference) {
  .squisq-page-reveal { opacity: 0; transform: translateY(14px); transition: opacity 0.55s ease, transform 0.55s ease; }
  .squisq-page-reveal--in { opacity: 1; transform: none; }
}

/* ── Responsive ───────────────────────────────────────────────────── */
@container squisq-page (max-width: 720px) {
${NARROW_RULES}
}
@supports not (container-type: inline-size) {
  @media (max-width: 720px) {
${NARROW_RULES}
  }
}
`;

/**
 * Complete stylesheet for a themed page: a `.squisq-page { … }` variable
 * block followed by the structural CSS. For string-HTML consumers; the
 * React view sets the vars inline instead.
 */
export function buildPageCss(theme?: Theme): string {
  const vars = buildPageCssVars(theme);
  const varLines = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `.squisq-page {\n${varLines}\n}\n${PAGE_BASE_CSS}`;
}
