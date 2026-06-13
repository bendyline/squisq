import { describe, it, expect } from 'vitest';
import { drawingBlock } from '../doc/templates/drawingBlock.js';
import { createTemplateContext } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import type { Block, Layer, ShapeLayer, PathLayer, TextLayer } from '../schemas/Doc.js';
import type { DrawingBlockInput } from '../schemas/BlockTemplates.js';

function shape(
  id: string,
  template: string,
  overrides: Record<string, string> = {},
  extra: Partial<Block> = {},
): Block {
  return {
    id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    template,
    templateOverrides: overrides,
    ...extra,
  } as Block;
}

function makeInput(overrides: Partial<DrawingBlockInput> = {}): DrawingBlockInput {
  return { template: 'drawing', id: 'sketch', duration: 0, audioSegment: 0, ...overrides };
}

function ctxWith(children: Block[]) {
  const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
  ctx.children = children;
  return ctx;
}

describe('drawingBlock template', () => {
  it('emits a shape + label layer for each rect/circle child', () => {
    const layers = drawingBlock(
      makeInput(),
      ctxWith([
        shape('ceo', 'rectangle', { x: '20', y: '20', width: '120', height: '80' }, { title: 'CEO' }),
        shape('dev', 'circle', { x: '20', y: '200', width: '100', height: '100' }, { title: 'Dev' }),
      ]),
    );
    const shapes = layers.filter((l): l is ShapeLayer => l.type === 'shape');
    const texts = layers.filter((l): l is TextLayer => l.type === 'text');
    expect(shapes.map((s) => s.content.shape).sort()).toEqual(['circle', 'rect']);
    expect(texts.map((t) => t.content.text).sort()).toEqual(['CEO', 'Dev']);
  });

  it('renders a from/to line as a path connector behind the shapes', () => {
    const layers = drawingBlock(
      makeInput(),
      ctxWith([
        shape('a', 'rect', { x: '0', y: '0', width: '80', height: '60' }, { title: 'A' }),
        shape('b', 'rect', { x: '0', y: '200', width: '80', height: '60' }, { title: 'B' }),
        shape('l', 'arrow', { from: 'a', to: 'b' }),
      ]),
    );
    const paths = layers.filter((l): l is PathLayer => l.type === 'path');
    expect(paths).toHaveLength(1);
    expect(paths[0].content.endMarker).toBe('arrow');
    expect(paths[0].content.d.startsWith('M ')).toBe(true);
    // Connector emitted before the shapes (so it sits behind them).
    expect(layers.indexOf(paths[0])).toBeLessThan(
      layers.findIndex((l) => l.type === 'shape'),
    );
  });

  it('emits a title layer when input.title is set', () => {
    const layers = drawingBlock(
      makeInput({ title: 'Org chart' }),
      ctxWith([shape('a', 'rect', { x: '0', y: '0', width: '80', height: '60' })]),
    );
    expect(layers.find((l) => l.id === 'drawing-title')).toBeDefined();
  });

  it('returns a single hint layer for an empty drawing', () => {
    const layers = drawingBlock(makeInput({ title: 'Nothing yet' }), ctxWith([]));
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe('text');
  });
});

describe('drawingBlock integration with getLayers', () => {
  it('renders a drawing block through the template registry', async () => {
    const { getLayers } = await import('../doc/getLayers.js');
    const parent: Block = {
      id: 'sketch',
      startTime: 0,
      duration: 0,
      audioSegment: 0,
      template: 'drawing',
      title: 'Org chart',
      children: [
        shape('ceo', 'rectangle', { x: '20', y: '20', width: '120', height: '80' }, { title: 'CEO' }),
        shape('dev', 'rectangle', { x: '20', y: '220', width: '120', height: '80' }, { title: 'Dev' }),
        shape('l', 'arrow', { from: 'ceo', to: 'dev' }, { title: 'manages' }),
      ],
    };
    const layers = getLayers(parent, {});
    const types = new Set(layers.map((l: Layer) => l.type));
    expect(types.has('shape')).toBe(true);
    expect(types.has('path')).toBe(true);
  });
});
