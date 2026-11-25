/**
 * Keep accessory blocks with their section while the Write view is edited.
 *
 * An accessory block belongs to the section it sits under, and markdown
 * decides that by position alone. Three ordinary edits would quietly hand a
 * section's summaries to another section, or hide text inside them:
 *
 * - **A new heading just above the summaries** (typed at the end of the
 *   section, or a paragraph turned into a heading) makes them the new
 *   heading's. The summaries move back above it, to the end of their
 *   section's own text.
 * - **Text after the summaries** — the heading that followed them deleted,
 *   or a line added there while they are folded away — would become part of
 *   the last summary. It moves to just before the summaries, where it is the
 *   section's text.
 * - **The section's heading changing level** leaves its summaries at the
 *   wrong depth. They change level with it.
 *
 * Each repair is appended to the edit that caused it, so one undo reverts
 * both. Loads from outside, undo and redo are never repaired.
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Mapping } from '@tiptap/pm/transform';
import {
  computeAccessoryRuns,
  accessoryHeadingType,
  type AccessoryRun,
} from './accessoryBlockRuns';

/** Meta set on a repair, so it is not repaired again. */
export const ACCESSORY_REPAIR_META = 'squisqAccessoryRepair';

/** Whether a batch of transactions is one the repairs leave alone. */
export function skipsAccessoryRepairs(transactions: readonly Transaction[]): boolean {
  return (
    !transactions.some((tr) => tr.docChanged) ||
    transactions.some(
      (tr) =>
        tr.getMeta('preventUpdate') || tr.getMeta('history$') || tr.getMeta(ACCESSORY_REPAIR_META),
    )
  );
}

/**
 * One repair for this batch of edits, or null when the summaries are where
 * they belong. `collapsed` says which old runs (by `from`) were folded away.
 */
export function accessoryRunRepair(
  oldRuns: readonly AccessoryRun[],
  oldDoc: PMNode,
  mapping: Mapping,
  state: EditorState,
  collapsed: (run: AccessoryRun) => boolean,
): Transaction | null {
  const runs = computeAccessoryRuns(state.doc);
  return (
    levelRepair(oldRuns, mapping, state) ??
    ownerRepair(oldRuns, mapping, state, runs) ??
    swallowRepair(oldRuns, oldDoc, mapping, state, runs, collapsed)
  );
}

type HeadingAttrs = { level: number };

/**
 * Where a top-level heading that was at `pos` is now, found from inside its
 * text — a change to the heading itself (its level) replaces its opening
 * token, so its own start maps as deleted. Null when the heading is gone.
 */
function mapHeading(mapping: Mapping, state: EditorState, pos: number): number | null {
  // Its text survives a change to the heading itself; an empty heading's
  // only position may read as deleted on one side, so try both.
  let inner = mapping.mapResult(pos + 1, 1);
  if (inner.deleted) inner = mapping.mapResult(pos + 1, -1);
  if (inner.deleted) return null;
  const $inner = state.doc.resolve(inner.pos);
  return $inner.depth === 1 && $inner.parent.type.name === 'heading' ? $inner.before() : null;
}

/** The section's heading changed level: its summaries follow. */
function levelRepair(
  oldRuns: readonly AccessoryRun[],
  mapping: Mapping,
  state: EditorState,
): Transaction | null {
  for (const run of oldRuns) {
    if (run.parentPos === null || run.parentLevel === null) continue;
    const parentPos = mapHeading(mapping, state, run.parentPos);
    if (parentPos === null) continue;
    const node = state.doc.nodeAt(parentPos);
    if (!node || node.type.name !== 'heading' || accessoryHeadingType(node)) continue;
    const delta = (node.attrs as HeadingAttrs).level - run.parentLevel;
    if (!delta) continue;
    const from = mapping.map(run.from, 1);
    const to = mapping.map(run.to, -1);
    if (to <= from) continue;
    const headings: Array<{ pos: number; node: PMNode }> = [];
    state.doc.nodesBetween(from, to, (child, pos) => {
      if (child.type.name === 'heading') headings.push({ pos, node: child });
      return false;
    });
    const levels = headings.map(({ node: h }) => (h.attrs as HeadingAttrs).level + delta);
    if (!headings.length || levels.some((level) => level < 1 || level > 6)) continue;
    const tr = state.tr;
    headings.forEach(({ pos, node: h }, index) => {
      tr.setNodeMarkup(pos, undefined, { ...h.attrs, level: levels[index] });
    });
    return tr.setMeta(ACCESSORY_REPAIR_META, true);
  }
  return null;
}

/** A heading now sits between the summaries and their section: move them above it. */
function ownerRepair(
  oldRuns: readonly AccessoryRun[],
  mapping: Mapping,
  state: EditorState,
  runs: readonly AccessoryRun[],
): Transaction | null {
  for (const old of oldRuns) {
    const from = mapping.mapResult(old.from, 1);
    if (from.deleted) continue;
    const run = runs.find((candidate) => candidate.from === from.pos);
    if (!run) continue;
    let parentPos: number | null = null;
    if (old.parentPos !== null) {
      parentPos = mapHeading(mapping, state, old.parentPos);
      if (parentPos === null) continue;
    }
    if (run.parentPos === parentPos) continue;
    // The first heading after the old section's heading that now claims the
    // summaries: one at their level or above, between that heading and them.
    let target: number | null = null;
    state.doc.forEach((node, pos) => {
      if (target !== null || pos >= run.from) return;
      if (parentPos !== null && pos <= parentPos) return;
      if (node.type.name !== 'heading' || accessoryHeadingType(node)) return;
      if ((node.attrs as HeadingAttrs).level < run.level) target = pos;
    });
    if (target === null) continue;
    const slice = state.doc.slice(run.from, run.to);
    const tr = state.tr.delete(run.from, run.to).insert(target, slice.content);
    return tr.setMeta(ACCESSORY_REPAIR_META, true);
  }
  return null;
}

/** Text that is not a summary's ended up inside one: move it before the summaries. */
function swallowRepair(
  oldRuns: readonly AccessoryRun[],
  oldDoc: PMNode,
  mapping: Mapping,
  state: EditorState,
  runs: readonly AccessoryRun[],
  collapsed: (run: AccessoryRun) => boolean,
): Transaction | null {
  for (const old of oldRuns) {
    const from = mapping.mapResult(old.from, 1);
    if (from.deleted) continue;
    const run = runs.find((candidate) => candidate.from === from.pos);
    if (!run) continue;
    const end = mapping.map(old.to, -1);
    if (run.to <= end) continue;
    // The heading that ended the run was removed, or a line was added after
    // summaries the reader cannot see. (Typing after an open run's last
    // summary is editing that summary, and is left alone.)
    const ender = old.to < oldDoc.content.size ? oldDoc.nodeAt(old.to) : null;
    const enderRemoved =
      !!ender && ender.type.name === 'heading' && mapping.mapResult(old.to + 1).deleted;
    if (!enderRemoved && !collapsed(old)) continue;
    // Only whole top-level nodes move: `end` is where the old run's last node ends.
    const cut = end;
    if (state.doc.resolve(cut).depth !== 0) continue;
    const slice = state.doc.slice(cut, run.to);
    const { selection } = state;
    const carried = selection.from >= cut && selection.to <= run.to ? selection.from - cut : null;
    const tr = state.tr.delete(cut, run.to).insert(run.from, slice.content);
    if (carried !== null) {
      const at = Math.min(run.from + carried, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
    }
    return tr.setMeta(ACCESSORY_REPAIR_META, true);
  }
  return null;
}
