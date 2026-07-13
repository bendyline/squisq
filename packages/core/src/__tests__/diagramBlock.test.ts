import { describe, it, expect } from 'vitest';
import { diagramBlock } from '../doc/templates/diagramBlock.js';
import { createTemplateContext } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import type { Block, Layer, ShapeLayer, PathLayer, TextLayer } from '../schemas/Doc.js';
import type { DiagramBlockInput } from '../schemas/BlockTemplates.js';

function makeBlock(overrides: Partial<Block> & { id: string }): Block {
  return {
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    ...overrides,
  } as Block;
}

function makeInput(overrides: Partial<DiagramBlockInput> = {}): DiagramBlockInput {
  return {
    template: 'diagram',
    id: 'family-tree',
    duration: 0,
    audioSegment: 0,
    ...overrides,
  };
}

describe('diagramBlock template', () => {
  it('emits node card + label layers for each child', () => {
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    ctx.children = [
      makeBlock({ id: 'a', title: 'Alpha', x: 100, y: 100 }),
      makeBlock({ id: 'b', title: 'Beta', x: 400, y: 100 }),
    ];
    const layers = diagramBlock(makeInput(), ctx);
    const cards = layers.filter((l) => l.type === 'shape') as ShapeLayer[];
    const texts = layers.filter((l) => l.type === 'text') as TextLayer[];
    expect(cards.length).toBe(2);
    expect(texts.length).toBe(2);
    expect(texts[0].content.text).toBe('Alpha');
    expect(texts[1].content.text).toBe('Beta');
  });

  it('emits a path layer with arrow for each connectsTo entry', () => {
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    ctx.children = [
      makeBlock({ id: 'a', x: 100, y: 100, connectsTo: [{ target: 'b' }] }),
      makeBlock({ id: 'b', x: 400, y: 100 }),
    ];
    const layers = diagramBlock(makeInput(), ctx);
    const paths = layers.filter((l) => l.type === 'path') as PathLayer[];
    expect(paths.length).toBe(1);
    expect(paths[0].content.endMarker).toBe('arrow');
    expect(paths[0].content.d.startsWith('M ')).toBe(true);
  });

  it('emits a typed edge label when connection has a type', () => {
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    ctx.children = [
      makeBlock({ id: 'a', x: 100, y: 100, connectsTo: [{ target: 'b', type: 'requires' }] }),
      makeBlock({ id: 'b', x: 400, y: 100 }),
    ];
    const layers = diagramBlock(makeInput(), ctx);
    const labels = layers.filter(
      (l): l is TextLayer => l.type === 'text' && l.id.startsWith('edge-label-'),
    );
    expect(labels.length).toBe(1);
    expect(labels[0].content.text).toBe('requires');
  });

  it('returns a single hint text layer when there are no children', () => {
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    ctx.children = [];
    const layers = diagramBlock(makeInput({ title: 'Empty' }), ctx);
    expect(layers.length).toBe(1);
    expect(layers[0].type).toBe('text');
  });

  it('emits a title layer when input.title is set', () => {
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    ctx.children = [makeBlock({ id: 'a', title: 'A', x: 100, y: 100 })];
    const layers = diagramBlock(makeInput({ title: 'My Diagram' }), ctx);
    const titleLayer = layers.find((l): l is TextLayer => l.id === 'diagram-title');
    expect(titleLayer).toBeDefined();
    expect(titleLayer?.content.text).toBe('My Diagram');
  });

  it('handles children without explicit positions via auto-layout', () => {
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    ctx.children = [
      makeBlock({ id: 'a', title: 'A' }),
      makeBlock({ id: 'b', title: 'B' }),
      makeBlock({ id: 'c', title: 'C' }),
    ];
    const layers = diagramBlock(makeInput(), ctx);
    const cards = layers.filter((l) => l.type === 'shape');
    expect(cards.length).toBe(3);
  });
});

describe('diagramBlock integration with materializeBlockLayers', () => {
  it('renders through the full template registry', async () => {
    const { materializeBlockLayers } = await import('../doc/materializeBlockLayers.js');
    const parentBlock: Block = {
      id: 'family',
      startTime: 0,
      duration: 0,
      audioSegment: 0,
      template: 'diagram',
      title: 'Family Tree',
      children: [
        makeBlock({ id: 'a', title: 'A', x: 100, y: 100 }),
        makeBlock({ id: 'b', title: 'B', x: 400, y: 100, connectsTo: [{ target: 'a' }] }),
      ],
    };
    const layers = materializeBlockLayers(parentBlock, { persistentLayers: false }).layers;
    // Should contain at least one shape (node card) and one path (edge).
    const types = new Set(layers.map((l: Layer) => l.type));
    expect(types.has('shape')).toBe(true);
    expect(types.has('path')).toBe(true);
  });
});
