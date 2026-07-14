/**
 * Page Style — the theme's art-direction layer for Page (linear) mode.
 *
 * Slides render through fixed-viewport SVG templates; pages render through
 * a small closed vocabulary of variable-height HTML section layouts
 * (`PageSectionKind`). A `ThemePageStyle` is how a theme art-directs that
 * page rendition: it picks a design family, sets page-wide tokens
 * (column widths, spacing, dividers, hero treatment, image framing …),
 * and can override how individual section kinds or block templates map
 * onto the section vocabulary.
 *
 * Design principles (mirrors the rest of the Theme schema):
 * - Fully JSON-serializable — rides the `squisq-custom-themes` frontmatter
 *   codec unchanged.
 * - Closed enums everywhere so renderers can switch exhaustively and the
 *   validator can reject typos.
 * - Optional on `Theme`; `resolvePageStyle`/`defaultPageStyle` derive a
 *   complete style from existing theme fields when absent, so legacy and
 *   customizer themes keep working without edits.
 */

// ============================================
// Section vocabulary
// ============================================

/**
 * The closed set of page section layouts. Every block template maps onto
 * one of these kinds (see `doc/page/sectionExtractors.ts`); themes may
 * remap via `ThemePageStyle.sections` / `.templates`.
 */
export const PAGE_SECTION_KINDS = [
  'hero',
  'banner',
  'stat-band',
  'quote-band',
  'feature-split',
  'media-figure',
  'gallery',
  'callout',
  'card-grid',
  'item-list',
  'timeline-rail',
  'table-section',
  'canvas-embed',
  'prose',
  'footer',
] as const;

export type PageSectionKind = (typeof PAGE_SECTION_KINDS)[number];

/** Relative visual weight of a section within the page. */
export type PageEmphasis = 'lead' | 'strong' | 'standard' | 'quiet';

/** Which background treatment a section sits on. */
export type PageBackground = 'base' | 'alternate' | 'accent' | 'media';

// ============================================
// Design families + tokens
// ============================================

/**
 * Broad page design personalities. A family selects the structural
 * skeleton (how sections compose); tokens parameterize it per theme.
 */
export const PAGE_DESIGN_FAMILIES = [
  'clean',
  'editorial',
  'brutalist',
  'terminal',
  'cinematic',
  'documentary',
  'organic',
  'soft',
] as const;

export type PageDesignFamily = (typeof PAGE_DESIGN_FAMILIES)[number];

/** How headings announce themselves across the page. */
export interface PageHeadingTreatment {
  /** Small label above headings: none, plain kicker, "01 —" numbering, or a mono tag. */
  eyebrow: 'none' | 'kicker' | 'numbered' | 'mono-tag';
  /** Overall heading size register. */
  scale: 'regular' | 'display' | 'oversized';
  /** Optional case transform for headings/eyebrows. */
  case?: 'none' | 'uppercase';
  /** Optional decoration under headings. */
  underline?: 'none' | 'accent-bar' | 'full-rule';
}

/**
 * Page-wide design tokens. Structural CSS reads these via
 * `--squisq-page-*` custom properties (see `doc/pageCss.ts`).
 */
export interface PageTokens {
  /** Reading-column max width in px (prose, callouts, quotes). */
  contentMaxWidth: number;
  /** Wide-band inner max width in px (figures, tables, feature splits). */
  wideMaxWidth: number;
  /** Vertical rhythm between sections. */
  sectionSpacing: 'compact' | 'comfortable' | 'generous';
  /** Corner radius for cards, media frames, panels (px). */
  cornerRadius: number;
  /** Divider treatment between sections. */
  divider: 'none' | 'gap-only' | 'hairline' | 'thick-rule' | 'double-rule' | 'dotted';
  /** How section backgrounds vary down the page. */
  backgroundRhythm: 'flat' | 'alternate' | 'accent-bands' | 'tinted-panels';
  /** Hero (cover/title) composition. */
  heroStyle: 'stacked' | 'split' | 'full-bleed' | 'letterbox' | 'oversized-type';
  /** Heading voice across the page. */
  headingTreatment: PageHeadingTreatment;
  /** Frame treatment for photographic media. */
  imageFraming: 'flush' | 'rounded' | 'bordered' | 'polaroid' | 'letterboxed' | 'circle-accent';
  /** Shadow language for elevated elements. */
  shadow: 'none' | 'soft' | 'crisp' | 'heavy';
  /** Decoration on quote sections. */
  quoteMark: 'none' | 'oversized-glyph' | 'accent-bar';
  /** Treatment of large stat numerals. */
  numeralStyle: 'plain' | 'oversized' | 'boxed' | 'mono';
  /** Optional page background pattern. */
  pattern?: 'none' | 'dots' | 'grid' | 'diagonal' | 'noise';
}

