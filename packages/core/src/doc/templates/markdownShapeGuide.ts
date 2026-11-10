/**
 * Markdown shape guide — how a Markdown author gets each drawing.
 *
 * An author who writes template blocks is told the fields (`TEMPLATE_GUIDES`);
 * one who fills a headline and points is told the layouts
 * (`PRESENTATION_LAYOUT_GUIDE`). A third kind of author writes plain Markdown
 * and lets `markdownToDoc` choose: an agent drafting a deck for a converter,
 * or a person who never learns an annotation. What they need to know is what
 * in a heading and a list makes Squisq draw a picture, and that is what this
 * module says:
 *
 * - {@link MARKDOWN_SHAPE_EXAMPLES}: one worked example per drawing, with the
 *   cue that produces it. The tests run every example through
 *   `classifyListShape`, so the guide cannot promise a drawing the classifier
 *   does not make.
 * - {@link markdownShapeGuide}: the lines a prompt or a tool description
 *   carries.
 * - {@link markdownShapeExample}: a template's example as Markdown, for a
 *   catalog entry or a "describe this template" answer.
 *
 * Related: `recommend/listShape.ts` (the classifier), `conceptSpecs.ts` (what
 * each template takes), `authoringGuide.ts` (the other two author surfaces).
 */

import { conceptItemCount, type ConceptTemplateName } from './conceptSpecs.js';

export interface MarkdownShapeExample {
  /** The template the example is drawn with. */
  template: ConceptTemplateName;
  /** What in the Markdown makes it so, as a guide line opens. */
  cue: string;
  /** What is drawn, as the guide line closes. */
  drawn: string;
  /** The same rule in a few words, for a one-paragraph summary: `[cue, drawn]`. */
  brief: readonly [cue: string, drawn: string];
  heading: string;
  items: readonly string[];
  /** Written as a numbered list. */
  ordered?: boolean;
  /** Annotation inputs the picture is better with; the list alone already draws. */
  inputs?: Readonly<Record<string, string>>;
}

export const MARKDOWN_SHAPE_EXAMPLES: readonly MarkdownShapeExample[] = [
  {
    template: 'process',
    cue: 'a numbered list',
    brief: ['a numbered list', 'steps'],
    drawn: 'numbered steps joined by arrows',
    heading: 'How a release ships',
    ordered: true,
    items: ['Draft the release notes', 'Tag and test the build', 'Roll out to everyone'],
  },
  {
    template: 'cards',
    cue: 'items written `Label: detail`',
    brief: ['`Label: detail` items', 'cards'],
    drawn: 'cards side by side',
    heading: 'Three choices for next quarter',
    items: [
      'Fund: redesign permissions setup',
      'Protect: keep the activation gains',
      'Defer: advanced mobile editing',
    ],
  },
  {
    template: 'stats',
    cue: 'items written `Figure: what it measures`',
    brief: ['`Figure: what it measures` items', 'key numbers'],
    drawn: 'key numbers that count up',
    heading: 'The quarter in numbers',
    items: ['18,420: active teams', '71%: weekly retained teams', '$3.8M: expansion revenue'],
  },
  {
    template: 'process',
    cue: 'items that open with dates in order',
    brief: ['items that open with dates', 'a timeline'],
    drawn: 'a timeline',
    heading: 'Our story',
    items: [
      '2016: founded in a Portland garage',
      '2018: first product ships',
      '2022: Berlin office opens',
    ],
  },
  {
    template: 'cycle',
    cue: 'a heading that says cycle or loop',
    brief: ['a cycle or loop heading', 'a ring'],
    drawn: 'stages on a ring',
    heading: 'The water cycle',
    items: [
      'Evaporation: the sun lifts water from the sea',
      'Condensation: vapour cools into cloud',
      'Precipitation: rain and snow fall',
    ],
  },
  {
    template: 'layers',
    cue: 'a heading that says layers or anatomy, with the innermost item first',
    brief: ['a layers or anatomy heading (innermost first)', 'rings'],
    drawn: 'concentric rings',
    heading: 'Layers of the Earth',
    items: [
      'Inner core: solid iron',
      'Outer core: liquid iron',
      'Mantle: slowly flowing rock',
      'Crust: the thin outer layer',
    ],
  },
  {
    template: 'pyramid',
    cue: 'a heading that says hierarchy, pyramid, tiers or chain of command, with the top item first',
    brief: ['a hierarchy or pyramid heading (top first)', 'a pyramid'],
    drawn: 'a pyramid',
    heading: 'The chain of command',
    items: [
      'Chief executive: sets the direction',
      'Vice presidents: turn it into plans',
      'Team leads: run the daily work',
      'Engineers: build the product',
    ],
  },
  {
    template: 'funnel',
    cue: 'a heading that says funnel or conversion, with the widest item first',
    brief: ['a funnel or conversion heading (widest first)', 'a funnel'],
    drawn: 'a funnel',
    heading: 'The sign-up funnel',
    items: ['48,000: visit the site', '6,200: start a trial', '640: become customers'],
  },
  {
    template: 'hub',
    cue: 'a heading that names factors, causes, drivers or pillars over `Label: detail` items',
    brief: ['a factors, causes or drivers heading', 'a hub'],
    drawn: 'ideas around a hub',
    heading: 'Three factors behind every delay',
    items: [
      'Scope: requirements keep changing',
      'Staffing: too few senior engineers',
      'Funding: released two months late',
    ],
    inputs: { center: 'Delays' },
  },
  {
    template: 'venn',
    cue: 'two `Name: …` items and a third `Both: …`',
    brief: ['two items and a `Both: …` item', 'a Venn diagram'],
    drawn: 'a Venn diagram',
    heading: 'Designers and engineers',
    items: [
      'Designers: research and the interface',
      'Engineers: architecture and the code',
      'Both: accessibility and testing',
    ],
  },
  {
    template: 'matrix',
    cue: 'exactly four items under a heading that says matrix or quadrants (top left, top right, bottom left, bottom right)',
    brief: ['four items under a matrix or quadrants heading', 'a two-by-two'],
    drawn: 'a two-by-two',
    heading: 'The effort and impact matrix',
    items: [
      'Quick wins: little effort, high impact',
      'Big bets: high effort, high impact',
      'Fill-ins: little effort, low impact',
      'Time sinks: high effort, low impact',
    ],
    inputs: { xAxis: 'Effort', yAxis: 'Impact' },
  },
  {
    template: 'cards',
    cue: 'two items under an `A vs B` heading',
    brief: ['two items under an `A vs B` heading', 'two panels'],
    drawn: 'two panels set against each other',
    heading: 'Self-hosting vs a managed service',
    items: ['Self-hosting: costs less, needs an engineer', 'Managed: costs more, includes backups'],
  },
];

