/**
 * List shapes — what a list is a picture of.
 *
 * A bulleted list says only "here are some things". Its heading and its
 * items usually say more: that the things happen in order, come round again,
 * sit inside one another, narrow from many to few, stand against each other,
 * or are numbers. `classifyListShape` reads those signals and names the
 * relationship and the template that draws it, so a plain Markdown list can
 * become a process, a cycle, concentric layers, a pyramid, a funnel, a Venn
 * diagram, a row of key numbers — or stay a list when nothing says otherwise.
 *
 * It is deliberately a reader of evidence, not a guesser: a `strong` result
 * rests on something the author wrote (a numbered list, dates in order, a
 * heading that says "cycle", items written `Label: detail`) and is safe to
 * apply automatically; a `weak` one is only worth offering as a suggestion.
 * A drawing that misstates the relationship is worse than a list, so an
 * ordering the items do not make clear (is the first layer the core or the
 * crust?) is never applied automatically.
 *
 * Used by `markdownToDoc`'s automatic templates, the editor's template
 * recommendations, and hosts that plan slides from their own outlines.
 * Pure text in, plain data out.
 *
 * Related: `recommend/templates.ts`, `doc/templates/conceptItems.ts`,
 * `doc/templates/conceptBlocks.ts`, `doc/templates/conceptShapes.ts`.
 */

import {
  isFigureText,
  splitConceptItem,
  splitStatItem,
  timelineItems,
  vennOverlapIndex,
  type ConceptItem,
} from '../doc/templates/conceptItems.js';

/** The relationship a list's items have to one another. */
export type ListShape =
  | 'figures'
  | 'timeline'
  | 'sequence'
  | 'cycle'
  | 'nested'
  | 'hierarchy'
  | 'funnel'
  | 'contrast'
  | 'overlap'
  | 'matrix'
  | 'hub'
  | 'parallel'
  | 'plain';

export interface ListShapeInput {
  /** The heading over the list. */
  heading?: string;
  /** The items as text; write a nested item as `Label: detail`. */
  items: readonly string[];
  /** Whether the list was numbered. */
  ordered?: boolean;
  /** Prose that introduces the list, when there is some. */
  intro?: string;
}

export interface ListShapeResult {
  shape: ListShape;
  /** The template that draws the shape. */
  template: string;
  /**
   * `strong`: the author's own words or structure say so; apply it.
   * `weak`: plausible; offer it, but leave the choice to a person.
   */
  confidence: 'strong' | 'weak';
  /** Inputs the template needs beyond the items (a reversed order, `versus`). */
  inputs?: Record<string, unknown>;
  /** What the classification rests on, for a tooltip or a log. */
  reason: string;
}

/** The most ideas a concept template draws; a longer list stays a list. */
const MAX_IDEAS = 6;
/** Past this an item is a paragraph, not an idea a diagram can hold. */
const MAX_IDEA_CHARACTERS = 170;

/** "Cycle" as a loop, not a bicycle ("cycle track", "cycle lanes"). */
const CYCLE_CUE =
  /\b(?:cycles?(?!\s+(?:tracks?|lanes?|paths?|routes?|hire|shops?|parking|helmets?))|cyclical|loops?|recurring|rinse and repeat|virtuous circle|vicious circle)\b/iu;
/** Prose around the list that says the sequence comes round again. */
const CYCLE_INTRO =
  /\b(?:repeats? itself|(?:cycle|process|sequence|pattern|it|this|which) (?:then |all )?repeats?|over and over|again and again|feedback loop|comes? full circle|round and round)\b/iu;
const CYCLE_CLOSE =
  /\b(?:repeats?|again|back to|returns? to|starts? over|begins? again|the cycle|full circle)\b/iu;
const NESTED_CUE =
  /\b(?:layers?|anatomy|cross[- ]section|strata|shells?|nested|concentric|zones?|inside (?:the|an?)\b)/iu;
const INNERMOST = /\b(?:inner(?:most)?|core|cent(?:er|re)|nucleus|heart|kernel)\b/iu;
const OUTERMOST =
  /\b(?:outer(?:most)?|crust|surface|skin|shell|exosphere|atmosphere|bark|rind|periphery|edge)\b/iu;
const HIERARCHY_CUE =
  /\b(?:hierarch(?:y|ies)|pyramids?|tiers?|levels? of|ranks?|chain of command|food chain|pecking order|priorit(?:y|ies)|maslow)\b/iu;