// ============================================
// Overrides + accent rotation
// ============================================

/**
 * A theme's override for one section kind or one block template —
 * remap the kind, force a variant, adjust emphasis/background, or pass
 * freeform scalar hints the section renderer understands.
 */
export interface PageSectionOverride {
  kind?: PageSectionKind;
  variant?: string;
  emphasis?: PageEmphasis;
  background?: PageBackground;
  /** Freeform scalar hints (e.g. `dropCap: true`, `frame: "terminal"`). */
  hints?: Record<string, string | number | boolean>;
}

/** How named color schemes rotate across accent-bearing sections. */
export interface PageAccentRotation {
  strategy: 'primary-only' | 'cycle' | 'alternate-two' | 'none';
  /**
   * ColorScheme names (keys of `theme.colorSchemes`) to rotate through.
   * Defaults to all schemes in insertion order.
   */
  schemes?: string[];
}

// ============================================
// ThemePageStyle
// ============================================

/**
 * The complete page art direction for a theme. Optional on `Theme`;
 * `defaultPageStyle(theme)` derives one from existing theme fields.
 */
export interface ThemePageStyle {
  family: PageDesignFamily;
  tokens: PageTokens;
  /** Per-section-kind overrides. */
  sections?: Partial<Record<PageSectionKind, PageSectionOverride>>;
  /** Per-template overrides (canonical template ids); win over `sections`. */
  templates?: Record<string, PageSectionOverride>;
  accentRotation: PageAccentRotation;
}

// ============================================
// Enum sets (shared by the validator + defaults)
// ============================================

export const PAGE_SECTION_SPACINGS = ['compact', 'comfortable', 'generous'] as const;
export const PAGE_DIVIDERS = [
  'none',
  'gap-only',
  'hairline',
  'thick-rule',
  'double-rule',
  'dotted',
] as const;
export const PAGE_BACKGROUND_RHYTHMS = [
  'flat',
  'alternate',
  'accent-bands',
  'tinted-panels',
] as const;
export const PAGE_HERO_STYLES = [
  'stacked',
  'split',
  'full-bleed',
  'letterbox',
  'oversized-type',
] as const;
export const PAGE_EYEBROWS = ['none', 'kicker', 'numbered', 'mono-tag'] as const;
export const PAGE_HEADING_SCALES = ['regular', 'display', 'oversized'] as const;
export const PAGE_HEADING_CASES = ['none', 'uppercase'] as const;
export const PAGE_HEADING_UNDERLINES = ['none', 'accent-bar', 'full-rule'] as const;
export const PAGE_IMAGE_FRAMINGS = [
  'flush',
  'rounded',
  'bordered',
  'polaroid',
  'letterboxed',
  'circle-accent',
] as const;
export const PAGE_SHADOWS = ['none', 'soft', 'crisp', 'heavy'] as const;
export const PAGE_QUOTE_MARKS = ['none', 'oversized-glyph', 'accent-bar'] as const;
export const PAGE_NUMERAL_STYLES = ['plain', 'oversized', 'boxed', 'mono'] as const;
export const PAGE_PATTERNS = ['none', 'dots', 'grid', 'diagonal', 'noise'] as const;
export const PAGE_EMPHASES = ['lead', 'strong', 'standard', 'quiet'] as const;
export const PAGE_BACKGROUNDS = ['base', 'alternate', 'accent', 'media'] as const;
export const PAGE_ACCENT_STRATEGIES = ['primary-only', 'cycle', 'alternate-two', 'none'] as const;
