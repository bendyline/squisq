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

  it('draws a cycle too short or too wordy for a ring as a process', () => {
    // Two stages are not a ring, and a paragraph does not fit beside one:
    // the stages ran over the headline and off the slide.
    const paragraph = `Evaporation: ${'the sun heats the water and it rises as vapor, '.repeat(5)}`;
    for (const items of [water.slice(0, 2), [paragraph, ...water.slice(1)]]) {
      const layers = layersOf(block('cycle', items));
      // One arrow between stages, none closing the loop.
      expect(layers.filter((layer) => layer.type === 'path')).toHaveLength(items.length - 1);
      expect(layers.some((layer) => layer.id === 'stage-close-arrow')).toBe(false);
      // Its steps are still named as they are drawn.
      const steps = blockBuildSteps({ layers, build: { mode: 'items' } });
      expect(steps.map((step) => step.text)).toEqual(conceptBuildStepTexts('cycle', items));
    }
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

  it('draws dated stages as a timeline, and undated or backward ones as numbered stages', () => {
    const events = [
      '1859 Carrington Event: telegraphs failed and auroras lit the sky',
      'July 1969: Apollo 11 lands on the Moon',
      '1989 Quebec blackout: six million people lost power',
    ];
    const layers = layersOf(block('process', events));
    expect(layers.filter((layer) => /^station-\d$/u.test(layer.id))).toHaveLength(3);
    const when = layers.find((layer) => layer.id === 'station-1-when');
    expect(when?.type === 'text' && when.content.text).toBe('July 1969');
    const label = layers.find((layer) => layer.id === 'station-0-label');
    expect(label?.type === 'text' && label.content.text).toBe('Carrington Event');
    // The compiler names a timeline's steps as it draws them.
    const steps = blockBuildSteps({ layers, build: { mode: 'items' } });
    expect(steps.map((s) => s.text)).toEqual(conceptBuildStepTexts('process', events));
    // Dates that run backward, or figures that only look like years, stay a process.
    for (const items of [
      [...events].reverse(),
      ['330,000 Earths: its mass', '1.3 million: its volume'],
    ])
      expect(layersOf(block('process', items)).some((layer) => layer.id === 'station-0')).toBe(
        false,
      );
  });

  it('sets two contrasting sides across a "vs" mark that belongs to neither', () => {
    const sides = ['Mac: 128 GB preferred', 'Windows: 64 GB RTX Spark'];
    const layers = layersOf({ ...block('cards', sides), versus: true } as unknown as Block);
    const mark = layers.find((layer) => layer.id === 'versus-mark-text');
    expect(mark).toBeDefined();
    expect(mark?.buildStep).toBeUndefined();
    expect(layers.filter((layer) => /^side-\d$/u.test(layer.id))).toHaveLength(2);
    const steps = blockBuildSteps({ layers, build: { mode: 'items' } });
    expect(steps.map((s) => s.text)).toEqual(conceptBuildStepTexts('cards', sides));
  });

  it('draws nested parts as rings, innermost on top, each called out in its own step', () => {
    const parts = [
      'Core: fuses hydrogen into helium',
      'Radiative zone: light bounces outward',
      'Convection zone: hot plasma rises',
    ];
    const layers = layersOf(block('layers', parts));
    const rings = layers.filter((layer) => /^layer-\d$/u.test(layer.id));
    // Outermost first in the stack, so each inner ring sits on the ones around it.
    expect(rings.map((ring) => ring.id)).toEqual(['layer-2', 'layer-1', 'layer-0']);
    expect(Number(rings[0]!.position.width)).toBeGreaterThan(Number(rings[2]!.position.width));
    const steps = blockBuildSteps({ layers, build: { mode: 'items' } });
    expect(steps.map((s) => s.text)).toEqual(conceptBuildStepTexts('layers', parts));
    expect(layers.find((layer) => layer.id === 'layer-0')?.buildStep).toBe(0);
  });

  it('assembles each idea as it arrives: connectors draw, badges pop, words rise', () => {
    const [documentary] = expandDocBlocks([block('process', water.slice(0, 3))], {
      motion: 'documentary',
    });
    const animation = (id: string) =>
      documentary!.layers!.find((layer) => layer.id === id)?.animation;
    expect(animation('step-1-arrow')?.type).toBe('drawOn');
    expect(animation('step-1')).toMatchObject({ type: 'grow', origin: 'center' });
    expect(animation('step-1-label')?.type).toBe('fadeInUp');
    // Within an item: the arrow, then the badge at its head, then the words.
    expect(animation('step-1')!.delay!).toBeGreaterThan(animation('step-1-arrow')!.delay!);
    expect(animation('step-1-label')!.delay!).toBeGreaterThan(animation('step-1')!.delay!);
    // Calm fades everything in.
    const [calm] = expandDocBlocks([block('process', water.slice(0, 3))], { motion: 'calm' });
    expect(calm!.layers!.find((layer) => layer.id === 'step-1-arrow')?.animation?.type).toBe(
      'fadeIn',
    );
  });

  it('sets a key number with a headline in the deck lockup, its scale beneath it', () => {
    const [stat] = expandDocBlocks([
      {
        id: 'corona',
        template: 'statHighlight',
        headline: 'The corona is far hotter than the surface',
        stat: '3.5 million',
        description: 'The corona heats up to 3.5 million degrees',
        detail: 'Its heating source is a major unsolved puzzle',
        startTime: 0,
        duration: 8,
        audioSegment: 0,
      } as unknown as Block,
    ]);
    const text = (id: string) => {
      const layer = stat!.layers!.find((item) => item.id === id);
      return layer?.type === 'text' ? layer.content.text : undefined;
    };
    expect(stat!.layers!.some((layer) => layer.id === 'accent-rule')).toBe(true);
    expect(text('title')).toBe('The corona is far hotter than the surface');
    expect(text('stat')).toBe('3.5');
    expect(text('stat-unit')).toBe('million');
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
    // The first idea lands as the headline settles, never leaving the headline alone.
    expect(starts[0]!).toBeLessThanOrEqual(1);
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

  it('never takes one side of a dimension as the figure', () => {
    expect(matchNumberHighlight('its first orbit was 69 by 190 miles')).toBeNull();
    expect(matchNumberHighlight('a 1920 x 1080 frame')).toBeNull();
    expect(matchNumberHighlight('it weighs 2,400 pounds')?.value).toBe('2,400');
  });
});
