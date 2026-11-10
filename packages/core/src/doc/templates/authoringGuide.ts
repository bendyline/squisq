/**
 * Authoring guide — what an AI author is told about squisq's slides.
 *
 * Products that let a model write slides (a deck refiner choosing layouts, a
 * video director writing template blocks) used to describe the templates in
 * their own prompts, so a template added here reached none of them and a
 * lesson learned in one never reached the others. This module is the one
 * description they all render from:
 *
 * - {@link TEMPLATE_GUIDES}: for authors that write template blocks — the
 *   fields each template takes, as an author writes them, and when it earns
 *   its place. {@link templateCatalog} renders the lines a prompt lists.
 * - {@link PRESENTATION_LAYOUT_GUIDE}: for authors that fill a summary (a
 *   headline and points) and choose its layout (`PRESENTATION_LAYOUTS`).
 * - {@link AUTHORING_TRICKS}: craft that makes slides good rather than merely
 *   valid — numbers drawn as numbers, ideas drawn as pictures, reveals timed
 *   to the narration. {@link authoringTricks} selects the ones for the
 *   templates a prompt offers.
 *
 * Text may name the material a slide comes from as `{source}`; each product
 * renders it in its own word ("article", "passage"), so the guidance reads
 * naturally in either. Rules a product enforces itself (image keys, its own
 * map renders, how its beats anchor) stay in that product's prompt.
 *
 * Adding a template: give it a guide entry once an author should choose it.
 * Adding a trick: name the templates it concerns, so a prompt that offers
 * none of them leaves it out. Facts are checked separately
 * (`transform/grounding.ts`); this module only advises.
 *
 * Related: `authoringMetadata.ts` (roles and body policies for agents),
 * `metadata.ts` (labels for pickers), `transform/presentationPlan.ts`.
 */

import { PRESENTATION_LIMITS, type PresentationLayout } from '../../transform/presentationPlan.js';
import { CONCEPT_SPECS, conceptItemCount, type ConceptTemplateName } from './conceptSpecs.js';

/** How a template is offered to an author that writes template blocks. */
export interface TemplateGuide {
  /** The fields an author writes, with their limits, as a prompt lists them. */
  fields: string;
  /** When the template earns its place; omitted when the fields say it. */
  use?: string;
}

/** The templates this guide describes for block-writing authors. */
export type GuidedTemplate =
  | 'imageWithCaption'
  | 'pullQuote'
  | 'fullBleedQuote'
  | 'factCard'
  | 'dateEvent'
  | 'statHighlight'
  | 'comparisonBar'
  | 'columnChart'
  | 'barChart'
  | 'pieChart'
  | 'timeline'
  | 'diagram'
  | 'list'
  | 'photoGrid'
  | 'map'
  | 'sectionHeader'
  | 'cards'
  | 'process'
  | 'cycle'
  | 'layers'
  | 'stats'
  | 'pyramid'
  | 'funnel'
  | 'hub'
  | 'venn'
  | 'matrix';

const CHART: TemplateGuide = {
  fields: 'title, headers [label, value], rows [[label, value], …] 2–6 rows, showValues: true',
  use: 'only values the {source} states',
};

const CONCEPT_BUILD = 'build: {mode: "items"} to reveal them as they are spoken';

/**
 * A concept template's fields as a prompt lists them. The count, the order
 * and the extra inputs come from its spec (`conceptSpecs.ts`), so the guide
 * cannot ask for what the template does not take; `items` words the items
 * when "Label: detail" does not say enough.
 */
function conceptFields(template: ConceptTemplateName, items?: string): string {
  const spec = CONCEPT_SPECS[template];
  const inputs = spec.inputs ?? [];
  const form =
    spec.itemForm === 'figure-caption' ? '"Figure: what it measures"' : '"Label: detail"';
  return [
    'title',
    // What names the picture comes before its items; a switch comes after.
    ...inputs.filter((input) => input.key !== 'versus').map((input) => input.guide),
    items ??
      `items: [${form}, …] ${conceptItemCount(template)}${spec.order ? ` ${spec.order}` : ''}`,
    ...inputs.filter((input) => input.key === 'versus').map((input) => input.guide),
    CONCEPT_BUILD,
  ].join(', ');
}

