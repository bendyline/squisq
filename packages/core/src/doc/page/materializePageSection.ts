/**
 * Canonical block-to-page-section materialization — the Page (linear) mode
 * sibling of `materializeBlockLayers`.
 *
 * `materializePageSections(doc, …)` is the primary entry point: it walks the
 * block tree pre-order, extracts a `PageSection` per block (cover hero,
 * typed template sections, prose, canvas embeds, visible fallbacks), and
 * then applies the theme's art direction across the sequence — background
 * rhythm, accent rotation, and the emphasis curve are sequence-scoped
 * decisions that per-block calls cannot make.
 *
 * Failures are data, not console side effects: an unknown template becomes
 * a visible `callout` section with a structured diagnostic (mirroring
 * `materializeBlockLayers`' fallback posture).
 */

import type { Block, Doc, StartBlockConfig } from '../../schemas/Doc.js';
import type { CustomTemplateDefinition } from '../../schemas/CustomTemplates.js';
import type { Theme, ThemeColorScheme } from '../../schemas/Theme.js';
import type { ViewportConfig } from '../../schemas/Viewport.js';
import type {
  PageBackground,
  PageEmphasis,
  PageSectionKind,
  PageSectionOverride,
  ThemePageStyle,
} from '../../schemas/PageStyle.js';
import { DEFAULT_THEME } from '../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../schemas/Viewport.js';
import { defaultPageStyle } from '../../schemas/pageStyleDefaults.js';
import { extractPlainText } from '../../markdown/utils.js';
import type { MarkdownBlockNode } from '../../markdown/types.js';
import { extractBodyPlainText } from '../templateInputs.js';
import { isContainerTemplate } from '../templates/templateNames.js';
import { isTemplatedPageBlock, resolvePageBlock } from './resolvePageBlock.js';
import { sectionExtractors, type PageSectionDraft } from './sectionExtractors.js';
import type {
  PageSection,
  PageSectionDiagnostic,
  PageSectionMaterialization,
  PageRichText,
  PageSectionSource,
} from './PageSection.js';

/**
 * Page-mode hints a transform style may carry (`TransformStyleConfig.page`).
 * Defined here (not in `transform/`) so the doc pipeline stays independent
 * of the transform module.
 */
export interface PageTransformHints {
  /** Overrides `pageStyle.tokens.sectionSpacing` for this rendition. */
  spacing?: 'compact' | 'comfortable' | 'generous';
  /** 'front-loaded' promotes the first sections' emphasis one step. */
  emphasisCurve?: 'even' | 'front-loaded';
}

/** Options shared by the per-block and doc-level entry points. */
export interface MaterializePageSectionOptions {
  /** Theme whose `pageStyle` art-directs the sections. */
  theme?: Theme;
  /** Aspect reference for canvas embeds. Defaults to the landscape preset. */
  viewport?: ViewportConfig;
  /** Zero-based position in the section sequence (per-block calls). */
  blockIndex?: number;
  /** Total sections in the sequence (per-block calls). */
  totalBlocks?: number;
  /** Document-scoped custom templates (render as canvas embeds). */
  customTemplates?: readonly CustomTemplateDefinition[];
  /**
   * Fence languages a host renderer claims as widgets (see
   * `@bendyline/squisq/fence`). Typed-template sections keep only the rich
   * content they haven't already consumed — historically just mermaid
   * fences and media. A claimed fence must survive that filter too, or a
   * host widget inside a callout/card block is dropped before it ever
   * reaches the renderer. Lowercased language tokens; mermaid is always
   * kept regardless.
   */
  widgetFenceLangs?: readonly string[];
}

/** Doc-level options. */
export interface MaterializePageSectionsOptions extends MaterializePageSectionOptions {
  /**
   * Cover hero: pass the doc's `startBlock` to synthesize a leading hero
   * section, `false`/undefined to omit. (The caller decides — the editor's
   * Cover toggle maps here.)
   */
  cover?: StartBlockConfig | false;
  /** Page hints from the active transform style, if any. */
  transformPage?: PageTransformHints;
}

/**
 * Resolve the effective page style for a theme: explicit `theme.pageStyle`
 * wins, else a derived default. Transform hints overlay spacing.
 * Never returns undefined.
 */
export function resolvePageStyle(theme?: Theme, hints?: PageTransformHints): ThemePageStyle {
  const base = theme?.pageStyle ?? defaultPageStyle(theme ?? DEFAULT_THEME);
  if (!hints?.spacing || hints.spacing === base.tokens.sectionSpacing) return base;
  return { ...base, tokens: { ...base.tokens, sectionSpacing: hints.spacing } };
}

