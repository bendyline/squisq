import { describe, expect, it } from 'vitest';
import {
  CONCEPT_MAX_DRAWN,
  CONCEPT_SPECS,
  CONCEPT_TEMPLATES,
  conceptDowngrade,
  conceptDrawsAs,
  conceptItemCount,
  conceptItemsProblem,
  type ConceptTemplateName,
} from '../doc/templates/conceptSpecs.js';
import {
  MARKDOWN_SHAPE_EXAMPLES,
  markdownShapeExample,
  markdownShapeGuide,
  markdownShapeSummary,
} from '../doc/templates/markdownShapeGuide.js';
import {
  PRESENTATION_LAYOUT_GUIDE,
  TEMPLATE_GUIDES,
  expandDocBlocks,
  templateRegistry,
} from '../doc/templates/index.js';
import { TEMPLATE_INPUT_DESCRIPTORS } from '../doc/templates/inputDescriptors.js';
import { readMatrixItems } from '../doc/templates/conceptItems.js';
import { classifyListShape } from '../recommend/listShape.js';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { parseMarkdown } from '../markdown/index.js';
import { PRESENTATION_LIMITS, presentationLayoutFits } from '../transform/presentationPlan.js';
import type { TemplateBlock } from '../schemas/BlockTemplates.js';

const ideas = (count: number) =>
  [
    'Alpha: one',
    'Beta: two',
    'Gamma: three',
    'Delta: four',
    'Epsilon: five',
    'Zeta: six',
    'Eta: seven',
  ].slice(0, count);

/** What a block of `items` draws, as comparable data. */
function drawing(template: string, items: string[]): string {
  const block = { id: 'b', template, duration: 5, audioSegment: 0, title: 'T', items };
  const [expanded] = expandDocBlocks([block as unknown as TemplateBlock]);
  return JSON.stringify(expanded?.layers ?? []);
}

