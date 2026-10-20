/**
 * Native PowerPoint lists for layer text.
 *
 * Templates hand the exporter list structure two ways: a text layer's
 * `paragraphs` (core `TextParagraph`) marks which paragraphs are list items,
 * and a `flow` (core `TextFlow`) ties a list the template split into marker
 * and body columns back into one flow. This module turns both into what an
 * Office app treats as a list — one text box whose items are real bullets
 * (`buChar`) or numbers (`buAutoNum`) with a hanging indent — rather than
 * lines that start with a typed `•`, or a shape per marker and per item.
 */

import type { Layer, TextLayer, TextParagraph } from '@bendyline/squisq/schemas';
import { EMU_PER_CANVAS_PX, resolveLayerRect } from './geometry.js';

/** One layer of a slide's stack, after its text flows are merged. */
export interface SlideLayerUnit {
  layer: Layer;
  /** Hanging indent for list paragraphs, in canvas px (a merged flow's marker column). */
  listIndentPx?: number;
}

/**
 * Collapse each text flow into one text layer over the flow's combined
 * area. The merged layer takes the flow's first layer's place in the stack
 * and the marker layers drop out; the marker column's width becomes the
 * bullets' hanging indent. A flow whose layers carry no `paragraphs` is left
 * as it is.
 */
export function mergeTextFlows(layers: readonly Layer[]): SlideLayerUnit[] {
  const flows = new Map<string, TextLayer[]>();
  for (const layer of layers) {
    if (layer.type !== 'text' || !layer.content.flow) continue;
    const members = flows.get(layer.content.flow.id) ?? [];
    members.push(layer);
    flows.set(layer.content.flow.id, members);
  }

  const units: SlideLayerUnit[] = [];
  const emitted = new Set<string>();
  for (const layer of layers) {
    const flowId = layer.type === 'text' ? layer.content.flow?.id : undefined;
    const members = flowId === undefined ? undefined : flows.get(flowId);
    const bodies = members?.filter((member) => member.content.flow?.role !== 'marker') ?? [];
    if (flowId === undefined || !members || !bodies.some((body) => body.content.paragraphs)) {
      units.push({ layer });
      continue;
    }
    if (emitted.has(flowId)) continue;
    emitted.add(flowId);

    const rects = members.map((member) => {
      const { fontSize, lineHeight } = member.content.style;
      return resolveLayerRect(
        member.position,
        Math.max(fontSize, member.content.text.length * fontSize * 0.55),
        fontSize * (lineHeight ?? 1.4),
      );
    });
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    const first = bodies[0]!;
    const indent = rects[members.indexOf(first)]!.x - left;
    units.push({
      layer: {
        ...first,
        id: flowId,
        position: { x: left, y: top, width: right - left, height: bottom - top },
        content: {
          text: bodies.map((body) => body.content.text).join('\n'),
          paragraphs: bodies.flatMap(
            (body) => body.content.paragraphs ?? [{ text: body.content.text }],
          ),
          style: first.content.style,
        },
      },
      ...(indent > 0 ? { listIndentPx: indent } : {}),
    });
  }
  return units;
}

/** How one list paragraph is bulleted. */
export interface ListParagraphPlan {
  ordered: boolean;
  /** DrawingML `lvl`, 0–8. */
  level: number;
  /** The numbering run's first number, for an ordered item. */
  startAt?: number;
}

/**
 * The bullet plan for each paragraph (`undefined` for one that is not a list
 * item). PowerPoint numbers a run of `buAutoNum` paragraphs at one level
 * from the run's `startAt`, and any change in numbering attributes starts a
 * new run, so every item of a run repeats its start. A paragraph that is not
 * a list item ends every run; a shallower item ends the deeper runs.
 */
export function planListParagraphs(
  paragraphs: readonly TextParagraph[],
): Array<ListParagraphPlan | undefined> {
  const runs: Array<{ start: number; next: number } | undefined> = [];
  return paragraphs.map(({ list }) => {
    if (!list) {
      runs.length = 0;
      return undefined;
    }
    const level = Math.min(8, Math.max(0, Math.floor(list.level)));
    runs.length = Math.min(runs.length, level + 1);
    if (!list.ordered) {
      runs[level] = undefined;
      return { ordered: false, level };
    }
    const number = list.number ?? 1;
    const run = runs[level];
    if (run && run.next === number) run.next++;
    else runs[level] = { start: number, next: number + 1 };
    return { ordered: true, level, startAt: runs[level]!.start };
  });
}

/** The `a:pPr` attributes and bullet element for a list paragraph. */
export function listParagraphXml(
  plan: ListParagraphPlan,
  indentPx: number,
): { attributes: string; bullet: string } {
  const hang = Math.round(indentPx * EMU_PER_CANVAS_PX);
  const startAt = plan.startAt && plan.startAt !== 1 ? ` startAt="${plan.startAt}"` : '';
  return {
    attributes: ` marL="${hang * (plan.level + 1)}" lvl="${plan.level}" indent="${-hang}"`,
    bullet: plan.ordered ? `<a:buAutoNum type="arabicPeriod"${startAt}/>` : `<a:buChar char="•"/>`,
  };
}
