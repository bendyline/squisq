import { describe, expect, it } from 'vitest';
import type { Block, Layer, TextLayer } from '../schemas/Doc.js';
import { expandDocBlocks } from '../doc/templates/index.js';
import { conceptBuildStepTexts } from '../doc/templates/conceptBlocks.js';
import {
  isFigureText,
  splitStatItem,
  vennOverlapIndex,
  splitConceptItem,
} from '../doc/templates/conceptItems.js';
import { blockBuildSteps } from '../doc/builds.js';
import { VIEWPORT_PRESETS, type ViewportConfig } from '../schemas/Viewport.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { parseMarkdown } from '../markdown/index.js';
import { deriveTemplateInputs, extractConceptItems } from '../doc/templateInputs.js';
import { materializePageSections } from '../doc/page/materializePageSection.js';

type ConceptName = Parameters<typeof conceptBuildStepTexts>[0];

const block = (template: string, items: string[], extra: Record<string, unknown> = {}): Block =>
  ({
    id: template,
    template,
    title: 'A headline',
    items,
    startTime: 0,
    duration: 12,
    audioSegment: 0,
    build: { mode: 'items' },
    ...extra,
  }) as unknown as Block;

const layersOf = (input: Block, viewport: ViewportConfig = VIEWPORT_PRESETS.landscape): Layer[] =>
  expandDocBlocks([input], { viewport })[0]!.layers!;

const text = (layers: Layer[], id: string): TextLayer | undefined =>
  layers.find((layer): layer is TextLayer => layer.id === id && layer.type === 'text');

const ideas = [
  'Vision: where the company is going',
  'Strategy: how it gets there',
  'Projects: the bets that carry it',
  'Daily work: what makes it happen',
];
const figures = [
  '57 million: deaths prevented since 2000',
  '95%: coverage needed for herd immunity',
  '$3.2B: spent on the programme each year',
];
const sets = [
  'Frogs: smooth skin and long legs',
  'Toads: dry skin and short legs',
  'Both: amphibians that lay their eggs in water',
];

/** Every layer stays inside the frame, with a little tolerance for estimates. */
function expectInFrame(layers: Layer[], viewport: { width: number; height: number }) {
  for (const layer of layers) {
    if (layer.type !== 'text' && layer.type !== 'shape') continue;
    const { x, y, width, height, anchor } = layer.position;
    if ([x, y, width, height].some((value) => typeof value !== 'number')) continue;
    const [w, h] = [width as number, height as number];
    const left = anchor === 'center' ? (x as number) - w / 2 : (x as number);
    const top = anchor === 'center' ? (y as number) - h / 2 : (y as number);
    expect(left, `${layer.id} left`).toBeGreaterThanOrEqual(-2);
    expect(top, `${layer.id} top`).toBeGreaterThanOrEqual(-2);
    expect(left + w, `${layer.id} right`).toBeLessThanOrEqual(viewport.width + 2);
    expect(top + h, `${layer.id} bottom`).toBeLessThanOrEqual(viewport.height * 1.02);
  }
}

describe('concept items', () => {
  it('reads a key number wherever its figure sits', () => {
    expect(splitStatItem('57 million: deaths prevented')).toEqual({
      figure: '57 million',
      caption: 'deaths prevented',
    });
    expect(splitStatItem('Coverage: 95%')).toEqual({ figure: '95%', caption: 'Coverage' });
    expect(splitStatItem('2,400 cycle trips a day')).toEqual({
      figure: '2,400',
      caption: 'cycle trips a day',
    });
    expect(splitStatItem('1 in 5: adults affected')).toEqual({
      figure: '1 in 5',
      caption: 'adults affected',
    });
    // No figure: the item is all caption.
    expect(splitStatItem('Safer than getting sick')).toEqual({
      figure: '',
      caption: 'Safer than getting sick',
    });
  });

  it('tells a figure from a phrase that merely holds a number', () => {
    for (const figure of ['95%', '$3.2B', '57 million', '2,400 km', '3×', '1 in 5', '−4°C'])
      expect(isFigureText(figure), figure).toBe(true);
    for (const phrase of ['July 16, 1969', 'Apollo 11 mission', 'about twenty', ''])
      expect(isFigureText(phrase), phrase).toBe(false);
  });

  it('does not read a version, an address, a date or a time as a quantity', () => {
    for (const name of ['2.1.0', '192.168.1.1', '12.05.2024'])
      expect(isFigureText(name), name).toBe(false);
    // Dots that group thousands are still a number.
    expect(isFigureText('1.234.567')).toBe(true);
    for (const item of ['10:30 standup', '2024-05-01 launch', '2.1.0 fixes the export'])
      expect(splitStatItem(item), item).toEqual({ figure: '', caption: item });
    expect(splitStatItem('42%, the share who prefer blocks')).toEqual({
      figure: '42%',
      caption: 'the share who prefer blocks',
    });
  });

  it('finds the item that names what two sets share', () => {
    expect(vennOverlapIndex(sets.map(splitConceptItem))).toBe(2);
    expect(vennOverlapIndex(ideas.map(splitConceptItem))).toBe(-1);
  });
});