describe('concept specs', () => {
  it('specifies every concept template, each a registered one', () => {
    expect(Object.keys(CONCEPT_SPECS).sort()).toEqual([...CONCEPT_TEMPLATES].sort());
    for (const template of CONCEPT_TEMPLATES) {
      expect(templateRegistry).toHaveProperty(template);
      const [min, max] = CONCEPT_SPECS[template].items;
      expect(min).toBeGreaterThanOrEqual(2);
      expect(max).toBeGreaterThanOrEqual(min);
      expect(max).toBeLessThanOrEqual(CONCEPT_MAX_DRAWN);
      // An input the spec lists is one the annotation grammar accepts.
      const described = (TEMPLATE_INPUT_DESCRIPTORS[template] ?? []).map((input) => input.key);
      for (const input of CONCEPT_SPECS[template].inputs ?? [])
        expect(described, `${template}.${input.key}`).toContain(input.key);
    }
  });

  it('gives the guides their counts, so a prompt and a check cannot disagree', () => {
    expect(conceptItemCount('cards')).toBe('2–4');
    expect(conceptItemCount('hub')).toBe('3–6');
    expect(conceptItemCount('matrix')).toBe('exactly 4');
    // A summary slide holds four points, whatever the template would take.
    expect(conceptItemCount('hub', { max: PRESENTATION_LIMITS.points })).toBe('3–4');
    for (const template of CONCEPT_TEMPLATES) {
      // A Venn diagram's guide spells its three items out instead of counting them.
      if (template !== 'venn')
        expect(TEMPLATE_GUIDES[template].fields, template).toContain(conceptItemCount(template));
      const summary = conceptItemCount(template, { max: PRESENTATION_LIMITS.points });
      expect(PRESENTATION_LAYOUT_GUIDE[template].startsWith(summary), template).toBe(true);
      // No summary guide asks for more points than a slide holds.
      expect(PRESENTATION_LAYOUT_GUIDE[template]).not.toMatch(/\b[2-4]–[5-9]\b/u);
    }
    expect(TEMPLATE_GUIDES.hub.fields).toContain('center ≤ 3 words');
    expect(TEMPLATE_GUIDES.matrix.fields).toContain('xAxis, yAxis');
    expect(TEMPLATE_GUIDES.cards.fields).toContain('versus: true');
    expect(TEMPLATE_GUIDES.layers.fields).toContain('innermost first');
  });

  it('says why items do not meet a template’s contract', () => {
    expect(conceptItemsProblem('cards', ideas(3))).toBeUndefined();
    expect(conceptItemsProblem('cards', ideas(1))).toBe('cards takes 2–4 items and this has 1');
    expect(conceptItemsProblem('matrix', ideas(3))).toBe(
      'matrix takes exactly 4 items and this has 3',
    );
    expect(conceptItemsProblem('hub', ideas(6))).toBeUndefined();
    expect(conceptItemsProblem('hub', ideas(6), { max: 4 })).toBe(
      'hub takes 3–4 items and this has 6',
    );
    expect(conceptItemsProblem('stats', ['40%: of trips on foot', 'Riders: more each year'])).toBe(
      'every stats item is "figure: what it measures" and "Riders: more each year" states no figure',
    );
    expect(
      conceptItemsProblem('stats', ['40%: of trips on foot', '3 in 5: cycle weekly']),
    ).toBeUndefined();
    expect(conceptItemsProblem('venn', ideas(3))).toMatch(/labelled "Both:"/u);
    expect(
      conceptItemsProblem('venn', ['Cats: independent', 'Dogs: loyal', 'Both: good company']),
    ).toBeUndefined();
    // Blank items are not items.
    expect(conceptItemsProblem('cards', ['One: a', '  ', 'Two: b'])).toBeUndefined();
  });

  it('is the same test a summary layout is held to', () => {
    for (const template of CONCEPT_TEMPLATES) {
      for (const count of [1, 2, 3, 4]) {
        const points = ideas(count);
        expect(
          presentationLayoutFits(template, 'Headline', points, ''),
          `${template} ${count}`,
        ).toBe(
          conceptItemsProblem(template, points, { max: PRESENTATION_LIMITS.points }) === undefined,
        );
      }
    }
  });

  it('names what a template draws when it cannot draw its own picture', () => {
    expect(conceptDowngrade('matrix', ideas(4))).toBeUndefined();
    expect(conceptDowngrade('matrix', ideas(3))).toEqual({
      drawsAs: 'cards',
      reason: 'a matrix places exactly four items and this has 3',
    });
    expect(conceptDrawsAs('venn', ['Cats: independent', 'Dogs: loyal'])).toBe('venn');
    expect(conceptDrawsAs('venn', ideas(4))).toBe('cards');
    expect(conceptDrawsAs('stats', ideas(3))).toBe('cards');
    expect(conceptDrawsAs('cycle', ideas(2))).toBe('process');
    expect(conceptDrawsAs('cycle', ['A: ' + 'word '.repeat(40), 'B: two', 'C: three'])).toBe(
      'process',
    );
    expect(conceptDrawsAs('pyramid', ideas(1))).toBe('cards');
    expect(conceptDrawsAs('hub', ideas(7))).toBe('list');
    expect(conceptDrawsAs('cards', ideas(5))).toBe('cards');
  });

  it('agrees with the templates, which ask it', () => {
    const cases: Array<[ConceptTemplateName, string[]]> = [
      ['matrix', ideas(3)],
      ['matrix', ideas(4)],
      ['venn', ideas(4)],
      ['venn', ['Cats: independent', 'Dogs: loyal', 'Both: good company']],
      ['stats', ideas(3)],
      ['stats', ['40%: on foot', '12: routes']],
      ['cycle', ideas(2)],
      ['cycle', ideas(4)],
      ['layers', ideas(1)],
      ['pyramid', ideas(1)],
      ['funnel', ideas(3)],
      ['hub', ideas(1)],
    ];
    for (const [template, items] of cases) {
      const own = drawing(template, items);
      const drawsAs = conceptDrawsAs(template, items);
      if (drawsAs !== template) {
        // A downgrade is drawn exactly as the template it names.
        expect(own, `${template} ${items.length}`).toBe(drawing(drawsAs, items));
      } else {
        for (const other of ['cards', 'process'])
          if (other !== template)
            expect(own, `${template} ${items.length} is not ${other}`).not.toBe(
              drawing(other, items),
            );
      }
    }
  });

  it('reports a shape an author asked for and did not get', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        [
          '# Effort against impact {[matrix]}',
          '',
          '- Quick wins: guided setup',
          '- Big bets: permissions redesign',
          '- Fill-ins: copy fixes',
          '',
          '# Mobile and desktop {[venn]}',
          '',
          '- Mobile: quick capture',
          '- Desktop: deep editing',
          '- Both: the same documents',
          '',
          '# Our numbers {[stats]}',
          '',
          '- Growth: steady',
          '- Churn: falling',
          '',
          '# Just a heading {[matrix]}',
        ].join('\n'),
      ),
      { generateCoverBlock: false },
    );
    const unmet = (doc.diagnostics ?? []).filter((d) => d.code === 'template-shape-unmet');
    expect(unmet.map((d) => d.message)).toEqual([
      'Block "effort-against-impact" asks for matrix but is drawn as cards: a matrix places exactly four items and this has 3',
      'Block "our-numbers" asks for stats but is drawn as cards: no item states a figure',
    ]);
    expect(unmet[0]).toMatchObject({
      severity: 'warning',
      blockId: 'effort-against-impact',
      line: 1,
    });
  });
});