/** How many points a summary slide of this layout takes: its template's count, within a slide's four. */
const points = (template: ConceptTemplateName) =>
  conceptItemCount(template, { max: PRESENTATION_LIMITS.points });

export const TEMPLATE_GUIDES: Readonly<Record<GuidedTemplate, TemplateGuide>> = {
  imageWithCaption: {
    fields:
      'imageSrc, imageAlt, caption ≤ 90 chars, ambientMotion: zoomIn|zoomOut|panLeft|panRight',
    use: "a photograph with the narration's idea as caption",
  },
  pullQuote: {
    fields: 'text, backgroundImage {src, alt}, ambientMotion',
    use: 'a VERBATIM sentence or clause from the {source} over a photograph',
  },
  fullBleedQuote: {
    fields: 'text',
    use: 'a VERBATIM short sentence from the {source}, text only',
  },
  factCard: {
    fields:
      'fact ≤ 4 words, explanation ≤ 160 chars, accentImage {src, alt, position: left-strip|right-strip}',
  },
  dateEvent: {
    fields: 'date, description ≤ 160 chars, mood: neutral|somber|celebratory, accentImage optional',
    use: 'a year or period the {source} states',
  },
  statHighlight: {
    fields:
      'stat like "98%" or "36", description ≤ 60 chars, detail ≤ 80 chars, accentImage optional',
    use: 'counts up; the number must be in the {source}',
  },
  comparisonBar: {
    fields: 'leftLabel, leftValue, rightLabel, rightValue, unit optional',
    use: 'two quantities the {source} gives in the same unit',
  },
  columnChart: CHART,
  barChart: CHART,
  pieChart: CHART,
  timeline: {
    fields:
      "title, tracks: [{ id, label, events: [{ id, label: year, position: 0..1 in date order, description ≤ 40 chars, marker: 'diamond' optional }] }]",
    use: '3–7 dated events the {source} states',
  },
  diagram: {
    fields:
      "title, nodeShape: 'pill', nodes: [{ id, label ≤ 3 words }] 3–6 nodes (no x or y: the diagram places them from the edges), edges: [{ source, target, label ≤ 3 words }]",
    use: 'relationships the {source} describes',
  },
  list: {
    fields: "title, items: 2–5 short items taken from the {source}'s own words",
  },
  photoGrid: {
    fields: 'images: [{src, alt}] × 2–4, caption ≤ 90 chars',
    use: 'several related photographs',
  },
  map: {
    fields: "center: {lat, lng}, zoom, mapStyle: 'terrain', title, ambientMotion",
    use: 'where the place is, at its first mention',
  },
  sectionHeader: {
    fields: 'title = the section title, imageSrc, imageAlt, ambientMotion',
    use: 'opens a section on a photograph',
  },
  cards: {
    fields: conceptFields('cards'),
    use: 'parallel ideas side by side, such as kinds, causes or features',
  },
  process: {
    fields: conceptFields('process'),
    use: 'ordered stages or dated events, drawn as numbered steps joined by arrows',
  },
  cycle: {
    fields: conceptFields('cycle'),
    use: 'stages that repeat in a loop, drawn on a ring',
  },
  layers: {
    fields: conceptFields('layers'),
    use: 'parts nested inside one another, drawn as concentric rings',
  },
  stats: {
    fields: conceptFields(
      'stats',
      `items: ["Figure: what it measures", …] ${conceptItemCount('stats')} such as "40%: of trips made on foot"`,
    ),
    use: 'several key numbers the {source} states, side by side; each counts up',
  },
  pyramid: {
    fields: conceptFields('pyramid'),
    use: 'a hierarchy, or levels that rest on one another, drawn as a pyramid',
  },
  funnel: {
    fields: conceptFields('funnel'),
    use: 'stages that narrow from many to few, drawn as a funnel',
  },
  hub: {
    fields: conceptFields('hub'),
    use: 'factors, causes or parts of the one thing `center` names, drawn around a hub',
  },
  venn: {
    fields: conceptFields(
      'venn',
      'items: ["A: what only A has", "B: what only B has", "Both: what they share"]',
    ),
    use: 'two things compared by what each has alone and what they share, drawn as overlapping circles',
  },
  matrix: {
    fields: conceptFields('matrix'),
    use: 'four ideas placed on two axes, such as effort against impact',
  },
};