/** Cues that by convention list the top first. */
const TOP_FIRST_CUE = /\b(?:chain of command|pecking order|priorit(?:y|ies)|ranks?|food chain)\b/iu;
const APEX = /\b(?:top|highest|peak|apex|summit|chief|executive|president|king|queen|ceo)\b/iu;
const BASE = /\b(?:base|bottom|foundation(?:al)?|basic|lowest|ground|bedrock|physiological)\b/iu;
const FUNNEL_CUE =
  /\b(?:funnels?|conversion|drop[- ]?off|narrow(?:s|ing|ed)? down|winnow(?:s|ing|ed)?|whittl(?:e|es|ing|ed) down|filter(?:s|ing|ed)?(?: down)?|sieve)\b/iu;
const SEQUENCE_CUE =
  /\b(?:steps?|how to|process(?:es)?|stages?|phases?|procedure|workflow|instructions?|journey|roadmap|pathway|sequence|walkthrough)\b/iu;
const ORDINAL_OPENER =
  /^(?:(?:first|second|third|fourth|fifth)(?:ly)?|then|next|after(?:wards| that)?|finally|lastly|step \d+)\b/iu;
const CONTRAST_CUE =
  /\b(?:vs\.?|versus|compared (?:to|with)|comparison|differences? between|contrast)\b|\bor\b[^?]*\?/iu;
