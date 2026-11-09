/**
 * The deck the recorder's slides panel presents — the doc's blocks, each
 * resolved into a renderable card plus the prose the presenter may want to
 * read from.
 *
 * ## A designed presentation replaces the per-block cards
 *
 * When the doc has a presentation (summarized or dynamic slides), the deck is
 * that presentation's slides, as playback will show them. A block can then
 * span several slides; each slide still names its source block, whose full
 * prose sits beneath it, and the block's first slide times the block. Each
 * slide also carries where its passage begins, which is how a take's first
 * showings become the presentation's own slide times.
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
  /** Unique within the deck: the block id, or the presentation slide's id. */
  id: string;
  /** Doc block id — the key the advance log and the timing sidecar both use. */
  blockId: string;
  /**
   * Where a presentation slide's passage begins in the narration script — the
   * key its first showing is recorded under. Absent for per-block cards.
   */
  sourceCharOffset?: number;
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
 * always line up with `flattenRenderableBlocks` (or, for a presentation,
 * with its slides).
 */
export function buildRecorderSlideDeck(
  doc: Doc,
  theme: Theme,
  viewport: ViewportConfig,
): RecorderSlide[] {
  const flat = flattenRenderableBlocks(doc.blocks);
  if (flat.length === 0) return [];

  // One projection for the whole deck — see the module note on why this beats
  // N per-block calls. The take being recorded replaces any document
  // narration, and a presentation will not compile against narration whose
  // timings this unresolved doc does not carry, so leave it out.
  let preview: Doc | null;
  try {
    preview = buildPreviewDoc(
      {
        ...doc,
        documentMedia: doc.documentMedia?.filter((clip) => clip.anchor !== 'document'),
      },
      { interleaveImages: false },
    );
  } catch {
    preview = null;
  }

  if (preview?.presentationApplied) {
    return presentationDeck(doc, flat, preview.blocks as DocBlock[], theme, viewport);
  }

  const slidesById = new Map(
    ((preview?.blocks ?? []) as DocBlock[]).map((slide) => [slide.id, slide] as const),
  );
  return flat.map((block, index) => {
    const { heading, bodyText } = blockNotes(block, index);
    return {
      id: block.id,
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
 * The presentation's slides, each with its source block's full prose as notes.
 * A slide whose source cannot be found (it should not happen) belongs to the
 * block before it, so its time is billed to the block being spoken.
 */
function presentationDeck(
  doc: Doc,
  flat: Block[],
  slides: DocBlock[],
  theme: Theme,
  viewport: ViewportConfig,
): RecorderSlide[] {
  const blockIndex = new Map(flat.map((block, index) => [block.id, index] as const));
  let previous = 0;
  return slides.map((slide, index) => {
    const found = slide.sourceBlockId ? blockIndex.get(slide.sourceBlockId) : undefined;
    const sourceIndex = found ?? previous;
    previous = sourceIndex;
    const block = flat[sourceIndex]!;
    const { heading, bodyText } = blockNotes(block, sourceIndex);
    return {
      id: slide.id,
      blockId: block.id,
      ...(slide.sourceCharOffset !== undefined ? { sourceCharOffset: slide.sourceCharOffset } : {}),
      heading,
      bodyText,
      visual: resolveSlideVisual(doc, block, slide, theme, viewport, index, slides.length),
    };
  });
}

/** A block's heading (or a positional fallback) and body prose, for the notes. */
function blockNotes(block: Block, index: number): { heading: string; bodyText: string } {
  const heading = block.title?.trim() || `Slide ${index + 1}`;
  let bodyText = '';
  try {
    bodyText = getBlockBodyText(block);
  } catch {
    bodyText = '';
  }
  return { heading, bodyText };
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