/** How a product names things in its prompts. */
export interface GuideWording {
  /** What a slide's material is called ("article", "passage"); default "source". */
  source?: string;
}

/** `text` with `{source}` in the product's word. */
export function guideText(text: string, wording: GuideWording = {}): string {
  return text.replace(/\{source\}/gu, wording.source ?? 'source');
}

/**
 * One catalog line: a guided template, templates that share one entry
 * (`columnChart | barChart | pieChart`), or a product's own entry for a
 * template it uses its own way.
 */
export type TemplateCatalogEntry =
  | GuidedTemplate
  | { templates: readonly GuidedTemplate[] }
  | ({ template: string } & TemplateGuide);

/**
 * Catalog lines for a prompt, `- name (fields) — use`, in the order given.
 * Shared entries take the first template's guide.
 */
export function templateCatalog(
  entries: readonly TemplateCatalogEntry[],
  wording: GuideWording = {},
): string[] {
  return entries.map((entry) => {
    const [name, guide] =
      typeof entry === 'string'
        ? [entry, TEMPLATE_GUIDES[entry]]
        : 'templates' in entry
          ? [entry.templates.join(' | '), TEMPLATE_GUIDES[entry.templates[0]!]]
          : [entry.template, entry];
    const use = guide.use ? ` — ${guide.use}` : '';
    return guideText(`- ${name} (${guide.fields})${use}`, wording);
  });
}

/**
 * What each presentation layout shows, for authors that fill a headline and
 * up to four points and pick the layout. Rendered as `"layout" (guide)`.
 */
export const PRESENTATION_LAYOUT_GUIDE: Readonly<Record<PresentationLayout, string>> = {
  title: 'an opening',
  divider: 'a new topic begins; only the headline shows',
  statement: 'one idea',
  emphasis: 'one striking takeaway; only the headline shows, so keep it under 60 characters',
  quote:
    'the headline is one sentence copied word for word from the passage, without quotation marks; only the headline shows',
  stat: 'the passage’s key figure, such as 40% or $3 million, stated in the headline or a point',
  definition: 'the headline is a term and the points define it',
  list: '2–3 points',
  comparison: 'exactly 2 genuinely contrasting points',
  steps: '2–3 ordered actions',
  image: 'only when the current layout is "image"; the headline is then its caption',
  cards: `${points('cards')} parallel ideas side by side, such as kinds, causes or features`,
  process: `${points('process')} ordered stages or dated events, drawn as numbered steps joined by arrows`,
  cycle: `${points('cycle')} stages that repeat in a loop, drawn on a ring`,
  layers: `${points('layers')} parts nested inside one another, innermost first, such as a core and the layers around it, drawn as concentric rings`,
  stats: `${points('stats')} key figures the passage states, each point the number itself, then a colon and what it measures, such as "40%: of trips made on foot" or "$3 million: raised"; they count up side by side`,
  pyramid: `${points('pyramid')} levels of a hierarchy, the top first and the base last, drawn as a pyramid`,
  funnel: `${points('funnel')} stages that narrow from many to few, the widest first, drawn as a funnel`,
  hub: `${points('hub')} factors, causes or parts of one thing, drawn around a hub; add "center", that thing in 1–3 words`,
  venn: `${points('venn')} points: two things compared, each "Name: what only it has", then "Both: what they share"; drawn as overlapping circles`,
  matrix: `${points('matrix')} points placed on two axes, in reading order: top left, top right, bottom left, bottom right; add "xAxis" and "yAxis", what grows from left to right and from bottom to top`,
};

/**
 * What to call each presentation layout in a picker, and one line on what it
 * shows. Hosts that let a person choose a slide's layout render these rather
 * than keeping their own copy, so a layout added here is named everywhere.
 */
export const PRESENTATION_LAYOUT_LABELS: Readonly<
  Record<PresentationLayout, { label: string; description: string }>
