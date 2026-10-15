import { flattenRenderableBlocks, getBlockBodyText } from './markdownToDoc.js';
/** Pure build planning and evaluation, shared by interactive slides and frame export. */
import type { Block, Doc, Layer } from '../schemas/Doc.js';
import { buildNarrationScript } from '../narration/script.js';
import type { BuildCursor, BuildSpec, BuildStep, BuildTiming } from '../schemas/Build.js';
import type { MarkdownBlockNode, MarkdownList, MarkdownListItem } from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';

export interface ContentBuildPlan {
  steps: BuildStep[];
  /** List items target their own content, never their descendant list container. */
  targets: Map<MarkdownBlockNode | MarkdownListItem, number>;
}

export function planContentBuilds(
  nodes: readonly MarkdownBlockNode[],
  spec?: BuildSpec,
): ContentBuildPlan {
  const steps: BuildStep[] = [];
  const targets = new Map<MarkdownBlockNode | MarkdownListItem, number>();
  if (!spec || spec.mode === 'off') return { steps, targets };
  const add = (node: MarkdownBlockNode | MarkdownListItem, text: string, ancestors: number[]) => {
    const index = steps.length;
    steps.push({ id: `build-${index}`, text, ...(ancestors.length ? { ancestors } : {}) });
    targets.set(node, index);
    return index;
  };
  const list = (node: MarkdownList, branch?: number, ancestors: number[] = []) => {
    for (const item of node.children) {
      const own = item.children.filter((child) => child.type !== 'list');
      const grouped = spec.mode === 'branches';
      const index =
        branch ??
        add(item, extractPlainText(grouped ? item : { ...item, children: own }), ancestors);
      targets.set(item, index);
      for (const child of item.children) {
        if (child.type === 'list') list(child, grouped ? index : undefined, [...ancestors, index]);
      }
    }
  };
  for (const node of nodes) {
    if (spec.mode === 'chunks') {
      if (extractPlainText(node).trim()) add(node, extractPlainText(node), []);
    } else if (node.type === 'list') list(node);
  }
  return { steps, targets };
}

/** All targets in a block share one step index space. */
export function blockBuildSteps(block: { layers?: Layer[]; build?: BuildSpec }): BuildStep[] {
  if (!block.build || block.build.mode === 'off') return [];
  return (
    block.layers?.flatMap((layer) =>
      layer.type === 'text' ? (layer.content.buildSteps ?? []) : [],
    ) ?? []
  );
}

export function buildSourceText(steps: readonly BuildStep[]): string {
  // Preserve step boundaries and ancestry: the same prose grouped as items
  // or branches must not reuse a recording's step indices.
  return JSON.stringify(steps.map((step) => [step.text, step.ancestors ?? []]));
}

export interface BuildTimeline {
  starts: number[];
  entrance: number;
  /** A host can surface this without dropping content or extending pinned audio. */
  compressed: boolean;
}

