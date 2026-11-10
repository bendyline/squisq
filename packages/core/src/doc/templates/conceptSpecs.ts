/**
 * Concept specs — what each concept template takes, as data.
 *
 * The ten concept templates draw a handful of ideas, and every product that
 * lets an author choose one has to say the same things about it: how many
 * items it takes, how an item is written, what order they come in, and what
 * the template draws when it is given something else. Those facts used to be
 * restated wherever they were needed (a prompt's "3–5", a validator's table,
 * a picker's help text, each template's own fallback) and the copies drifted.
 * This module is the one statement of them:
 *
 * - {@link CONCEPT_SPECS}: per template, the items an author should write and
 *   the inputs it takes beyond them. The authoring guide renders its counts
 *   from here ({@link conceptItemCount}), so a prompt and a check agree.
 * - {@link conceptItemsProblem}: whether a set of items meets that contract,
 *   as a sentence an author or a repair prompt can act on.
 * - {@link conceptDowngrade}: what a template draws instead when it cannot
 *   draw its own picture. The templates call it, so it cannot disagree with
 *   them, and `markdownToDoc` reports it (`template-shape-unmet`).
 *
 * Pure text in, plain data out.
 *
 * Related: `conceptItems.ts` (how one item is read), `conceptBlocks.ts` and
 * `conceptShapes.ts` (the drawings), `authoringGuide.ts` (what authors are told).
 */

import {
  splitConceptItem,
  splitStatItem,
  vennOverlapIndex,
  type ConceptItem,
} from './conceptItems.js';

/** Every template that draws a handful of ideas. */
export const CONCEPT_TEMPLATES = [
  'cards',
  'process',
  'cycle',
  'layers',
  'stats',
  'pyramid',
  'funnel',
  'hub',
  'venn',
  'matrix',
] as const;
export type ConceptTemplateName = (typeof CONCEPT_TEMPLATES)[number];

/** The most ideas a concept template draws; more are shown as the list they are. */
export const CONCEPT_MAX_DRAWN = 6;

/** The longest detail a stage on a cycle's ring can hold beside it. */
const CYCLE_STAGE_CHARACTERS = 170;

/** An input a concept template takes beyond `title` and `items`. */
export interface ConceptSpecInput {
  key: string;
  /** What an author writes there, as a guide lists it. */
  guide: string;
}

export interface ConceptSpec {
  /** The fewest and the most items an author should write. */
  items: readonly [min: number, max: number];
  /** How an item is written: a label and its detail, or a figure and what it measures. */
  itemForm: 'label-detail' | 'figure-caption';
  /** The order the items are written in, when the drawing depends on it. */
  order?: string;
  /** Inputs beyond `title` and `items`. */
  inputs?: readonly ConceptSpecInput[];
}

export const CONCEPT_SPECS: Readonly<Record<ConceptTemplateName, ConceptSpec>> = {
  cards: {
    items: [2, 4],
    itemForm: 'label-detail',
    inputs: [{ key: 'versus', guide: 'versus: true for exactly two set against each other' }],
  },
  process: { items: [2, 4], itemForm: 'label-detail', order: 'in order' },
  cycle: { items: [3, 5], itemForm: 'label-detail' },
  layers: { items: [3, 5], itemForm: 'label-detail', order: 'innermost first' },
  stats: { items: [2, 4], itemForm: 'figure-caption' },
  pyramid: { items: [3, 5], itemForm: 'label-detail', order: 'from the top down' },
  funnel: { items: [3, 5], itemForm: 'label-detail', order: 'widest first' },
  hub: {
    items: [3, 6],
    itemForm: 'label-detail',
    inputs: [{ key: 'center', guide: 'center ≤ 3 words' }],
  },
  // Two sets and the item that says what they share.
  venn: { items: [3, 3], itemForm: 'label-detail' },
  matrix: {
    items: [4, 4],
    itemForm: 'label-detail',
    order: 'in reading order (top left, top right, bottom left, bottom right)',
    inputs: [
      { key: 'xAxis', guide: 'xAxis' },
      { key: 'yAxis', guide: 'yAxis' },
    ],
  },
};

/** The concept template a name denotes, or `undefined`. */
export function conceptTemplate(template: string): ConceptTemplateName | undefined {
  return CONCEPT_TEMPLATES.find((name) => name === template);
}

export interface ConceptItemsOptions {
  /**
   * The most items the author's surface holds, when that is fewer than the
   * template takes (a summary slide holds four points).
   */
  max?: number;
}

function range(template: ConceptTemplateName, options: ConceptItemsOptions): [number, number] {
  const [min, most] = CONCEPT_SPECS[template].items;
  return [min, Math.max(min, Math.min(most, options.max ?? most))];
}