> = {
  title: { label: 'Title', description: 'Opens the deck or closes it.' },
  divider: { label: 'Section break', description: 'A new topic begins; only the headline.' },
  statement: { label: 'Statement', description: 'One idea under the headline.' },
  emphasis: { label: 'Big statement', description: 'One short takeaway in display type.' },
  quote: { label: 'Quote', description: 'One sentence in the passage’s own words.' },
  stat: { label: 'Key number', description: 'One figure, large, beside what it means.' },
  definition: { label: 'Definition', description: 'A term and what it means.' },
  list: { label: 'Points', description: 'Two or three points side by side.' },
  comparison: { label: 'Comparison', description: 'Two sides set against each other.' },
  steps: { label: 'Steps', description: 'Ordered actions, numbered and joined by arrows.' },
  image: { label: 'Picture', description: 'A picture with the headline as its caption.' },
  cards: { label: 'Cards', description: 'Parallel ideas side by side.' },
  process: { label: 'Process', description: 'Ordered stages; dated ones draw as a timeline.' },
  cycle: { label: 'Cycle', description: 'Stages on a ring that comes back to its start.' },
  layers: { label: 'Layers', description: 'Nested parts as concentric rings.' },
  stats: { label: 'Key numbers', description: 'Several figures side by side, counting up.' },
  pyramid: { label: 'Pyramid', description: 'Levels of a hierarchy, the top first.' },
  funnel: { label: 'Funnel', description: 'Stages that narrow from many to few.' },
  hub: { label: 'Hub', description: 'Ideas around the one thing they share.' },
  venn: { label: 'Venn', description: 'Two sets and what they share.' },
  matrix: { label: 'Matrix', description: 'Four ideas on two axes.' },
};

/** A piece of craft an author can reuse. */
export interface AuthoringTrick {
  /** Stable id, for a product that picks tricks by name. */
  id: string;
  /** The advice for authors that write template blocks. */
  text: string;
  /**
   * The advice for authors that fill a headline and points, when it differs
   * or applies there at all.
   */
  summary?: string;
  /**
   * The advice for an author that only chooses each slide's layout, planning
   * the whole deck before its slides are worded.
   */
  storyboard?: string;
  /** Templates (or presentation layouts) it concerns; omitted when it concerns every slide. */
  templates?: readonly string[];
}

/** The first four are the ones a summary author is steered to by name. */
const DRAWN_CORE = ['cards', 'process', 'cycle', 'layers'] as const;
const DRAWN_SHAPES = ['pyramid', 'funnel', 'hub', 'venn', 'matrix'] as const;
const DRAWN = [...DRAWN_CORE, ...DRAWN_SHAPES] as const;
const NUMBERS = [
  'statHighlight',
  'stats',
  'comparisonBar',
  'columnChart',
  'barChart',
  'pieChart',
] as const;
const ACCENTED = [
  'factCard',
  'statHighlight',
  'dateEvent',
  'quote',
  'list',
  'definitionCard',
] as const;

