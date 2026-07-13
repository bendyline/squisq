import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, expandDocBlocks } from '../doc/templates/index.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import type { Block, Layer, TextLayer } from '../schemas/Doc.js';
import type { TemplateBlock } from '../schemas/BlockTemplates.js';

const titleBlock: TemplateBlock = {
  template: 'title',
  id: 'title-1',
  duration: 5,
  audioSegment: 0,
  title: 'A canonical materializer',
};

describe('materializeBlockLayers', () => {
  it('returns owned layers and metadata for built-in and authored blocks', () => {
    const templated = materializeBlockLayers(titleBlock, { persistentLayers: false });
    expect(templated.source).toBe('template');
    expect(templated.diagnostic).toBeUndefined();
    expect(templated.layers.length).toBeGreaterThan(0);

    const authoredLayer: Layer = {
      id: 'authored',
      type: 'shape',
      content: { shape: 'rect', fill: '#123456' },
      position: { x: 0, y: 0, width: 10, height: 10 },
    };
    const authored: Block = {
      id: 'raw',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      layers: [authoredLayer],
    };
    const materialized = materializeBlockLayers(authored, { persistentLayers: false });
    expect(materialized.source).toBe('authored');
    expect(materialized.layers).toEqual([authoredLayer]);
    expect(materialized.layers[0]).not.toBe(authoredLayer);
  });

  it('resolves document-scoped custom templates in the on-demand API', () => {
    const customTemplate: CustomTemplateDefinition = {
      name: 'hero',
      label: 'Hero',
      viewport: { width: 1920, height: 1080 },
      layers: [
        {
          id: 'hero-title',
          type: 'text',
          position: { x: '5%', y: '10%', width: '90%' },
          content: { text: '{title}', style: { fontSize: 64, color: '#000000' } },
        },
      ],
    };
    const block = {
      ...titleBlock,
      template: 'hero',
      title: 'Doc-scoped',
    } as unknown as TemplateBlock;

    const result = materializeBlockLayers(block, {
      customTemplates: [customTemplate],
      persistentLayers: false,
    });

    expect(result.source).toBe('template');
    expect((result.layers[0] as TextLayer).content.text).toBe('Doc-scoped');
  });

  it('returns structured diagnostics and a visible fallback without logging', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unknown = { ...titleBlock, template: 'not-registered' } as unknown as TemplateBlock;

    const result = materializeBlockLayers(unknown, { persistentLayers: false });

    expect(result.source).toBe('fallback');
    expect(result.diagnostic).toEqual({
      code: 'unknown-template',
      template: 'not-registered',
      message: 'Unknown template "not-registered"',
    });
    expect(result.layers.some((layer) => layer.id === 'fallback-notice')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('supports an explicit empty failure policy', () => {
    const unknown = { ...titleBlock, template: 'not-registered' } as unknown as TemplateBlock;
    const result = materializeBlockLayers(unknown, {
      failureMode: 'empty',
      persistentLayers: false,
    });

    expect(result.source).toBe('empty');
    expect(result.layers).toEqual([]);
    expect(result.diagnostic?.code).toBe('unknown-template');
  });

  it('inherits theme persistent layers by default and has an explicit opt-out', () => {
    const theme = {
      ...DEFAULT_THEME,
      persistentLayers: {
        bottomLayers: [
          {
            template: 'solidBackground' as const,
            config: { type: 'solidBackground' as const, color: '#123456' },
          },
        ],
      },
    };

    const inherited = materializeBlockLayers(titleBlock, { theme });
    const disabled = materializeBlockLayers(titleBlock, { theme, persistentLayers: false });

    expect(inherited.layers[0]?.id).toContain('solid');
    expect(disabled.layers[0]?.id).not.toContain('solid');
  });

  it('is the only materialization path used by timed expansion', () => {
    const diagnostics: string[] = [];
    const unknown = { ...titleBlock, template: 'not-registered' } as unknown as TemplateBlock;
    const direct = materializeBlockLayers(unknown, { persistentLayers: false });
    const [scheduled] = expandDocBlocks([unknown], {
      persistentLayers: false,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    });

    expect(scheduled.layers).toEqual(direct.layers);
    expect(diagnostics).toEqual(['unknown-template']);
  });
});
