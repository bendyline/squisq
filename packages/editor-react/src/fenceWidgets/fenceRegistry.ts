/**
 * Shared position-registry remapping for the fence-widget families (ascii
 * diagram, tree, timeline, mermaid, repairable).
 *
 * Each family keeps a registry of `{ id, pos }` entries: a synthetic session
 * id per claimed code fence, plus that fence's current document position.
 * The id is what keys the widget decoration, so preserving it across a
 * transaction is what keeps the mounted React root — and all of its
 * unpersisted state (pan/zoom, height, `sourceVisible`, collapse set) —
 * alive. This module owns the one rule for deciding which old id belongs to
 * which new position; it lived as five near-identical copies before.
 */

import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

/** One registered fence: a stable session id at a live document position. */
export interface FenceBlockEntry {
  /** Synthetic session id, stable across edits to one fence. */
  id: string;
  /** Document position of the codeBlock node at the current state. */
  pos: number;
}

/**
 * Did the codeBlock registered at `entry.pos` SURVIVE this transaction in a
 * modified form, or was it removed (leaving some other block at the position
 * it used to occupy)?
 *
 * This is the question pass 2 of {@link mapFenceEntries} has to answer, and
 * position alone cannot: both cases put a codeBlock at the same mapped
 * position with the old start reported as `deleted`.
 *
 * The discriminator is the old node's SPAN. Map its start forward with
 * `assoc: 1` and its end with `assoc: -1`:
 *  - churn (`setNodeMarkup` rewrites the opening token during language
 *    promotion, ±a text replace in the same transaction) → the node's content
 *    is still there, so the mapped span stays non-empty;
 *  - deletion → the whole span collapses onto a single point, and any
 *    codeBlock now at that position is a DIFFERENT fence that must be
 *    re-judged by its family's full detection gate, not handed the dead
 *    entry's id and lenient hysteresis treatment.
 */
function survivedAsChurn(tr: Transaction, entry: FenceBlockEntry, mappedPos: number): boolean {
  const before = tr.before.nodeAt(entry.pos);
  if (!before || before.type.name !== 'codeBlock') return false;
  return tr.mapping.map(entry.pos + before.nodeSize, -1) > mappedPos;
}

/**
 * Remap a family's previous registry entries onto the new document, returning
 * `mappedPos -> id` for every fence whose identity carries over.
 *
 * Two passes:
 *  1. survivors whose start position was untouched — the common case;
 *  2. boundary-churn survivors, where an attrs-only `setNodeMarkup` makes
 *     `mapResult` report the start as deleted even though the same block is
 *     still there. Adopt the old id only when a codeBlock sits at the mapped
 *     position, the slot is unclaimed, AND the old node actually survived
 *     (see {@link survivedAsChurn}).
 *
 * Callers then walk the new doc: a position present in this map keeps its id
 * (and may use a lenient re-parse gate); a position absent from it is a NEW
 * fence that must pass full detection.
 */
export function mapFenceEntries(
  tr: Transaction,
  previous: readonly FenceBlockEntry[],
  doc: PMNode,
): Map<number, string> {
  const mapped = new Map<number, string>();
  const claimed = new Set<string>();

  // Pass 1: survivors whose start position wasn't touched. Bias 1 so an
  // insertion exactly at the block's start shifts the tracked position
  // forward WITH the node.
  for (const entry of previous) {
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (!result.deleted) {
      mapped.set(result.pos, entry.id);
      claimed.add(entry.id);
    }
  }

  // Pass 2: boundary-churn survivors.
  for (const entry of previous) {
    if (claimed.has(entry.id)) continue;
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (mapped.has(result.pos)) continue;
    if (doc.nodeAt(result.pos)?.type.name !== 'codeBlock') continue;
    if (!survivedAsChurn(tr, entry, result.pos)) continue;
    mapped.set(result.pos, entry.id);
    claimed.add(entry.id);
  }

  return mapped;
}