/** How many items a template takes, as a guide says it: "2–4", or "exactly 4". */
export function conceptItemCount(
  template: ConceptTemplateName,
  options: ConceptItemsOptions = {},
): string {
  const [min, max] = range(template, options);
  return min === max ? `exactly ${min}` : `${min}–${max}`;
}

function itemTexts(items: readonly unknown[] | undefined): string[] {
  return (Array.isArray(items) ? items : [])
    .map((item) =>
      String(item ?? '')
        .replace(/\s+/gu, ' ')
        .trim(),
    )
    .filter(Boolean);
}

const quoted = (text: string) => `"${text.length > 48 ? `${text.slice(0, 47)}…` : text}"`;

/**
 * Why `items` do not meet a template's contract, or `undefined` when they do:
 * too few or too many, a key number without a figure, a Venn diagram without
 * the item that names what its sets share. The sentence is written for the
 * author, so a validator can log it and a repair prompt can quote it.
 */
export function conceptItemsProblem(
  template: ConceptTemplateName,
  items: readonly unknown[] | undefined,
  options: ConceptItemsOptions = {},
): string | undefined {
  const texts = itemTexts(items);
  const [min, max] = range(template, options);
  if (texts.length < min || texts.length > max)
    return `${template} takes ${conceptItemCount(template, options)} items and this has ${texts.length}`;
  if (template === 'stats') {
    const bare = texts.find((text) => !splitStatItem(text).figure);
    if (bare !== undefined)
      return `every stats item is "figure: what it measures" and ${quoted(bare)} states no figure`;
  }
  if (template === 'venn' && vennOverlapIndex(texts.map(splitConceptItem)) < 0)
    return 'venn needs one item labelled "Both:" that says what the two share';
  return undefined;
}

/**
 * A ring needs at least three stages to read as one, and its labels sit in
 * the corners the ring leaves. Two stages, or stages that run to a paragraph
 * each, draw as a process instead, whose rail has the room.
 */
export function cycleDrawsAsProcess(items: readonly ConceptItem[]): boolean {
  return items.length < 3 || items.some((item) => item.detail.length > CYCLE_STAGE_CHARACTERS);
}

/** What a concept template draws when it cannot draw its own picture, and why. */
export interface ConceptDowngrade {
  drawsAs: ConceptTemplateName | 'list';
  /** Completes "…, so it is drawn as <drawsAs>": "a matrix places exactly four items and this has three". */
  reason: string;
}

/**
 * What a template draws instead of its own picture for these items, or
 * `undefined` when it draws itself. A template never draws a broken diagram:
 * a matrix without four ideas, a Venn diagram without two sets and key
 * numbers without a figure draw as cards; a cycle too short or too wordy for
 * a ring draws as a process; more than six ideas are shown as a list.
 */
export function conceptDowngrade(
  template: ConceptTemplateName,
  items: readonly unknown[] | undefined,
): ConceptDowngrade | undefined {
  const texts = itemTexts(items);
  if (texts.length > CONCEPT_MAX_DRAWN)
    return {
      drawsAs: 'list',
      reason: `a drawing holds ${CONCEPT_MAX_DRAWN} items and this has ${texts.length}`,
    };
  const parsed = texts.map(splitConceptItem);
  const n = parsed.length;
  switch (template) {
    case 'cycle':
      if (n < 3)
        return {
          drawsAs: 'process',
          reason: `a ring needs at least three stages and this has ${n}`,
        };
      return cycleDrawsAsProcess(parsed)
        ? { drawsAs: 'process', reason: 'a stage runs too long to sit beside a ring' }
        : undefined;
    case 'layers':
    case 'pyramid':
    case 'funnel':
    case 'hub':
      return n < 2
        ? { drawsAs: 'cards', reason: `it needs at least two items and this has ${n}` }
        : undefined;
    case 'stats':
      return texts.some((text) => splitStatItem(text).figure)
        ? undefined
        : { drawsAs: 'cards', reason: 'no item states a figure' };
    case 'venn': {
      const sets = n - (vennOverlapIndex(parsed) >= 0 ? 1 : 0);
      return sets === 2
        ? undefined
        : {
            drawsAs: 'cards',
            reason: `a Venn diagram draws two sets (and one item labelled "Both:") and this has ${sets}`,
          };
    }
    case 'matrix':
      return n === 4
        ? undefined
        : { drawsAs: 'cards', reason: `a matrix places exactly four items and this has ${n}` };
    default:
      return undefined;
  }
}

/** The template that draws these items: `template` itself unless it is downgraded. */
export function conceptDrawsAs(
  template: ConceptTemplateName,
  items: readonly unknown[] | undefined,
): ConceptTemplateName | 'list' {
  return conceptDowngrade(template, items)?.drawsAs ?? template;
}
