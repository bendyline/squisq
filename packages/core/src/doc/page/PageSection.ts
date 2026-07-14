/**
 * PageSection — the framework-agnostic block model for Page (linear) mode.
 *
 * Where `materializeBlockLayers` turns a block into fixed-viewport SVG
 * `Layer[]` (slides, video frames, spatial canvases), `materializePageSection`
 * turns the same block into a `PageSection`: a variable-height, content-slot
 * description that HTML renderers lay out reflowably. React's page view and
 * any string-HTML exporter consume this same structure, so neither re-derives
 * content from blocks.
 *
 * Inherently spatial content (diagram/tree/timeline/map/drawing/layout,
 * authored layers, custom templates) stays SVG: those sections carry the
 * source block in a `canvas` media slot and consumers embed the result of
 * `materializeBlockLayers` responsively. Core never emits markup.
 */

import type { Block } from '../../schemas/Doc.js';
import type { MarkdownBlockNode } from '../../markdown/types.js';
import type { ThemeColorScheme } from '../../schemas/Theme.js';
import type { PageSectionKind, PageEmphasis, PageBackground } from '../../schemas/PageStyle.js';

/**
 * Rich text content for a slot. `text` is always present (plain text);
 * `markdown` carries the original body nodes when the block has them, so
 * renderers can show real rich text with the plain string as fallback.
 */
export interface PageRichText {
  text: string;
  markdown?: MarkdownBlockNode[];
}

/** Which spatial pipeline a canvas-embed section renders through. */
export type PageSpatialKind =
  | 'diagram'
  | 'tree'
  | 'timeline'
  | 'map'
  | 'drawing'
  | 'layout'
  | 'custom'
  | 'authored';

/** Media content for a section slot. */
export type PageMedia =
  | {
      type: 'image';
      src: string;
      alt: string;
      credit?: string;
      license?: string;
      width?: number;
      height?: number;
    }
  | {
      type: 'video';
      src: string;
      posterSrc?: string;
      alt: string;
      clipStart?: number;
      clipEnd?: number;
      credit?: string;
      license?: string;
    }
  | {
      type: 'canvas';
      spatial: PageSpatialKind;
      /**
       * The block to pass to `materializeBlockLayers` (already merged with
       * derived inputs/params for annotated blocks). Read-only reference.
       */
      block: Block;
      /** Intrinsic aspect for the responsive embed frame. */
      aspect: { width: number; height: number };
    };

/** One entry in a multi-item section (stats, cards, gallery tiles, list rows). */
export interface PageSectionItem {
  title?: string;
  body?: string;
  /** Large numeral / value for stat and comparison items. */
  value?: string | number;
  media?: PageMedia;
  /** Per-item color-scheme name (e.g. twoColumn halves). */
  accentScheme?: string;
}

/** Structured diagnostics for sections that fell back (unknown template …). */
export interface PageSectionDiagnostic {
  code: 'unknown-template';
  template: string;
  message: string;
}

/** Where a section's content came from. */
export type PageSectionSource =
  | 'template'
  | 'prose'
  | 'authored'
  | 'custom-template'
  | 'cover'
  | 'fallback';

/**
 * One variable-height page section. The `kind` selects the layout family;
 * `slots` carry the content; `emphasis`/`accent`/`background` carry the
 * theme's art-direction decisions for this position in the sequence.
 */
export interface PageSection {
  kind: PageSectionKind;
  /** Layout variant within the kind (e.g. quote-band: plain|display|full-bleed|editorial). */
  variant?: string;
  /** Source block id ('' for the synthesized cover hero). */
  blockId: string;
  /** Canonical source template id (post-alias); absent for prose/cover/authored. */
  template?: string;
  slots: {
    /** Kicker text above the title (theme decides visibility/treatment). */
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    body?: PageRichText;
    /**
     * Authored rich body nodes not consumed by the selected template. Page
     * renderers place this after the template-specific layout so images,
     * video/audio HTML, and Mermaid fences are never silently discarded.
     */
    richContent?: PageRichText;
    media?: PageMedia;
    items?: PageSectionItem[];
    table?: {
      headers: string[];
      rows: string[][];
      align?: (('left' | 'right' | 'center') | null)[];
    };
    milestone?: {
      date: string;
      description: string;
      footer?: string;
      mood?: 'neutral' | 'somber' | 'celebratory';
    };
    attribution?: string;
    caption?: string;
    /** Small print: source citation, term origin, comparison unit. */
    meta?: string;
    /** Heading depth for prose sections (1..6). */
    headingLevel?: number;
  };
  emphasis: PageEmphasis;
  /** Resolved accent for this section; block-level colorScheme wins over rotation. */
  accent: {
    schemeName?: string;
    scheme?: ThemeColorScheme;
    role: 'primary' | 'rotation' | 'block' | 'none';
  };
  background: PageBackground;
  /** Pre-order position among this doc's sections. */
  index: number;
  totalSections: number;
  /** Nesting depth of the source block (0 for top-level and the cover). */
  depth: number;
  source: PageSectionSource;
  diagnostic?: PageSectionDiagnostic;
  /** Freeform theme hints from pageStyle overrides (e.g. dropCap, frame). */
  hints?: Record<string, string | number | boolean>;
}

/** Result wrapper mirroring `BlockLayerMaterialization`'s shape. */
export interface PageSectionMaterialization {
  section: PageSection;
  /** The source block; undefined for the synthesized cover hero. */
  block?: Block;
  source: PageSectionSource;
  diagnostic?: PageSectionDiagnostic;
}