export const AUTHORING_TRICKS: readonly AuthoringTrick[] = [
  {
    id: 'one-idea',
    text: 'One idea per slide: each slide shows what the sentence being spoken is about. Captions and labels restate its idea briefly; they never add a fact.',
  },
  {
    id: 'numbers-as-numbers',
    text: 'Draw numbers as numbers: one striking quantity → statHighlight (it counts up); two to four key quantities in different units → stats; two quantities in one unit → comparisonBar; three or more values in one unit → a chart; three to seven dated events → timeline.',
    summary:
      'Draw numbers as numbers: when the passage turns on one figure choose "stat"; when it gives two to four key figures choose "stats" and start each point with its number, as in "40%: of trips made on foot".',
    storyboard:
      'Draw numbers as numbers: a passage that turns on one figure is a "stat"; one that gives two to four key figures is "stats".',
    templates: [...NUMBERS, 'timeline'],
  },
  {
    id: 'ranges',
    text: 'A range ("3 to 7 miles deep") is not one value: never chart it as a single bar or count up to one end. Write it as the {source} gives it, on a card or in a list.',
    templates: NUMBERS,
  },
  {
    id: 'draw-ideas',
    text: 'Slides that draw their ideas explain best: several parallel ideas → cards, ordered stages → process, a loop that comes back to its start → cycle, parts nested inside one another → layers; prefer them to a list. Write each item as "Label: detail", a label of 1–4 words and a detail of at most 70 characters, in the {source}\'s own words. For dated events, start each label with its date: a process of dated stages draws as a timeline.',
    summary: `Slides that draw their ideas explain best: when the passage has several parallel ideas, ordered stages, a repeating loop or nested parts, choose ${DRAWN_CORE.map((layout) => `"${layout}"`).join(', ')} rather than "statement" or "list", and write each of their points (up to 4) as "Label: detail", a label of 1–4 words and a detail of at most 70 characters. For dated events, start each label with its date.`,
    storyboard:
      'Draw ideas rather than list them: several parallel ideas are "cards", ordered stages or dated events a "process", a loop that comes back to its start a "cycle", and parts nested inside one another "layers".',
    templates: DRAWN_CORE,
  },
  {
    id: 'draw-shapes',
    text: 'Some relationships have a shape of their own: a hierarchy or levels that rest on one another → pyramid (top first); stages that narrow from many to few → funnel (widest first); factors, causes or parts of one thing → hub, with that thing as `center`; two things and what they share → venn, its last item "Both: …"; four ideas on two axes → matrix. Choose one only when the {source} states that relationship; a shape the ideas do not have misleads.',
    summary:
      'Some relationships have a shape of their own: a hierarchy → "pyramid", stages that narrow from many to few → "funnel", factors or causes of one thing → "hub", two things and what they share → "venn" (its third point "Both: …"), four ideas on two axes → "matrix". Choose one only when the passage states that relationship; a shape the ideas do not have misleads.',
    storyboard:
      'Some relationships have a shape of their own: a hierarchy is a "pyramid", stages that narrow from many to few a "funnel", factors or causes of one thing a "hub", two things and what they share a "venn", and four ideas on two axes a "matrix". Choose one only when the passage states that relationship.',
    templates: DRAWN_SHAPES,
  },
  {
    id: 'reveal-as-spoken',
    text: 'A drawn slide can reveal its items one at a time as the narration says them (build {mode: "items"}). Put the items in the order they are spoken and let each share its key words with the sentence that says it, so every reveal lands on its words.',
    templates: DRAWN,
  },
  {
    id: 'chain-not-diagram',
    text: 'A chain — one thing leads to the next, which leads to the next — is a process, not a diagram. Keep diagrams for relationships that branch or meet: causes on the left and effects on the right, every edge labelled with the verb the {source} uses, and no edges that cross.',
    templates: ['diagram', 'process'],
  },
  {
    id: 'no-empty-frames',
    text: 'A text card on its own is small type on an empty field. Give each factCard, statHighlight, dateEvent, quote, list and definitionCard an accentImage showing what its sentence is about, and alternate the side from card to card.',
    templates: ACCENTED,
  },
  {
    id: 'motion-follows-picture',
    text: "Motion comes from the theme's motion profile; never hand-author animations. On a photograph, choose the ambientMotion the picture suggests — zoomIn toward a detail, panLeft or panRight along a skyline or coast — and alternate directions between neighbouring slides.",
    templates: ['imageWithCaption', 'pullQuote', 'sectionHeader', 'map'],
  },
  {
    id: 'vary',
    text: 'Vary the slides: when two templates fit equally well, choose the one not just shown. A long run of photo-and-caption slides is where a narrated story feels static.',
    storyboard:
      'Vary the deck: no layout on more than a third of the slides, and no two neighbouring slides alike when another layout fits as well.',
  },
];

export interface AuthoringTrickOptions {
  /** Only tricks for these templates (and tricks for every slide). */
  templates?: readonly string[];
  /** Only these tricks, in this order. */
  ids?: readonly string[];
  /**
   * Which text to render: for block authors (default), for summary authors,
   * or for an author storyboarding a deck's layouts.
   */
  surface?: 'blocks' | 'summary' | 'storyboard';
  wording?: GuideWording;
}

/**
 * The tricks a prompt should carry, rendered. With `templates`, a trick is
 * kept when it concerns every slide or one of those templates; summary and
 * storyboard authors get only tricks written for them.
 */
export function authoringTricks(options: AuthoringTrickOptions = {}): string[] {
  const offered = options.templates ? new Set(options.templates) : undefined;
  const selected = options.ids
    ? options.ids.flatMap((id) => AUTHORING_TRICKS.filter((trick) => trick.id === id))
    : AUTHORING_TRICKS;
  return selected
    .filter(
      (trick) =>
        !offered || !trick.templates || trick.templates.some((template) => offered.has(template)),
    )
    .flatMap((trick) => {
      const text =
        options.surface === 'summary'
          ? trick.summary
          : options.surface === 'storyboard'
            ? trick.storyboard
            : trick.text;
      return text ? [guideText(text, options.wording)] : [];
    });
}