/**
 * A template's worked example as Markdown: an annotated heading over the list
 * it draws. Annotated, so it reads as "this is how you ask for it" and keeps
 * working when the heading is changed to one that no longer names the shape.
 * `headingLevel` sets the heading's depth (2 by default; a host that makes a
 * slide of every level-one heading asks for 1).
 */
export function markdownShapeExample(
  template: ConceptTemplateName,
  options: { headingLevel?: number } = {},
): string {
  const example = MARKDOWN_SHAPE_EXAMPLES.find((entry) => entry.template === template)!;
  const hashes = '#'.repeat(Math.min(6, Math.max(1, options.headingLevel ?? 2)));
  const inputs = Object.entries(example.inputs ?? {})
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('');
  return [
    `${hashes} ${example.heading} {[${template}${inputs}]}`,
    '',
    ...example.items.map((item, index) => `${example.ordered ? `${index + 1}.` : '-'} ${item}`),
  ].join('\n');
}

/**
 * What a Markdown author is told about drawings, as prompt lines: the rule,
 * what decides each picture, how to choose one outright, and what stops a
 * list being drawn.
 */
export function markdownShapeGuide(): string[] {
  return [
    'A section whose body is one list of 2–6 short items is drawn as a picture of how they relate, with no annotation. What decides the picture:',
    ...MARKDOWN_SHAPE_EXAMPLES.map((example) => `- ${example.cue} → ${example.drawn}`),
    `To choose a picture yourself, annotate the heading: \`## Title {[funnel]}\`. A hub takes \`center="…"\` (1–3 words) and a matrix \`xAxis="…" yAxis="…"\`; a venn is exactly two sets and one \`Both: …\` item, and a matrix ${conceptItemCount('matrix')} items.`,
    'Only a list that is the whole body is drawn: a paragraph beside it, a link, an image or a seventh item keeps the section as written. Put an introduction in the heading or on the slide before. Name a shape only when the items really have it; a plain list is better than a misleading drawing.',
  ];
}
/**
 * The same guide as one paragraph, for where a prompt has a sentence or two
 * to spend (a tool's instructions, a starter prompt).
 */
export function markdownShapeSummary(): string {
  const rules = MARKDOWN_SHAPE_EXAMPLES.map(({ brief }) => `${brief[0]} → ${brief[1]}`).join('; ');
  return `A section whose body is one list of 2–6 short items is drawn as a picture of how they relate, with no annotation: ${rules}. Only a list that is the whole body is drawn, so keep any introduction in the heading or on the slide before; to choose a picture yourself, annotate the heading (\`# Title {[funnel]}\`).`;
}
