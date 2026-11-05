import { describe, expect, it } from 'vitest';
import type { Block, Layer } from '../schemas/Doc.js';
import { expandDocBlocks } from '../doc/templates/index.js';
import { conceptBuildStepTexts, splitConceptItem } from '../doc/templates/conceptBlocks.js';
import { blockBuildSteps, buildSourceText } from '../doc/builds.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { parseMarkdown } from '../markdown/index.js';
import { createPresentationPlan } from '../transform/presentationPlanner.js';
import { compilePresentationPlan } from '../transform/presentationCompiler.js';
import { defaultPresentationHints } from '../transform/presentationHints.js';
import { matchNumberHighlight } from '../recommend/numberHighlight.js';

const block = (template: string, items: string[], title = 'How water moves'): Block =>
  ({
    id: template,
    template,
    title,
    items,
    startTime: 0,
    duration: 12,
    audioSegment: 0,
    build: { mode: 'items' },
  }) as unknown as Block;
const layersOf = (input: Block): Layer[] => expandDocBlocks([input])[0]!.layers!;
const water = [
  'Evaporation: the sun heats water and it rises as vapor',
  'Condensation: the vapor cools into clouds',
  'Precipitation: water falls as rain or snow',
  'Collection: rivers carry it back to the sea',
];

describe('concept blocks', () => {
  it('splits a labelled idea, but not times or long run-in clauses', () => {
    expect(splitConceptItem('Antibodies: proteins that neutralize invaders')).toEqual({
      label: 'Antibodies',
      detail: 'proteins that neutralize invaders',
    });
    expect(splitConceptItem('Launch — July 16 from Cape Kennedy')).toEqual({
      label: 'Launch',
      detail: 'July 16 from Cape Kennedy',
    });
    expect(splitConceptItem('Lift-off came at 9:32 a.m. from the pad').label).toBe('');
    expect(
      splitConceptItem('When the vapor in the upper atmosphere finally cools enough: clouds').label,
    ).toBe('');
  });

  it.each(['cards', 'process', 'cycle'])('reveals each %s item as one build step', (template) => {
    const layers = layersOf(block(template, water));
    const steps = blockBuildSteps({ layers, build: { mode: 'items' } });
    expect(steps).toHaveLength(water.length);
    // The compiler names the steps the same way before the block is drawn.
    expect(steps.map((s) => s.text)).toEqual(
      conceptBuildStepTexts(template as 'cards' | 'process' | 'cycle', water),
    );
    // Every item's words, shape and connector share its step.
    for (const index of steps.keys())
      expect(layers.filter((layer) => layer.buildStep === index).length).toBeGreaterThan(1);
    // The headline is never part of a step.
    expect(layers.find((layer) => layer.id === 'title')?.buildStep).toBeUndefined();
  });

  it('draws a cycle back to its start and a process with one arrow between stages', () => {
    const cycle = layersOf(block('cycle', water));
    expect(cycle.filter((layer) => layer.type === 'path')).toHaveLength(water.length);
    const process = layersOf(block('process', water.slice(0, 3)));
    expect(process.filter((layer) => layer.type === 'path')).toHaveLength(2);
  });

  it('sets four long ideas two by two, never wider than a word allows', () => {
    const layers = layersOf(
      block('cards', [
        'Carbon dioxide: volcanoes, fossil fuels and deforestation',
        'Methane: wetlands, landfills, rice farming and livestock',
        'Nitrous oxide: farming, fertilizer and burning vegetation',
        'Chlorofluorocarbons: wholly industrial, once used as refrigerants',
      ]),
    );
    const cards = layers.filter((layer) => /^card-\d$/u.test(layer.id));
    expect(new Set(cards.map((card) => card.position.y)).size).toBe(2);
    const label = layers.find((layer) => layer.id === 'card-3-label')!;
    const fontSize = label.type === 'text' ? label.content.style.fontSize : 0;
    expect('Chlorofluorocarbons'.length * fontSize * 0.62).toBeLessThanOrEqual(
      Number(label.position.width),
    );
  });

  it('sets a single unlabelled idea as a lead paragraph, not a lone card', () => {
    const layers = layersOf(block('cards', ['Water is always on the move.']));
    expect(layers.some((layer) => layer.id === 'lead')).toBe(true);
    expect(layers.some((layer) => layer.id.startsWith('card-'))).toBe(false);
  });
});

describe('dynamic slides drawn as concepts', () => {
  const doc = markdownToDoc(
    parseMarkdown(
      [
        '# How Water Moves',
        '',
        'Water is always on the move between the oceans, the air and the land.',
        '',
        '## The Water Cycle',
        '',
        'First, the sun heats water in oceans and lakes, and it evaporates. Then the vapor cools and condenses into clouds. Next, the water falls back as rain or snow. Finally, it collects in rivers and oceans, and the cycle repeats.',
        '',
        '## Where Fresh Water Is Stored',
        '',
        'Ice caps are the largest store of fresh water on Earth. Groundwater is water held in soil and rock beneath the surface.',
      ].join('\n'),
    ),
  );
  const hints = { ...defaultPresentationHints(), density: 'section' as const };

  it('draws a repeating sequence as a cycle and defining sentences as labelled cards', () => {
    const plan = createPresentationPlan(doc, hints);
    expect(plan.beats.map((beat) => beat.layout)).toEqual(['title', 'cycle', 'cards']);
    expect(plan.beats[1]!.points[0]).toBe(
      'The sun heats water in oceans and lakes, and it evaporates.',
    );
    expect(plan.beats[2]!.points).toEqual([
      'Ice caps: largest store of fresh water on Earth.',
      'Groundwater: water held in soil and rock beneath the surface.',
    ]);
  });

  it('reveals each idea as the narration reaches its sentence', () => {
    const plan = createPresentationPlan(doc, hints);
    const compiled = compilePresentationPlan(doc, plan);
    const cycle = compiled.blocks[1]!;
    expect(cycle.build).toMatchObject({ mode: 'items' });
    const starts = cycle.buildTiming!.starts;
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeGreaterThan(starts[i - 1]!);
    expect(starts[starts.length - 1]!).toBeLessThan(cycle.duration);
    // The timing names the same steps the drawn block reveals.
    const steps = blockBuildSteps(expandDocBlocks([cycle])[0]!);
    expect(cycle.buildTiming!.sourceText).toBe(buildSourceText(steps));
  });
});

describe('key-number matching', () => {
  it('takes a unit only when it ends its word', () => {
    expect(matchNumberHighlight('its orbit tightened to 62 by 70 miles')).toBeNull();
    expect(matchNumberHighlight('a flight of 195 hours')?.value).toBe('195 hours');
    expect(matchNumberHighlight('natural gas is 70% methane')?.value).toBe('70%');
    expect(matchNumberHighlight('raised $3 million')?.value).toBe('$3 million');
  });
});
