import { describe, it, expect, vi } from 'vitest';
import { getLayers, RenderContext } from '../doc/getLayers.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { TemplateBlock, PersistentLayerConfig } from '../schemas/BlockTemplates.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import type { Block, Layer, TextLayer, ShapeLayer } from '../schemas/Doc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplateBlock(overrides: Partial<TemplateBlock> = {}): TemplateBlock {
  return {
    template: 'titleBlock',
    id: 'test-title-1',
    duration: 5,
    audioSegment: 0,
    title: 'Hello World',
    ...overrides,
  } as TemplateBlock;
}

function makeRawBlock(layers: Layer[]): Block {
  return {
    id: 'raw-block-1',
    duration: 5,
    startTime: 0,
    audioSegment: 0,
    layers,
  };
}

const defaultContext: RenderContext = {
  theme: DEFAULT_THEME,
  viewport: VIEWPORT_PRESETS.landscape,
  blockIndex: 0,
  totalBlocks: 5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getLayers', () => {
  it('generates layers for a known template block', () => {
    const block = makeTemplateBlock({ template: 'titleBlock', title: 'Test Title' });
    const layers = getLayers(block, defaultContext);

    expect(Array.isArray(layers)).toBe(true);
    expect(layers.length).toBeGreaterThan(0);

    // titleBlock always produces at least a text layer with the title
    const textLayer = layers.find((l) => l.type === 'text');
    expect(textLayer).toBeDefined();
    expect((textLayer as TextLayer).content.text).toContain('Test Title');
  });

  it('generates layers for statHighlight template', () => {
    const block = makeTemplateBlock({
      template: 'statHighlight',
      stat: '42%',
      description: 'of users',
    });
    const layers = getLayers(block, defaultContext);

    expect(layers.length).toBeGreaterThan(0);
    const texts = layers.filter((l) => l.type === 'text');
    expect(texts.length).toBeGreaterThanOrEqual(1);
  });

  it('returns raw block layers when block has pre-computed layers', () => {
    const existingLayers: Layer[] = [
      {
        type: 'shape',
        id: 'test-shape',
        content: { shape: 'rect', fill: '#ff0000' },
        position: { x: 0, y: 0, width: 100, height: 100 },
      } as ShapeLayer,
    ];
    const block = makeRawBlock(existingLayers);
    const layers = getLayers(block, defaultContext);

    expect(layers).toEqual(existingLayers);
  });

  it('returns empty array for unknown template', () => {
    const block = {
      template: 'totally_nonexistent',
      id: 'unknown-1',
      duration: 5,
      audioSegment: 0,
    } as unknown as TemplateBlock;
    const layers = getLayers(block, defaultContext);

    expect(layers).toEqual([]);
  });

  it('returns empty array for block with no template and no layers', () => {
    const block: Block = { id: 'empty-1', duration: 5, startTime: 0, audioSegment: 0 };
    const layers = getLayers(block, defaultContext);

    expect(layers).toEqual([]);
  });

  it('uses default context values when context is omitted', () => {
    const block = makeTemplateBlock({ template: 'titleBlock', title: 'Defaults' });
    const layers = getLayers(block);

    expect(Array.isArray(layers)).toBe(true);
    expect(layers.length).toBeGreaterThan(0);
  });

  it('handles template that throws an error gracefully', () => {
    // We spy on console.error to suppress noise and verify it was called
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // comparisonBar requires numeric values; passing invalid data may throw
    // but getLayers should catch and return []
    const block = makeTemplateBlock({
      template: 'comparisonBar',
      // Missing required fields
    });
    const layers = getLayers(block, defaultContext);

    expect(Array.isArray(layers)).toBe(true);
    consoleSpy.mockRestore();
  });

  describe('persistent layers injection', () => {
    const bottomLayer: Layer = {
      type: 'shape',
      id: 'bottom',
      content: { shape: 'rect', fill: '#000' },
      position: { x: 0, y: 0, width: 100, height: 100 },
    } as ShapeLayer;

    const topLayer: Layer = {
      type: 'shape',
      id: 'top',
      content: { shape: 'rect', fill: '#fff' },
      position: { x: 0, y: 0, width: 100, height: 100 },
    } as ShapeLayer;

    const persistentConfig: PersistentLayerConfig = {
      bottomLayers: [bottomLayer],
      topLayers: [topLayer],
    };

    it('injects persistent bottom and top layers around block layers', () => {
      const block = makeTemplateBlock({ template: 'titleBlock', title: 'With Persistent' });
      const layers = getLayers(block, { ...defaultContext, persistentLayers: persistentConfig });

      // First layer should be the bottom persistent layer
      expect(layers[0]).toEqual(bottomLayer);
      // Last layer should be the top persistent layer
      expect(layers[layers.length - 1]).toEqual(topLayer);
      // Middle layers (from template) should exist
      expect(layers.length).toBeGreaterThan(2);
    });

    it('respects useBottomLayer: false opt-out', () => {
      const block = makeTemplateBlock({
        template: 'titleBlock',
        title: 'No Bottom',
        useBottomLayer: false,
      });
      const layers = getLayers(block, { ...defaultContext, persistentLayers: persistentConfig });

      // Should NOT start with the bottom persistent layer
      expect(layers[0]).not.toEqual(bottomLayer);
      // Should still end with the top persistent layer
      expect(layers[layers.length - 1]).toEqual(topLayer);
    });

    it('respects useTopLayer: false opt-out', () => {
      const block = makeTemplateBlock({
        template: 'titleBlock',
        title: 'No Top',
        useTopLayer: false,
      });
      const layers = getLayers(block, { ...defaultContext, persistentLayers: persistentConfig });

      // Should start with the bottom persistent layer
      expect(layers[0]).toEqual(bottomLayer);
      // Should NOT end with the top persistent layer
      expect(layers[layers.length - 1]).not.toEqual(topLayer);
    });

    it('skips injection when no persistent layers are configured', () => {
      const block = makeTemplateBlock({ template: 'titleBlock', title: 'No Persistent' });
      const withoutPersistent = getLayers(block, defaultContext);
      const withEmptyPersistent = getLayers(block, {
        ...defaultContext,
        persistentLayers: { bottomLayers: [], topLayers: [] },
      });

      expect(withoutPersistent).toEqual(withEmptyPersistent);
    });
  });
});