/** Section kinds that carry a rotating accent scheme. */
const ACCENT_KINDS: ReadonlySet<PageSectionKind> = new Set([
  'banner',
  'stat-band',
  'quote-band',
  'callout',
  'card-grid',
  'item-list',
  'timeline-rail',
  'footer',
]);

/** Kinds rendered as full-width color bands under the accent-bands rhythm. */
const BAND_KINDS: ReadonlySet<PageSectionKind> = new Set([
  'banner',
  'quote-band',
  'stat-band',
  'footer',
]);

/** Kinds rendered as tinted panels under the tinted-panels rhythm. */
const PANEL_KINDS: ReadonlySet<PageSectionKind> = new Set([
  'callout',
  'card-grid',
  'stat-band',
  'item-list',
  'timeline-rail',
  'table-section',
]);

interface DraftResult {
  draft: PageSectionDraft;
  source: PageSectionSource;
  templateName?: string;
  diagnostic?: PageSectionDiagnostic;
}

function isMermaidFence(node: MarkdownBlockNode): boolean {
  return node.type === 'code' && node.lang?.trim().toLowerCase() === 'mermaid';
}

/** A fence some renderer claims as a widget: mermaid, or a host-registered lang. */
function isWidgetFence(node: MarkdownBlockNode, widgetFenceLangs?: readonly string[]): boolean {
  if (isMermaidFence(node)) return true;
  if (!widgetFenceLangs || widgetFenceLangs.length === 0) return false;
  if (node.type !== 'code') return false;
  const lang = node.lang?.trim().toLowerCase();
  return !!lang && widgetFenceLangs.includes(lang);
}

function htmlTreeContainsMedia(nodes: unknown[]): boolean {
  for (const value of nodes) {
    if (!value || typeof value !== 'object') continue;
    const node = value as Record<string, unknown>;
    if (
      node.type === 'htmlElement' &&
      typeof node.tagName === 'string' &&
      ['img', 'video', 'audio'].includes(node.tagName.toLowerCase())
    ) {
      return true;
    }
    if (Array.isArray(node.children) && htmlTreeContainsMedia(node.children)) return true;
  }
  return false;
}

function markdownNodeContainsMedia(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (node.type === 'image') return true;
  if (
    (node.type === 'htmlBlock' || node.type === 'htmlInline') &&
    Array.isArray(node.htmlChildren) &&
    htmlTreeContainsMedia(node.htmlChildren)
  ) {
    return true;
  }
  return Array.isArray(node.children) && node.children.some(markdownNodeContainsMedia);
}

/** Rich body content that a typed template has not already consumed. */
function unconsumedRichContent(
  block: Block,
  draft: PageSectionDraft,
  widgetFenceLangs?: readonly string[],
): PageRichText | undefined {
  if (!block.contents || block.contents.length === 0) return undefined;
  const templateHasMedia =
    Boolean(draft.slots.media) ||
    Boolean(draft.slots.items?.some((item) => item.media !== undefined));
  const markdown = block.contents.filter(
    (node) =>
      isWidgetFence(node, widgetFenceLangs) ||
      (!templateHasMedia && markdownNodeContainsMedia(node)),
  );
  if (markdown.length === 0) return undefined;
  return {
    text: markdown
      .map((node) => extractPlainText(node))
      .join('\n')
      .trim(),
    markdown,
  };
}

function preserveRichContent(
  block: Block,
  draft: PageSectionDraft,
  widgetFenceLangs?: readonly string[],
): PageSectionDraft {
  const richContent = unconsumedRichContent(block, draft, widgetFenceLangs);
  return richContent ? { ...draft, slots: { ...draft.slots, richContent } } : draft;
}

