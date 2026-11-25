/**
 * A block drawn as a feature of another slide (`Block.featureBlocks`): its own
 * template draws it into the slide's feature area, beneath the slide's words,
 * without its full-slide backdrop, held still, its text at the size its
 * template chose.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import type { Block, Layer } from '../schemas/Doc.js';
import type { DocBlock } from '../schemas/BlockTemplates.js';

const TABLE = ['| Region | Sales |', '| --- | --- |', '| North | 40 |', '| South | 25 |'];

const FAMILIES: Record<string, string> = {
  barChart: ['## By region {[barChart]}', '', ...TABLE].join('\n'),
  pieChart: ['## Share {[pieChart]}', '', ...TABLE].join('\n'),
  lineChart: [
    '## Trend {[lineChart]}',
    '',
    '| Month | Sales |',
    '| --- | --- |',
    '| Jan | 10 |',
    '| Feb | 14 |',
    '| Mar | 22 |',
  ].join('\n'),
  dataTable: ['## Totals {[dataTable]}', '', ...TABLE].join('\n'),
  diagram: [
    '## Flow {[diagram]}',
    '',
    '### Plan {connectsTo=build}',
    '',
    '### Build {connectsTo=ship}',
    '',
    '### Ship',
  ].join('\n'),
  drawing: [
    '## Team {[drawing]}',
    '',
    '### Lead {#lead} {[rectangle x=21 y=25 width=100 height=100]}',
    '',
    '### reports to {[line from=lead to=dev]}',
    '',
    '### Developer {#dev} {[rectangle x=21 y=190 width=100 height=100]}',
  ].join('\n'),
  layout: [
    '## At a glance {[layout]}',
    '',
    '### {#card} {[rect x=60 y=80 width=1800 height=920 fill=#334155 strokeWidth=8 borderRadius=40]}',
    '',
    '### {#value} {[text x=140 y=200 width=1640 height=360 fontSize=160 padding=24]}',
    '',
    '87%',
    '',
    '### {#label} {[text x=140 y=640 width=1640 height=200 fontSize=64]}',
    '',
    'would recommend us',
  ].join('\n'),
  map: '## Downtown {[map center="47.6,-122.3" zoom=9 mapStyle="road"]}',
  tree: ['## Files {[tree]}', '', '- src/', '  - index.ts', '  - utils/'].join('\n'),
  timeline: [
    '## Release {[timeline]}',
    '',
    '```timeline',
    'Release: ● Alpha {#alpha} ──────● Beta {#beta} ──────► ',
    '```',
  ].join('\n'),
};

/** The block as a slide record, the way a deck carries it. */
function slideOf(markdown: string): Block {
  return buildPreviewDoc(markdownToDoc(parseMarkdown(markdown))).blocks[0] as Block;
}

function host(featured: Block): Block {
  return {
    id: 'host',
    template: 'bottomFeature',
    title: 'Results',
    duration: 8,
    startTime: 0,
    audioSegment: 0,
    summaryMode: 'brief',
    contents: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Revenue grew 40% last year.' }] },
    ],
    featureBlocks: [featured],
  } as Block;
}

const numberAt = (value: unknown) => (typeof value === 'number' ? value : NaN);

