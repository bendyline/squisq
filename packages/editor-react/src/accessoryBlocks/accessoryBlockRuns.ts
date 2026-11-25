/**
 * Accessory block runs in the Write view's document.
 *
 * Write keeps headings and paragraphs as top-level siblings, so a section's
 * accessory blocks (`### Headline {[summary]}` and what is under each) are a
 * range of top-level nodes: each runs from its heading to the next heading at
 * its level or shallower, and consecutive ones form one run — what the view
 * folds into a single "Slide summaries (3)" row.
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import { isAccessoryBlockType } from '@bendyline/squisq/doc';

/** One accessory block within a run: its heading, and where it ends. */
export interface AccessoryRunBlock {
  /** Position of its heading. */
  pos: number;
  /** Position just after its last node. */
  end: number;
  level: number;
  type: string;
}

export interface AccessoryRun {
  /** Position of the first accessory heading. */
  from: number;
  /** Position just after the run's last node. */
  to: number;
  /** Level of the first accessory heading. */
  level: number;
  blocks: AccessoryRunBlock[];
  /** Position of the heading the run is about; null when it is at the top. */
  parentPos: number | null;
  /** That heading's level, when there is one. */
  parentLevel: number | null;
  /** Names the run across edits: its parent heading's place, and its order under it. */
  key: string;
}

type HeadingAttrs = { level: number; dataTemplate?: string | null };

/** The accessory type a top-level node's heading names, if it is one. */
export function accessoryHeadingType(node: PMNode | null | undefined): string | null {
  if (!node || node.type.name !== 'heading') return null;
  const template = (node.attrs as HeadingAttrs).dataTemplate;
  return isAccessoryBlockType(template) ? template : null;
}

/** Every accessory run in the document, in order. */
export function computeAccessoryRuns(doc: PMNode): AccessoryRun[] {
  const nodes: Array<{ node: PMNode; pos: number }> = [];
  doc.forEach((node, pos) => nodes.push({ node, pos }));
  const runs: AccessoryRun[] = [];
  const ordinals = new Map<string, number>();
  /** Count of real headings seen so far; names a run's parent stably. */
  let headingIndex = -1;
  /** Real headings seen so far, for finding a run's parent. */
  const realHeadings: Array<{ pos: number; level: number; index: number }> = [];

  let i = 0;
  while (i < nodes.length) {
    const { node, pos } = nodes[i]!;
    const type = accessoryHeadingType(node);
    if (!type) {
      if (node.type.name === 'heading') {
        headingIndex += 1;
        realHeadings.push({ pos, level: (node.attrs as HeadingAttrs).level, index: headingIndex });
      }
      i += 1;
      continue;
    }

    const level = (node.attrs as HeadingAttrs).level;
    const blocks: AccessoryRunBlock[] = [];
    let j = i;
    while (j < nodes.length) {
      const head = nodes[j]!;
      const headType = accessoryHeadingType(head.node);
      if (!headType) break;
      const headLevel = (head.node.attrs as HeadingAttrs).level;
      let k = j + 1;
      while (
        k < nodes.length &&
        !(
          nodes[k]!.node.type.name === 'heading' &&
          (nodes[k]!.node.attrs as HeadingAttrs).level <= headLevel
        )
      ) {
        k += 1;
      }
      const end = k < nodes.length ? nodes[k]!.pos : doc.content.size;
      // Headings nested inside an accessory block are part of it.
      blocks.push({ pos: head.pos, end, level: headLevel, type: headType });
      j = k;
    }

    let parent: { pos: number; level: number; index: number } | undefined;
    for (let h = realHeadings.length - 1; h >= 0; h--) {
      if (realHeadings[h]!.level < level) {
        parent = realHeadings[h];
        break;
      }
    }
    const parentKey = parent ? `h${parent.index}` : 'top';
    const ordinal = (ordinals.get(parentKey) ?? 0) + 1;
    ordinals.set(parentKey, ordinal);
    runs.push({
      from: pos,
      to: blocks[blocks.length - 1]!.end,
      level,
      blocks,
      parentPos: parent?.pos ?? null,
      parentLevel: parent?.level ?? null,
      key: `${parentKey}:${ordinal}`,
    });
    i = j;
  }
  return runs;
}

/** The run containing document position `pos`. */
export function accessoryRunAt(
  runs: readonly AccessoryRun[],
  pos: number,
): AccessoryRun | undefined {
  return runs.find((run) => pos >= run.from && pos < run.to);
}

/** The run, if any, that ends the document. */
export function documentFinalAccessoryRun(doc: PMNode): AccessoryRun | null {
  const runs = computeAccessoryRuns(doc);
  const last = runs[runs.length - 1];
  return last && last.to === doc.content.size ? last : null;
}