/** Extract the pre-art-direction draft for one block. */
function draftForBlock(
  block: Block,
  viewport: ViewportConfig,
  customTemplates?: readonly CustomTemplateDefinition[],
  widgetFenceLangs?: readonly string[],
): DraftResult {
  if (isTemplatedPageBlock(block)) {
    const resolved = resolvePageBlock(block);
    const templateName = resolved.templateName!;
    const extractor = sectionExtractors[templateName];
    if (extractor) {
      return {
        draft: preserveRichContent(
          block,
          extractor(resolved.templateBlock!, { block, viewport }),
          widgetFenceLangs,
        ),
        source: 'template',
        templateName,
      };
    }

    const custom = customTemplates?.find((definition) => definition.name === templateName);
    if (custom) {
      const draft: PageSectionDraft = {
        kind: 'canvas-embed',
        variant: 'custom',
        slots: {
          media: {
            type: 'canvas',
            spatial: 'custom',
            block: resolved.templateBlock as unknown as Block,
            aspect: {
              width: custom.viewport?.width ?? viewport.width,
              height: custom.viewport?.height ?? viewport.height,
            },
          },
        },
      };
      return {
        draft: preserveRichContent(block, draft, widgetFenceLangs),
        source: 'custom-template',
        templateName,
      };
    }

    const diagnostic: PageSectionDiagnostic = {
      code: 'unknown-template',
      template: templateName,
      message: `Unknown template "${templateName}"`,
    };
    const headingText = block.sourceHeading ? extractPlainText(block.sourceHeading) : undefined;
    const draft: PageSectionDraft = {
      kind: 'callout',
      variant: 'diagnostic',
      slots: {
        title: headingText ?? diagnostic.message,
        body: { text: extractBodyPlainText(block.contents) },
        meta: diagnostic.message,
      },
      emphasis: 'quiet',
    };
    return {
      draft: preserveRichContent(block, draft, widgetFenceLangs),
      source: 'fallback',
      templateName,
      diagnostic,
    };
  }

  if (block.layers && block.layers.length > 0) {
    const draft: PageSectionDraft = {
      kind: 'canvas-embed',
      variant: 'authored',
      slots: {
        media: {
          type: 'canvas',
          spatial: 'authored',
          block,
          aspect: { width: viewport.width, height: viewport.height },
        },
      },
    };
    return {
      draft: preserveRichContent(block, draft, widgetFenceLangs),
      source: 'authored',
    };
  }

  const heading = block.sourceHeading;
  return {
    draft: {
      kind: 'prose',
      slots: {
        title: heading ? extractPlainText(heading) : undefined,
        headingLevel: heading?.depth,
        body:
          block.contents && block.contents.length > 0
            ? { text: extractBodyPlainText(block.contents), markdown: block.contents }
            : undefined,
      },
    },
    source: 'prose',
  };
}

/** Look up the theme override for a draft: per-template wins over per-kind. */
function overrideFor(
  pageStyle: ThemePageStyle,
  kind: PageSectionKind,
  templateName?: string,
): PageSectionOverride | undefined {
  const byTemplate = templateName ? pageStyle.templates?.[templateName] : undefined;
  const byKind = pageStyle.sections?.[kind];
  if (!byTemplate) return byKind;
  if (!byKind) return byTemplate;
  return {
    ...byKind,
    ...byTemplate,
    hints: { ...byKind.hints, ...byTemplate.hints },
  };
}

interface SectionSeed {
  draft: PageSectionDraft;
  source: PageSectionSource;
  templateName?: string;
  diagnostic?: PageSectionDiagnostic;
  override?: PageSectionOverride;
  block?: Block;
  depth: number;
}

/** Build the final section from a seed + sequence-scoped decisions. */
function buildSection(
  seed: SectionSeed,
  index: number,
  totalSections: number,
  background: PageBackground,
  emphasis: PageEmphasis,
  accent: PageSection['accent'],
): PageSection {
  const { draft, override } = seed;
  const hints = { ...draft.hints, ...override?.hints };
  const section: PageSection = {
    kind: override?.kind ?? draft.kind,
    variant: override?.variant ?? draft.variant,
    blockId: seed.block?.id ?? 'cover',
    template:
      seed.source === 'template' || seed.source === 'custom-template' || seed.source === 'fallback'
        ? seed.templateName
        : undefined,
    slots: draft.slots,
    emphasis,
    accent,
    background,
    index,
    totalSections,
    depth: seed.depth,
    source: seed.source,
  };
  if (seed.diagnostic) section.diagnostic = seed.diagnostic;
  if (Object.keys(hints).length > 0) section.hints = hints;
  return section;
}

function resolveScheme(theme: Theme, schemeName: string | undefined): ThemeColorScheme | undefined {
  return schemeName ? theme.colorSchemes?.[schemeName] : undefined;
}

/** The names available for accent rotation, honoring `accentRotation.schemes`. */
function rotationSchemeNames(pageStyle: ThemePageStyle, theme: Theme): string[] {
  const all = Object.keys(theme.colorSchemes ?? {});
  const requested = pageStyle.accentRotation.schemes;
  if (!requested || requested.length === 0) return all;
  return requested.filter((name) => all.includes(name));
}