describe('concept shapes', () => {
  const cases: Array<[ConceptName, string[], Record<string, unknown>]> = [
    ['stats', figures, {}],
    ['pyramid', ideas, {}],
    ['funnel', ideas, {}],
    ['hub', ideas, { center: 'The plan' }],
    ['venn', sets, {}],
    ['matrix', ideas, { xAxis: 'Effort', yAxis: 'Impact' }],
  ];

  it.each(cases)(
    'reveals each %s item as one build step, named as it is drawn',
    (template, items, extra) => {
      const layers = layersOf(block(template, items, extra));
      const steps = blockBuildSteps({ layers, build: { mode: 'items' } });
      expect(steps).toHaveLength(items.length);
      expect(steps.map((step) => step.text)).toEqual(conceptBuildStepTexts(template, items));
      for (const index of steps.keys())
        expect(layers.filter((layer) => layer.buildStep === index).length).toBeGreaterThan(1);
      // The lockup (and a hub's centre, a matrix's axes) is never part of a step.
      expect(layers.find((layer) => layer.id === 'title')?.buildStep).toBeUndefined();
    },
  );

  it.each(cases)('keeps a %s inside the frame in every orientation', (template, items, extra) => {
    for (const viewport of [
      VIEWPORT_PRESETS.landscape,
      VIEWPORT_PRESETS.portrait,
      VIEWPORT_PRESETS.square,
    ])
      expectInFrame(layersOf(block(template, items, extra), viewport), viewport);
  });

  it('sets each key number over the word that scales it and what it measures', () => {
    const layers = layersOf(block('stats', figures));
    expect(text(layers, 'stat-0')?.content.text).toBe('57');
    expect(text(layers, 'stat-0-unit')?.content.text).toBe('million');
    expect(text(layers, 'stat-0-detail')?.content.text).toBe('deaths prevented since 2000');
    expect(text(layers, 'stat-1')?.content.text).toBe('95%');
    // Every figure on a slide sets in one size.
    const sizes = [0, 1, 2].map((index) => text(layers, `stat-${index}`)!.content.style.fontSize);
    expect(new Set(sizes).size).toBe(1);
  });

  it('counts key numbers up where the theme counts, one after another', () => {
    const doc = { ...block('stats', figures), build: undefined } as unknown as Block;
    const layers = expandDocBlocks([doc], {
      viewport: VIEWPORT_PRESETS.landscape,
      motion: 'documentary',
    })[0]!.layers!;
    const counts = [0, 1].map((index) => text(layers, `stat-${index}`)!.animation);
    expect(counts[0]?.type).toBe('countUp');
    expect(counts[1]!.delay!).toBeGreaterThan(counts[0]!.delay!);
  });

  it('draws key numbers without a figure, a lone set, or three ideas on two axes as cards', () => {
    for (const [template, items] of [
      ['stats', ['Safer than getting sick', 'Lasts a lifetime']],
      ['venn', ['Frogs: smooth skin', 'Toads: dry skin', 'Newts: a tail']],
      ['matrix', ideas.slice(0, 3)],
    ] as Array<[ConceptName, string[]]>) {
      const layers = layersOf(block(template, items));
      expect(
        layers.some((layer) => layer.id.startsWith('card-')),
        template,
      ).toBe(true);
      // The steps are still named as they are drawn.
      const steps = blockBuildSteps({ layers, build: { mode: 'items' } });
      expect(steps.map((step) => step.text)).toEqual(conceptBuildStepTexts(template, items));
    }
  });

  it('widens a pyramid toward its base and narrows a funnel toward its stem', () => {
    const width = (layers: Layer[], id: string): number => {
      const layer = layers.find((candidate) => candidate.id === id);
      if (layer?.type !== 'path') throw new Error(`${id} is not a path`);
      const xs = [...layer.content.d.matchAll(/[ML] (-?[\d.]+) /gu)].map((match) =>
        Number(match[1]),
      );
      return Math.max(...xs) - Math.min(...xs);
    };
    const pyramid = layersOf(block('pyramid', ideas));
    expect(width(pyramid, 'tier-3')).toBeGreaterThan(width(pyramid, 'tier-0'));
    const funnel = layersOf(block('funnel', ideas));
    expect(width(funnel, 'tier-0')).toBeGreaterThan(width(funnel, 'tier-3'));
  });

  it('writes a hub’s centre inside it and gives every idea a spoke', () => {
    const layers = layersOf(block('hub', ideas, { center: 'The plan' }));
    expect(text(layers, 'hub-center')?.content.text).toBe('The plan');
    expect(layers.filter((layer) => /^spoke-\d$/u.test(layer.id))).toHaveLength(ideas.length);
    // The first ideas sit left of the hub, the rest right of it.
    const hub = layers.find((layer) => layer.id === 'hub')!;
    const hubX = Number(hub.position.x) + Number(hub.position.width) / 2;
    const end = (index: number) =>
      Number(layers.find((l) => l.id === `spoke-${index}-end`)!.position.x);
    expect(end(0)).toBeLessThan(hubX);
    expect(end(3)).toBeGreaterThan(hubX);
  });

  it('labels each set of a Venn diagram and ties what they share to the overlap', () => {
    const layers = layersOf(block('venn', sets));
    expect(text(layers, 'set-0-label')?.content.text).toBe('Frogs');
    expect(text(layers, 'set-1-label')?.content.text).toBe('Toads');
    expect(text(layers, 'overlap-detail')?.content.text).toBe(
      'amphibians that lay their eggs in water',
    );
    // The overlap is the third item, so it is the third step.
    expect(layers.find((layer) => layer.id === 'overlap')?.buildStep).toBe(2);
    // The two circles overlap.
    const [a, b] = ['set-0', 'set-1'].map((id) => layers.find((layer) => layer.id === id)!);
    expect(Number(b!.position.x)).toBeLessThan(Number(a!.position.x) + Number(a!.position.width));
  });

  it('places four ideas two by two and names both axes', () => {
    const layers = layersOf(block('matrix', ideas, { xAxis: 'Effort', yAxis: 'Impact' }));
    const cells = [0, 1, 2, 3].map((index) => layers.find((l) => l.id === `cell-${index}`)!);
    expect(cells[0]!.position.y).toBe(cells[1]!.position.y);
    expect(cells[0]!.position.x).toBe(cells[2]!.position.x);
    expect(Number(cells[2]!.position.y)).toBeGreaterThan(Number(cells[0]!.position.y));
    expect(text(layers, 'axis-x-label')?.content.text).toBe('Effort');
    expect(text(layers, 'axis-y-label')?.content.text).toBe('Impact');
  });

  it('shows more ideas than a drawing holds as the list they are', () => {
    const many = Array.from({ length: 8 }, (_, index) => `Idea ${index + 1}: what it adds`);
    for (const template of ['cards', 'process', 'cycle', 'layers', 'pyramid', 'hub', 'stats']) {
      const layers = layersOf(block(template, many));
      const shown = layers
        .filter((layer): layer is TextLayer => layer.type === 'text')
        .map((layer) => layer.content.text)
        .join('\n');
      for (const idea of many) expect(shown, `${template}: ${idea}`).toContain(idea);
    }
  });

  it('reads a nested list as labelled ideas rather than one run-on line', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        [
          '## Our approach {[process]}',
          '',
          '1. Discover',
          '   - Interview customers',
          '   - Review existing data',
          '2. Deliver',
          '   - Prototype',
        ].join('\n'),
      ),
    );
    const block = doc.blocks[0]!;
    expect(extractConceptItems(block.contents)).toEqual([
      'Discover: Interview customers; Review existing data',
      'Deliver: Prototype',
    ]);
    expect(deriveTemplateInputs('process', 'Our approach', block.contents)).toMatchObject({
      title: 'Our approach',
      items: ['Discover: Interview customers; Review existing data', 'Deliver: Prototype'],
    });
  });

  it('reads key numbers on a page as a band of figures', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        ['## In numbers {[stats]}', '', ...figures.map((item) => `- ${item}`)].join('\n'),
      ),
    );
    const section = materializePageSections(doc)
      .map((entry) => entry.section)
      .find((candidate) => candidate.kind === 'stat-band');
    expect(section?.slots.title).toBe('In numbers');
    expect(section?.slots.items?.map((item) => item.value)).toEqual(['57 million', '95%', '$3.2B']);
  });
});