export function resolveBuildTimeline(
  steps: readonly BuildStep[],
  spec: BuildSpec,
  duration: number,
  timing?: BuildTiming,
): BuildTimeline {
  const end = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const requested = Number.isFinite(spec.duration) ? Math.max(0, spec.duration!) : 0.4;
  let entrance = Math.min(requested, end / Math.max(4, steps.length * 2));
  const intro = Math.min(0.5, end * 0.08);
  const hold = Math.min(1.5, end * 0.2);
  const latest = Math.max(0, end - hold - entrance);
  const weights = steps.map((step) => Math.max(1, step.text.trim().split(/\s+/).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let consumed = 0;
  let previous = 0;
  const matched =
    timing?.sourceText === buildSourceText(steps) &&
    timing.starts.length === steps.length &&
    timing.starts.every(
      (time, i) => Number.isFinite(time) && time >= 0 && (i === 0 || time >= timing.starts[i - 1]!),
    );
  const starts = steps.map((_, i) => {
    const automatic = intro + (Math.max(0, latest - intro) * consumed) / Math.max(1, total);
    consumed += weights[i]!;
    // Clipped/short blocks can reveal several steps together. Every step survives.
    const limit = matched ? Math.max(0, end - Math.min(0.05, end / 4)) : latest;
    const start = Math.max(previous, Math.min(limit, matched ? timing!.starts[i]! : automatic));
    previous = start;
    return start;
  });
  if (matched && starts.length)
    entrance = Math.min(
      entrance,
      Math.max(0, end - starts[starts.length - 1]! - Math.min(0.04, end / 8)),
    );
  return { starts, entrance, compressed: steps.length > 0 && end < steps.length * 0.8 };
}

export function buildCursorAtTime(timeline: BuildTimeline, time: number): BuildCursor {
  let revealed = 0;
  for (const start of timeline.starts) {
    if (time < start) break;
    revealed++;
  }
  return {
    revealed,
    progress:
      revealed === 0
        ? 0
        : timeline.entrance === 0
          ? 1
          : Math.min(1, Math.max(0, (time - timeline.starts[revealed - 1]!) / timeline.entrance)),
  };
}

export function buildTargetState(
  index: number,
  steps: readonly BuildStep[],
  cursor: BuildCursor,
  spec: BuildSpec,
  motion = true,
) {
  const hidden = index >= cursor.revealed;
  const current = cursor.revealed - 1;
  const progress = hidden
    ? 0
    : index === current && motion && spec.effect !== 'appear'
      ? cursor.progress
      : 1;
  const eased = 1 - Math.pow(1 - progress, 3);
  const dim =
    spec.previous === 'dim' && index < current && !steps[current]?.ancestors?.includes(index);
  return {
    hidden,
    opacity: hidden ? 0 : eased * (dim ? 0.4 : 1),
    x: spec.effect === 'slideIn' ? -24 * (1 - eased) : 0,
    y: (spec.effect ?? 'fadeInUp') === 'fadeInUp' ? 16 * (1 - eased) : 0,
  };
}

/** Explicit authored times are never rewritten by this projection. */
export function hasBlockBuilds(block: Pick<Block, 'build'>): boolean {
  return !!block.build && block.build.mode !== 'off';
}

/** Align exact source passages only. Summaries without exact anchors use estimates. */
export function resolveDocBuildTiming(doc: Doc, blocks: Block[]): Block[] {
  const narration = doc.presentationNarration;
  if (!narration || !blocks.some(hasBlockBuilds)) return blocks;
  const script = doc.buildSourceText ? undefined : buildNarrationScript(doc);
  if (narration.sourceText !== (doc.buildSourceText ?? script?.sourceText)) return blocks;
  return blocks.map((block) => {
    const steps = blockBuildSteps(block);
    if (!steps.length || block.buildTiming?.sourceText === buildSourceText(steps)) return block;
    const recorded = narration.builds?.filter(
      (event) =>
        event.blockId === (block.sourceBlockId ?? block.id) &&
        event.sourceText === buildSourceText(steps),
    );
    if (recorded?.length) {
      const automatic = resolveBuildTimeline(steps, block.build!, block.duration);
      let last = 0;
      const starts = steps.map((_, step) => {
        const event = recorded.find((event) => event.step === step);
        const following = recorded
          .filter((event) => event.step > step)
          .sort((a, b) => a.step - b.step)[0];
        const estimate = Math.min(
          automatic.starts[step]!,
          following ? Math.max(0, following.time - block.startTime) : block.duration,
        );
        last = Math.max(last, event ? event.time - block.startTime : estimate);
        return last;
      });
      return { ...block, buildTiming: { sourceText: buildSourceText(steps), starts } };
    }
    const range = script?.blocks.find(
      (range) => range.blockId === (block.sourceBlockId ?? block.id),
    );
    const original = range
      ? flattenRenderableBlocks(doc.blocks).find((source) => source.id === range.blockId)
      : undefined;
    const body = original ? getBlockBodyText(original) : '';
    const charStart = range ? (body ? range.charEnd - body.length : range.charStart) : 0;
    const source =
      block.buildSource ??
      (range
        ? { text: narration.sourceText.slice(charStart, range.charEnd), charStart }
        : undefined);
    if (!source) return block;
    let cursor = 0;
    const starts: number[] = [];
    for (const step of steps) {
      const text = step.text.trim();
      const offset = text ? source.text.indexOf(text, cursor) : -1;
      if (offset < 0) return block;
      const word = narration.bookmarks.find(
        (word) =>
          word.charOffset >= source.charStart + offset &&
          word.charOffset < source.charStart + offset + text.length,
      );
      if (!word) return block;
      starts.push(Math.max(0, word.time - block.startTime));
      cursor = offset + text.length;
    }
    return { ...block, buildTiming: { sourceText: buildSourceText(steps), starts } };
  });
}