/**
 * Materialize one block in isolation. Sequence-scoped art direction
 * (background rhythm, accent rotation, emphasis curve) does not apply —
 * use `materializePageSections` for whole-document rendering.
 */
export function materializePageSection(
  block: Block,
  options: MaterializePageSectionOptions = {},
): PageSectionMaterialization {
  const theme = options.theme ?? DEFAULT_THEME;
  const viewport = options.viewport ?? VIEWPORT_PRESETS.landscape;
  const pageStyle = resolvePageStyle(theme);
  const result = draftForBlock(block, viewport, options.customTemplates, options.widgetFenceLangs);
  const override = overrideFor(pageStyle, result.draft.kind, result.templateName);

  const background: PageBackground =
    override?.background ?? (result.draft.mediaBackground ? 'media' : 'base');
  const emphasis: PageEmphasis = override?.emphasis ?? result.draft.emphasis ?? 'standard';
  const accent: PageSection['accent'] = result.draft.colorScheme
    ? {
        schemeName: result.draft.colorScheme,
        scheme: resolveScheme(theme, result.draft.colorScheme),
        role: 'block',
      }
    : { role: pageStyle.accentRotation.strategy === 'none' ? 'none' : 'primary' };

  const section = buildSection(
    { ...result, override, block, depth: 0 },
    options.blockIndex ?? 0,
    options.totalBlocks ?? 1,
    background,
    emphasis,
    accent,
  );
  return {
    section,
    block,
    source: result.source,
    diagnostic: result.diagnostic,
  };
}

/**
 * Materialize a whole document into its ordered page sections, applying
 * the theme's art direction across the sequence. The primary entry point
 * for Page (linear) mode renderers and exporters.
 */