describe('a matrix read from its items', () => {
  const quadrants = [
    'Quick wins: little effort, high impact',
    'Big bets: a lot of effort, high impact',
    'Fill-ins: little effort, low impact',
    'Time sinks: a lot of effort, low impact',
  ];
  it('names the axes and keeps items that are already in place', () => {
    expect(readMatrixItems(quadrants)).toEqual({
      xAxis: 'Effort',
      yAxis: 'Impact',
      items: quadrants,
      reordered: false,
    });
    // The same panels with impact along the foot are also in reading order.
    const turned = [quadrants[3]!, quadrants[1]!, quadrants[2]!, quadrants[0]!];
    expect(readMatrixItems(turned)).toMatchObject({
      xAxis: 'Impact',
      yAxis: 'Effort',
      reordered: false,
    });
  });
  it('places items written in another order, and declines what does not place itself', () => {
    const shuffled = [quadrants[1]!, quadrants[3]!, quadrants[0]!, quadrants[2]!];
    expect(readMatrixItems(shuffled)).toMatchObject({ reordered: true });
    expect(readMatrixItems(shuffled)?.items.map((item) => item.split(':')[0])).toEqual(
      readMatrixItems(shuffled)!.xAxis === 'Effort'
        ? ['Quick wins', 'Big bets', 'Fill-ins', 'Time sinks']
        : ['Fill-ins', 'Quick wins', 'Time sinks', 'Big bets'],
    );
    expect(readMatrixItems(quadrants.slice(0, 3))).toBeUndefined();
    expect(readMatrixItems(['A: one', 'B: two', 'C: three', 'D: four'])).toBeUndefined();
    // Two items claiming the same corner do not make a matrix.
    expect(
      readMatrixItems([quadrants[0]!, quadrants[0]!, quadrants[2]!, quadrants[3]!]),
    ).toBeUndefined();
  });
  it('gives an annotated or auto-drawn Markdown matrix its axes', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        ['# The effort and impact matrix', '', ...quadrants.map((item) => `- ${item}`)].join('\n'),
      ),
      { generateCoverBlock: false },
    );
    const [block] = flattenRenderableBlocks(doc.blocks);
    expect(block?.template).toBe('matrix');
    expect(block?.templateData).toMatchObject({ xAxis: 'Effort', yAxis: 'Impact' });
  });
});

describe('markdown shape guide', () => {
  it('promises only drawings the classifier makes', () => {
    for (const example of MARKDOWN_SHAPE_EXAMPLES) {
      const shape = classifyListShape({
        heading: example.heading,
        items: example.items,
        ordered: example.ordered,
      });
      expect(shape, example.heading).toMatchObject({
        template: example.template,
        confidence: 'strong',
      });
    }
  });

  it('draws every example from plain Markdown, with no annotation', () => {
    for (const example of MARKDOWN_SHAPE_EXAMPLES) {
      const markdown = [
        `# ${example.heading}`,
        '',
        ...example.items.map((item, index) => `${example.ordered ? `${index + 1}.` : '-'} ${item}`),
      ].join('\n');
      const doc = markdownToDoc(parseMarkdown(markdown), { generateCoverBlock: false });
      const [block] = flattenRenderableBlocks(doc.blocks);
      expect(block?.template, example.heading).toBe(example.template);
      expect(doc.diagnostics ?? []).toEqual([]);
    }
  });

  it('gives each concept template a worked example that draws as itself', () => {
    for (const template of CONCEPT_TEMPLATES) {
      const markdown = markdownShapeExample(template);
      expect(markdown, template).toContain(`{[${template}`);
      const doc = markdownToDoc(parseMarkdown(markdown), { generateCoverBlock: false });
      const [block] = flattenRenderableBlocks(doc.blocks);
      expect(block?.template, template).toBe(template);
      expect(
        (doc.diagnostics ?? []).map((d) => d.code),
        template,
      ).toEqual([]);
    }
    expect(markdownShapeExample('matrix')).toContain('xAxis="Effort" yAxis="Impact"');
    expect(markdownShapeExample('process')).toContain('1. Draft the release notes');
  });

  it('renders the guide a prompt carries', () => {
    const guide = markdownShapeGuide();
    expect(guide[0]).toContain('one list of 2–6 short items');
    expect(guide).toContain('- a numbered list → numbered steps joined by arrows');
    expect(guide).toContain(
      '- items written `Figure: what it measures` → key numbers that count up',
    );
    expect(guide.join('\n')).toContain('{[funnel]}');
    expect(guide[guide.length - 1]).toContain('a paragraph beside it');
    expect(guide.length).toBe(MARKDOWN_SHAPE_EXAMPLES.length + 3);
    // One paragraph for where a prompt has a sentence to spend.
    const summary = markdownShapeSummary();
    expect(summary).toContain('a numbered list → steps; `Label: detail` items → cards');
    expect(summary).toContain('{[funnel]}');
    expect(summary.length).toBeLessThan(1000);
    for (const example of MARKDOWN_SHAPE_EXAMPLES) expect(summary).toContain(example.brief[1]);
    // A host that makes a slide of every level-one heading asks for that depth.
    expect(markdownShapeExample('cycle', { headingLevel: 1 })).toMatch(
      /^# The water cycle \{\[cycle\]\}/u,
    );
  });
});