/** Label pairs that are a contrast whatever the heading says. */
const OPPOSITES: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/^before$/iu, /^after$/iu],
  [/^then$/iu, /^now$/iu],
  [/^pros?$/iu, /^cons?$/iu],
  [/^advantages?$/iu, /^disadvantages?$/iu],
  [/^strengths?$/iu, /^weakness(?:es)?$/iu],
  [/^benefits?$/iu, /^(?:risks?|costs?|drawbacks?)$/iu],
  [/^(?:risks?|costs?)$/iu, /^(?:benefits?|rewards?)$/iu],
  [/^old$/iu, /^new$/iu],
  [/^myth$/iu, /^(?:fact|reality|truth)$/iu],
  [/^expectations?$/iu, /^reality$/iu],
  [/^problem$/iu, /^solution$/iu],
  [/^causes?$/iu, /^effects?$/iu],
  [/^do$/iu, /^don[’']?t$/iu],
  [/^with$/iu, /^without$/iu],
  [/^for$/iu, /^against$/iu],
];
const OVERLAP_CUE = /\b(?:overlap(?:s|ping)?|in common|venn|intersection|common ground)\b/iu;
const MATRIX_CUE =
  /\b(?:matrix|quadrants?|2\s?[x×]\s?2|two[- ]by[- ]two|four[- ]box|eisenhower|swot)\b/iu;
const HUB_CUE =
  /\b(?:factors?|causes?|drivers?|pillars?|elements?|components?|ingredients?|principles?|dimensions?|aspects?|forces?|contributors?|building blocks|parts of|sources of|reasons?)\b/iu;

/** A four-digit year standing alone ("1796", "1990s"), which is a date and not a quantity. */
const YEAR_LIKE = /^(?:1\d{3}|20\d{2})s?$/u;

/** The leading figure's value, for telling a narrowing series ("10,000 … 1,200 … 300"). */
function figureValue(figure: string): number {
  const match = figure.replace(/,/gu, '').match(/\d+(?:\.\d+)?/u);
  if (!match) return NaN;
  const scale = /\b(?:trillion)\b/iu.test(figure)
    ? 1e12
    : /\b(?:billion)\b|\dB\b/u.test(figure)
      ? 1e9
      : /\b(?:million)\b|\dM\b/u.test(figure)
        ? 1e6
        : /\b(?:thousand)\b|\d[Kk]\b/u.test(figure)
          ? 1e3
          : 1;
  return Number(match[0]) * scale;
}

function result(
  shape: ListShape,
  template: string,
  confidence: ListShapeResult['confidence'],
  reason: string,
  inputs?: Record<string, unknown>,
): ListShapeResult {
  return { shape, template, confidence, reason, ...(inputs ? { inputs } : {}) };
}

const PLAIN = (reason: string) => result('plain', 'list', 'strong', reason);

/** Whether two labels are a known pair of opposites, in either order. */
function opposites(a: string, b: string): boolean {
  const [x, y] = [a.trim(), b.trim()];
  return OPPOSITES.some(
    ([left, right]) => (left.test(x) && right.test(y)) || (left.test(y) && right.test(x)),
  );
}

/**
 * Name the relationship among a list's items and the template that draws it.
 * A list no concept template can hold (one item, more than six, or items the
 * length of paragraphs) is `plain`.
 */
export function classifyListShape(input: ListShapeInput): ListShapeResult {
  const texts = input.items.map((item) => item.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  if (texts.length < 2) return PLAIN('fewer than two items');
  if (texts.length > MAX_IDEAS) return PLAIN(`more than ${MAX_IDEAS} items`);
  if (texts.some((text) => text.length > MAX_IDEA_CHARACTERS)) return PLAIN('items run long');
  const items: ConceptItem[] = texts.map(splitConceptItem);
  const n = items.length;
  const heading = (input.heading ?? '').replace(/\s+/gu, ' ').trim();
  const context = `${heading} ${input.intro ?? ''}`;
  const labelled = items.filter((item) => item.label).length;
  const first = `${items[0]!.label} ${items[0]!.detail}`;
  const last = `${items[n - 1]!.label} ${items[n - 1]!.detail}`;

  // Dated items in order are a timeline, whatever else they look like.
  if (timelineItems(items))
    return result('timeline', 'process', 'strong', 'items open with dates in order');

  // Every item a figure and what it measures.
  const stats = texts.map(splitStatItem);
  const figures = stats.map((stat) => stat.figure);
  const allFigures = figures.every(Boolean) && !figures.every((figure) => YEAR_LIKE.test(figure));
  if (allFigures) {
    const values = figures.map(figureValue);
    const narrowing =
      n >= 3 && values.every((value, index) => index === 0 || value < values[index - 1]!);
    if (narrowing && (FUNNEL_CUE.test(context) || SEQUENCE_CUE.test(context) || input.ordered))
      return result('funnel', 'funnel', 'strong', 'figures that shrink stage by stage');
    // Written as "Figure: what it measures", or figures with a scale: key numbers.
    const explicit = texts.every((text) => {
      const { label, detail } = splitConceptItem(text);
      return !!label && (isFigureText(label) || isFigureText(detail));
    });
    const scaled = figures.every((figure) =>
      /[%‰$€£¥×,]|\d\s?(?:[xKMB]|million|billion|trillion|thousand|percent)\b|\s(?:in|of)\s\d/iu.test(
        figure,
      ),
    );
    if (n <= 6 && (explicit || scaled))
      return result('figures', 'stats', 'strong', 'every item is a figure and what it measures');
  }

  if (vennOverlapIndex(items) >= 0 && n === 3)
    return result('overlap', 'venn', 'strong', 'two sets and an item naming what they share');

  if (n === 2 && items.every((item) => item.label) && opposites(items[0]!.label, items[1]!.label))
    return result('contrast', 'cards', 'strong', 'two items labelled as opposites', {
      versus: true,
    });

  if (
    n >= 3 &&
    (CYCLE_CUE.test(heading) ||
      CYCLE_INTRO.test(input.intro ?? '') ||
      (CYCLE_CLOSE.test(last) && (input.ordered || SEQUENCE_CUE.test(context))))
  )
    return result(
      'cycle',
      'cycle',
      'strong',
      'the heading or the last item says it comes round again',
    );

  if (n === 4 && MATRIX_CUE.test(context))
    return result('matrix', 'matrix', 'strong', 'four items under a heading that names a matrix');

  if (n >= 3 && FUNNEL_CUE.test(context))
    return result('funnel', 'funnel', 'strong', 'the heading says the stages narrow');

  if (n >= 3 && NESTED_CUE.test(context)) {
    // Layers draw innermost first; only an order the items make clear is applied.
    if (INNERMOST.test(first) && !INNERMOST.test(last))
      return result('nested', 'layers', 'strong', 'nested parts, listed from the inside out');
    if (INNERMOST.test(last) && (OUTERMOST.test(first) || !INNERMOST.test(first)))
      return result('nested', 'layers', 'strong', 'nested parts, listed from the outside in', {
        items: [...texts].reverse(),
      });
    return result('nested', 'layers', 'weak', 'the heading suggests nested parts');
  }

  if (n >= 3 && HIERARCHY_CUE.test(context)) {
    // A pyramid draws its apex first.
    if (BASE.test(first) && !BASE.test(last))
      return result('hierarchy', 'pyramid', 'strong', 'a hierarchy, listed from the base up', {
        items: [...texts].reverse(),
      });
    if (APEX.test(first) || BASE.test(last) || TOP_FIRST_CUE.test(context))
      return result('hierarchy', 'pyramid', 'strong', 'a hierarchy, listed from the top down');
    return result('hierarchy', 'pyramid', 'weak', 'the heading suggests a hierarchy');
  }

  if (n === 2 && CONTRAST_CUE.test(heading))
    return result('contrast', 'cards', 'strong', 'two items under a heading that compares them', {
      versus: true,
    });

  if (n === 2 && OVERLAP_CUE.test(context))
    return result('overlap', 'venn', 'weak', 'the heading suggests two sets that overlap');

  const openers = texts.filter((text) => ORDINAL_OPENER.test(text)).length;
  if (input.ordered || openers >= 2 || SEQUENCE_CUE.test(heading))
    return result(
      'sequence',
      'process',
      'strong',
      input.ordered
        ? 'a numbered list'
        : openers >= 2
          ? 'items open with ordering words'
          : 'the heading names steps',
    );

  const brief = texts.every((text) => text.length <= 110);
  if (n >= 3 && brief && HUB_CUE.test(heading) && labelled * 2 >= n)
    return result(
      'hub',
      'hub',
      'strong',
      'labelled items under a heading that names what they share',
    );

  if (labelled * 3 >= n * 2)
    return result('parallel', 'cards', 'strong', 'items written as a label and its detail');

  if (n >= 3 && brief && HUB_CUE.test(heading))
    return result('hub', 'hub', 'weak', 'the heading names what the items share');
  if (n <= 4 && texts.every((text) => text.length <= 90))
    return result('parallel', 'cards', 'weak', 'a few short items');
  return PLAIN('no relationship the items make clear');
}

/** What says whether a relationship holds: the heading, the prose, the items. */
export interface ShapeEvidence {
  /** The heading over the ideas. */
  heading?: string;
  /** The prose the ideas summarize or sit under. */
  passage?: string;
  /** The ideas as they would be drawn. */
  items: readonly string[];
  /** A matrix's axis names; naming both says what its panels are placed on. */
  axes?: readonly [x?: string, y?: string];
}

/** Prose that says two things have something in common. */
const SHARED_CUE = /\b(?:both|shared?|shares|sharing|alike|similar(?:ly|ity|ities)?|in common)\b/iu;

/**
 * Whether the source says its ideas have the relationship `template` draws.
 *
 * `classifyListShape` chooses a drawing for a list; this is the other
 * direction, for an author (a model, usually) that has already chosen one.
 * Cards, a process, a hub and key numbers claim little beyond what their
 * items say, so they always pass. The shapes that assert how the ideas
 * relate need the source to say so, in the heading, the prose or the items:
 *
 * - `cycle`: it comes round again ("cycle", "loop", "the cycle repeats");
 * - `layers`: the parts are nested ("layers", "anatomy", a core and a crust);
 * - `pyramid`: there is a hierarchy ("hierarchy", "tiers", a top and a base);
 * - `funnel`: the stages narrow ("funnel", "conversion"), or their figures shrink;
 * - `venn`: the two share something ("both", "in common", "overlap");
 * - `matrix`: two named axes, or a source that calls it a matrix.
 *
 * A drawing that misstates the relationship is worse than cards, so a caller
 * that gets `false` should draw the ideas as cards (or a process) instead.
 */
export function shapeIsStated(template: string, evidence: ShapeEvidence): boolean {
  const heading = (evidence.heading ?? '').replace(/\s+/gu, ' ').trim();
  const passage = (evidence.passage ?? '').replace(/\s+/gu, ' ').trim();
  const texts = evidence.items.map((item) => item.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  const context = `${heading} ${passage}`;
  const everything = `${context} ${texts.join(' ')}`;
  switch (template) {
    case 'cycle':
      return (
        CYCLE_CUE.test(context) ||
        CYCLE_INTRO.test(passage) ||
        (texts.length > 0 && CYCLE_CLOSE.test(texts[texts.length - 1]!))
      );
    case 'layers':
      return NESTED_CUE.test(context) || (INNERMOST.test(everything) && OUTERMOST.test(everything));
    case 'pyramid':
      return HIERARCHY_CUE.test(context) || (APEX.test(everything) && BASE.test(everything));
    case 'funnel': {
      if (FUNNEL_CUE.test(context)) return true;
      const values = texts.map((text) => figureValue(splitStatItem(text).figure));
      return (
        values.length >= 3 &&
        values.every(
          (value, index) => Number.isFinite(value) && (!index || value < values[index - 1]!),
        )
      );
    }
    case 'venn':
      return OVERLAP_CUE.test(context) || SHARED_CUE.test(passage);
    case 'matrix':
      return (
        MATRIX_CUE.test(context) || (!!evidence.axes?.[0]?.trim() && !!evidence.axes[1]?.trim())
      );
    default:
      return true;
  }
}

/** What to draw instead when the source does not state a shape: the same ideas, claiming less. */
export function unstatedShapeFallback(template: string): 'cards' | 'process' | undefined {
  switch (template) {
    case 'cycle':
    case 'funnel':
      return 'process';
    case 'layers':
    case 'pyramid':
    case 'venn':
    case 'matrix':
      return 'cards';
    default:
      return undefined;
  }
}