export function materializePageSections(
  doc: Doc,
  options: MaterializePageSectionsOptions = {},
): PageSectionMaterialization[] {
  const theme = options.theme ?? DEFAULT_THEME;
  const viewport = options.viewport ?? VIEWPORT_PRESETS.landscape;
  const pageStyle = resolvePageStyle(theme, options.transformPage);
  const customTemplates = options.customTemplates ?? doc.customTemplates;

  // ── Collect seeds pre-order ──────────────────────────────────────
  const seeds: SectionSeed[] = [];

  if (options.cover) {
    const cover = options.cover;
    seeds.push({
      draft: {
        kind: 'hero',
        variant: 'cover',
        slots: {
          title: cover.title,
          subtitle: cover.subtitle,
          media: cover.heroSrc
            ? {
                type: 'image',
                src: cover.heroSrc,
                alt: cover.heroAlt ?? '',
                credit: cover.heroCredit,
                license: cover.heroLicense,
              }
            : undefined,
        },
        emphasis: 'lead',
        mediaBackground: !!cover.heroSrc,
      },
      source: 'cover',
      depth: 0,
    });
  }

  const walk = (blocks: readonly Block[], depth: number): void => {
    for (const block of blocks) {
      const result = draftForBlock(block, viewport, customTemplates, options.widgetFenceLangs);
      seeds.push({ ...result, block, depth });
      // Container templates (diagram/drawing/layout) consume their children
      // inside the canvas; everything else recurses.
      const consumed =
        result.draft.kind === 'canvas-embed' && isContainerTemplate(result.templateName);
      if (!consumed && block.children && block.children.length > 0) {
        walk(block.children, depth + 1);
      }
    }
  };
  walk(doc.blocks ?? [], 0);

  // ── Cover dedupe ─────────────────────────────────────────────────
  // The auto-generated cover copies the first H1's title (and its first
  // paragraph as subtitle). On one scrolling page rendering both reads as
  // a duplicate, so suppress the mirrored content from the H1's own
  // section — and drop that section entirely when nothing remains.
  if (options.cover && seeds.length > 1) {
    const cover = options.cover;
    const first = seeds[1];
    if (first.draft.kind === 'hero' && first.draft.slots.title === cover.title) {
      // The author already opens with a title/hero block — that one wins.
      // Graft the cover's hero media onto it when it has none of its own.
      const coverSeed = seeds[0];
      const coverMedia = coverSeed.draft.slots.media;
      if (coverMedia && !first.draft.slots.media) {
        first.draft = {
          ...first.draft,
          slots: { ...first.draft.slots, media: coverMedia },
          mediaBackground: true,
        };
      }
      seeds.splice(0, 1);
    } else if (first.draft.kind === 'prose' && first.draft.slots.title === cover.title) {
      const slots = { ...first.draft.slots };
      delete slots.title;
      delete slots.headingLevel;
      let markdown = slots.body?.markdown;
      if (
        cover.subtitle &&
        markdown &&
        markdown.length > 0 &&
        markdown[0].type === 'paragraph' &&
        extractPlainText(markdown[0]) === cover.subtitle
      ) {
        markdown = markdown.slice(1);
      }
      if (markdown && markdown.length > 0) {
        slots.body = {
          text: markdown
            .map((node) => extractPlainText(node))
            .join('\n')
            .trim(),
          markdown,
        };
        first.draft = { ...first.draft, slots };
      } else {
        seeds.splice(1, 1);
      }
    }
  }

  // ── Apply theme overrides + sequence art direction ───────────────
  for (const seed of seeds) {
    seed.override = overrideFor(pageStyle, seed.draft.kind, seed.templateName);
  }

  const totalSections = seeds.length;
  const rhythm = pageStyle.tokens.backgroundRhythm;
  const strategy = pageStyle.accentRotation.strategy;
  const schemeNames = rotationSchemeNames(pageStyle, theme);
  const rotationSize =
    strategy === 'alternate-two' ? Math.min(2, schemeNames.length) : schemeNames.length;

  let bandCounter = 0;
  let rotationCounter = 0;
  let promotedCount = 0;
  let eyebrowCounter = 0;
  const eyebrowTreatment = pageStyle.tokens.headingTreatment.eyebrow;

  const results: PageSectionMaterialization[] = [];
  for (let index = 0; index < seeds.length; index++) {
    const seed = seeds[index];
    const kind = seed.override?.kind ?? seed.draft.kind;

    // Background: explicit override > media background > rhythm.
    let background: PageBackground;
    if (seed.override?.background) {
      background = seed.override.background;
    } else if (seed.draft.mediaBackground) {
      background = 'media';
    } else if (kind === 'prose' || rhythm === 'flat') {
      background = 'base';
    } else if (rhythm === 'accent-bands' && BAND_KINDS.has(kind)) {
      background = 'accent';
    } else if (rhythm === 'tinted-panels') {
      background = PANEL_KINDS.has(kind) ? 'alternate' : 'base';
    } else if (rhythm === 'alternate' || rhythm === 'accent-bands') {
      background = bandCounter % 2 === 1 ? 'alternate' : 'base';
      bandCounter++;
    } else {
      background = 'base';
    }

    // Accent: block-authored scheme > rotation > primary.
    let accent: PageSection['accent'];
    if (seed.draft.colorScheme) {
      accent = {
        schemeName: seed.draft.colorScheme,
        scheme: resolveScheme(theme, seed.draft.colorScheme),
        role: 'block',
      };
    } else if (
      ACCENT_KINDS.has(kind) &&
      (strategy === 'cycle' || strategy === 'alternate-two') &&
      rotationSize > 0
    ) {
      const schemeName = schemeNames[rotationCounter % rotationSize];
      rotationCounter++;
      accent = { schemeName, scheme: resolveScheme(theme, schemeName), role: 'rotation' };
    } else if (strategy === 'none') {
      accent = { role: 'none' };
    } else {
      accent = { role: 'primary' };
    }

    // Emphasis: override > draft > standard, then the transform curve.
    let emphasis: PageEmphasis = seed.override?.emphasis ?? seed.draft.emphasis ?? 'standard';
    if (
      options.transformPage?.emphasisCurve === 'front-loaded' &&
      kind !== 'hero' &&
      kind !== 'prose' &&
      promotedCount < 2
    ) {
      if (emphasis === 'standard') emphasis = 'strong';
      promotedCount++;
    }

    // Numbered / mono-tag eyebrows: fill sequential ordinals on the
    // heading-bearing band sections so "01 —" chapter kickers count
    // contiguously down the page. Authored eyebrow text always wins.
    if (
      (eyebrowTreatment === 'numbered' || eyebrowTreatment === 'mono-tag') &&
      (kind === 'hero' || kind === 'banner')
    ) {
      eyebrowCounter++;
      if (!seed.draft.slots.eyebrow) {
        seed.draft.slots = {
          ...seed.draft.slots,
          eyebrow: String(eyebrowCounter).padStart(2, '0'),
        };
      }
    }

    const section = buildSection(seed, index, totalSections, background, emphasis, accent);
    results.push({
      section,
      block: seed.block,
      source: seed.source,
      diagnostic: seed.diagnostic,
    });
  }

  return results;
}