describe('a block drawn on another slide', () => {
  for (const viewport of [VIEWPORT_PRESETS.landscape, VIEWPORT_PRESETS.portrait]) {
    for (const [family, markdown] of Object.entries(FAMILIES)) {
      it(`draws a ${family} beneath the slide's words (${viewport.name})`, () => {
        const featured = slideOf(markdown);
        const layers = materializeBlockLayers(host(featured) as unknown as DocBlock, {
          viewport,
        }).layers;
        const drawn = layers.filter((layer) => layer.id.startsWith('host-feature-1-'));
        expect(drawn.length, family).toBeGreaterThan(0);
        // Beneath the headline, inside the slide.
        for (const layer of drawn) {
          const y = numberAt(layer.position.y);
          const x = numberAt(layer.position.x);
          expect(y, `${family} ${layer.id}`).toBeGreaterThan(viewport.height * 0.15);
          expect(y, `${family} ${layer.id}`).toBeLessThanOrEqual(viewport.height);
          expect(x, `${family} ${layer.id}`).toBeGreaterThanOrEqual(0);
          expect(x, `${family} ${layer.id}`).toBeLessThanOrEqual(viewport.width);
        }
        // No full-slide backdrop of its own, no motion, text at its own size.
        const fullSlide = drawn.filter(
          (layer) =>
            layer.type === 'shape' &&
            numberAt(layer.position.width) >= viewport.width * 0.99 &&
            numberAt(layer.position.height) >= viewport.height * 0.99,
        );
        expect(fullSlide, family).toEqual([]);
        for (const layer of drawn) {
          expect(layer.animation, layer.id).toBeUndefined();
          expect(layer.buildStep, layer.id).toBeUndefined();
          if (layer.type === 'text') expect(layer.content.style.keepSize, layer.id).toBe(true);
        }
        // The slide's own words are still there.
        expect(
          layers.some(
            (layer: Layer) => layer.type === 'text' && /Results/.test(layer.content.text),
          ),
        ).toBe(true);
      });
    }
  }

  it('stacks two blocks in a tall slide and sets them side by side in a wide one', () => {
    const two = {
      ...host(slideOf(FAMILIES.barChart)),
      featureBlocks: [slideOf(FAMILIES.barChart), slideOf(FAMILIES.lineChart)],
    } as Block;
    const tops = (viewport: (typeof VIEWPORT_PRESETS)[keyof typeof VIEWPORT_PRESETS]) => {
      const layers = materializeBlockLayers(two as unknown as DocBlock, { viewport }).layers;
      return [1, 2].map((n) => {
        const own = layers.filter((layer) => layer.id.startsWith(`host-feature-${n}-`));
        return {
          x: Math.min(...own.map((layer) => numberAt(layer.position.x))),
          y: Math.min(...own.map((layer) => numberAt(layer.position.y))),
        };
      });
    };
    const [tallFirst, tallSecond] = tops(VIEWPORT_PRESETS.portrait);
    expect(tallSecond!.y).toBeGreaterThan(tallFirst!.y + VIEWPORT_PRESETS.portrait.height * 0.1);
    const [wideFirst, wideSecond] = tops(VIEWPORT_PRESETS.landscape);
    expect(wideSecond!.x).toBeGreaterThan(wideFirst!.x + VIEWPORT_PRESETS.landscape.width * 0.25);
  });

  it('shrinks a layout whole, keeping its shape, strokes, corners and type in proportion', () => {
    // Too big for the band beneath the slide's words, so it must shrink.
    const viewport = VIEWPORT_PRESETS.landscape;
    const layers = materializeBlockLayers(host(slideOf(FAMILIES.layout)) as unknown as DocBlock, {
      viewport,
    }).layers;
    const card = layers.find((layer) => layer.id === 'host-feature-1-card')!;
    const value = layers.find((layer) => layer.id === 'host-feature-1-value')!;
    const scale = numberAt(card.position.width) / 1800;
    expect(scale).toBeGreaterThan(0.2);
    expect(scale).toBeLessThan(1);
    // The same shape: height shrinks by the same factor as width.
    expect(numberAt(card.position.height) / 920).toBeCloseTo(scale, 5);
    if (card.type !== 'shape' || value.type !== 'text') throw new Error('unexpected layers');
    expect(card.content.strokeWidth).toBeCloseTo(8 * scale, 5);
    expect(card.content.borderRadius).toBeCloseTo(40 * scale, 5);
    expect(value.content.style.fontSize).toBeCloseTo(160 * scale, 5);
    expect(value.content.style.padding).toBeCloseTo(24 * scale, 5);
    // Its parts keep their places relative to one another.
    expect(numberAt(value.position.x) - numberAt(card.position.x)).toBeCloseTo(80 * scale, 5);
  });

  it('keeps a layout made for a wide slide inside a tall one', () => {
    const viewport = VIEWPORT_PRESETS.portrait;
    const layers = materializeBlockLayers(host(slideOf(FAMILIES.layout)) as unknown as DocBlock, {
      viewport,
    }).layers.filter((layer) => layer.id.startsWith('host-feature-1-'));
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      const right = numberAt(layer.position.x) + numberAt(layer.position.width ?? 0);
      expect(numberAt(layer.position.x), layer.id).toBeGreaterThanOrEqual(0);
      expect(right, layer.id).toBeLessThanOrEqual(viewport.width);
    }
  });

  it('steps a map out so the ground its own slide showed stays in view', () => {
    const viewport = VIEWPORT_PRESETS.landscape;
    const layers = materializeBlockLayers(host(slideOf(FAMILIES.map)) as unknown as DocBlock, {
      viewport,
    }).layers;
    const map = layers.find(
      (layer) => layer.type === 'map' && layer.id.startsWith('host-feature-1-'),
    );
    if (map?.type !== 'map') throw new Error('no map');
    const shrink = Math.max(
      viewport.width / numberAt(map.position.width),
      viewport.height / numberAt(map.position.height),
    );
    expect(shrink).toBeGreaterThan(1);
    // Each step out doubles the ground shown: enough steps to cover the shrink.
    expect(map.content.zoom).toBeLessThan(9);
    expect(2 ** (9 - map.content.zoom)).toBeGreaterThanOrEqual(shrink * 0.9);
    expect(2 ** (9 - map.content.zoom - 1)).toBeLessThan(shrink);
  });

  it('never draws a block inside a block inside a slide', () => {
    const chart = slideOf(FAMILIES.barChart);
    const nested = { ...chart, featureBlocks: [slideOf(FAMILIES.pieChart)] } as Block;
    const layers = materializeBlockLayers(host(nested) as unknown as DocBlock).layers;
    expect(layers.some((layer) => layer.id.startsWith('host-feature-1-'))).toBe(true);
    expect(layers.some((layer) => layer.id.includes('-feature-1-host'))).toBe(false);
    expect(layers.filter((layer) => /feature-\d+-.*feature-\d+/.test(layer.id))).toEqual([]);
  });

  it('carries the block through a deck’s slide records', () => {
    const doc = markdownToDoc(parseMarkdown(FAMILIES.barChart));
    const slide = buildPreviewDoc({
      ...doc,
      blocks: [{ ...doc.blocks[0]!, featureBlocks: [doc.blocks[0]!] }],
    }).blocks[0] as Block;
    expect(slide.featureBlocks?.[0]?.template).toBe('barChart');
    expect(slide.featureBlocks?.[0]).not.toHaveProperty('sourceHeading');
  });
});
