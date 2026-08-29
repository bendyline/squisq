/**
 * The deck the recorder's slides panel presents — the doc's blocks, each
 * resolved into a renderable card plus the prose the presenter may want to
 * read from.
 *
 * ## Why the deck is anchored on blocks, not on preview slides
 *
 * Slide timings are recorded per DOC BLOCK, so the panel's list and the
 * sidecar's list must be the same list. `buildPreviewDoc` is 1:1 with
 * `flattenRenderableBlocks` — every slide carries its source block's `id` —
 * with exactly one exception: image interleaving splices extra
 * `img-interleave-N` slides that belong to no block. Passing
 * `interleaveImages: false` removes that one divergence, and walking the block
 * list (looking cards up by id) makes the correspondence structural rather
 * than incidental.
 *
 * The projection runs ONCE for the whole deck rather than per block, so each
 * card is materialized with its real `blockIndex`/`totalBlocks` — accent
 * rotation and first-slide art direction then match what playback shows,
 * which per-block `resolveBlockVisual` cannot do (it renders every block as
 * slide 1 of 1).
 */

import type { Block, Doc, DocBlock, Theme, ViewportConfig } from '@bendyline/squisq/schemas';
import {
  buildPreviewDoc,
  flattenRenderableBlocks,
  getBlockBodyText,
  materializeBlockLayers,
} from '@bendyline/squisq/doc';
import { resolveBlockVisual } from '../../resolveBlockVisual.js';

/** One slide in the recorder's deck, keyed by the doc block it came from. */
export interface RecorderSlide {
  /** Doc block id — the key the advance log and the timing sidecar both use. */
  blockId: string;
  /** Heading text, or a positional fallback for a heading-less block. */
  heading: string;
  /** The block's body prose, shown beneath the card as presenter notes. */
  bodyText: string;
  /** Materialized card, or null when this block has no slide rendition. */
  visual: Block | null;
}

/**
 * Build the deck for a doc. Never throws: a block whose card cannot be
 * materialized still appears, with `visual: null`, so the deck's indices
 * always line up with `flattenRenderableBlocks`.
 */
export function buildRecorderSlideDeck(
  doc: Doc,
  theme: Theme,
  viewport: ViewportConfig,
): RecorderSlide[] {
  const flat = flattenRenderableBlocks(doc.blocks);
  if (flat.length === 0) return [];

  // One projection for the whole deck — see the module note on why this beats
  // N per-block calls.
  let slidesById: Map<string, DocBlock>;
  try {
    const preview = buildPreviewDoc(doc, { interleaveImages: false });
    slidesById = new Map((preview.blocks as DocBlock[]).map((slide) => [slide.id, slide] as const));
  } catch {
    slidesById = new Map();
  }

  return flat.map((block, index) => {
    const heading = block.title?.trim() || `Slide ${index + 1}`;
    let bodyText = '';
    try {
      bodyText = getBlockBodyText(block);
    } catch {
      bodyText = '';
    }
    return {
      blockId: block.id,
      heading,
      bodyText,
      visual: resolveSlideVisual(
        doc,
        block,
        slidesById.get(block.id),
        theme,
        viewport,
        index,
        flat.length,
      ),
    };
  });
}

/**
 * Materialize one card from the whole-deck projection, falling back to the
 * single-block path and then to "no rendition". Each rung is wrapped
 * independently so one bad block cannot blank the deck.
 */
function resolveSlideVisual(
  doc: Doc,
  block: Block,
  slide: DocBlock | undefined,
  theme: Theme,
  viewport: ViewportConfig,
  index: number,
  totalBlocks: number,
): Block | null {
  if (slide) {
    try {
      const { layers } = materializeBlockLayers(slide, {
        blockIndex: index,
        totalBlocks,
        theme,
        viewport,
        customTemplates: doc.customTemplates,
      });
      return { ...(slide as unknown as Block), layers };
    } catch {
      // Fall through to the single-block path.
    }
  }
  return resolveBlockVisual(doc, block, theme, viewport);
}
