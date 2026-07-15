import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, expandDocBlocks } from '../doc/templates/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import { parseMarkdown } from '../markdown/parse.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import type { Block, Layer, TextLayer, VideoLayer } from '../schemas/Doc.js';
import type { DocBlock, TemplateBlock } from '../schemas/BlockTemplates.js';

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

  it('materializes Mermaid fences for empty and templated blocks', () => {
    const contents = [
      {
        type: 'code' as const,
        lang: 'mermaid',
        value: 'flowchart LR\n  start --> next',
      },
    ];
    const empty: Block = {
      id: 'rich-empty',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      contents,
    };
    const richOnly = materializeBlockLayers(empty, { persistentLayers: false });
    expect(richOnly.source).toBe('rich-content');
    expect(richOnly.layers).toHaveLength(1);
    expect(richOnly.layers[0]).toMatchObject({
      type: 'mermaid',
      content: { source: 'flowchart LR\n  start --> next' },
    });

    const templated = materializeBlockLayers(
      { ...titleBlock, contents } as unknown as TemplateBlock,
      { persistentLayers: false },
    );
    expect(templated.source).toBe('template');
    expect(templated.layers.some((layer) => layer.type === 'text')).toBe(true);
    expect(templated.layers.some((layer) => layer.type === 'mermaid')).toBe(true);
  });

  it('promotes an embedded video into explicitly templated slideshow blocks', () => {
    const doc = markdownToDoc(
      parseMarkdown(`# About {[title]}

Supporting copy.

<video src="video/demo.webm" poster="video/poster.png" aria-label="Product demo" controls></video>`),
      { generateCoverBlock: false },
    );
    const source = doc.blocks[0] as DocBlock;
    const direct = materializeBlockLayers(source, { persistentLayers: false });
    const video = direct.layers.find((layer): layer is VideoLayer => layer.type === 'video');

    expect(direct.layers.some((layer) => layer.type === 'text')).toBe(true);
    expect(video).toMatchObject({
      id: 'about-embedded-video-1',
      content: {
        src: 'video/demo.webm',
        posterSrc: 'video/poster.png',
        alt: 'Product demo',
        fit: 'contain',
        clipStart: 0,
        clipEnd: source.duration,
      },
    });

    // Slideshow and rendered-video playback both consume timed expansion of
    // this same materialization contract.
    const [scheduled] = expandDocBlocks([source], { persistentLayers: false });
    expect(scheduled.layers?.some((layer) => layer.type === 'video')).toBe(true);
  });

  it('auto-selects the video template without duplicating its derived layer', () => {
    const doc = markdownToDoc(
      parseMarkdown('# Demo\n\n<video src="clips/demo.mp4"><source src="ignored.webm"></video>'),
      { generateCoverBlock: false },
    );
    const source = doc.blocks[0] as DocBlock;
    const materialized = materializeBlockLayers(source, { persistentLayers: false });
    const videos = materialized.layers.filter(
      (layer): layer is VideoLayer => layer.type === 'video',
    );

    expect(source).toMatchObject({
      template: 'videoWithCaption',
      autoTemplate: true,
      templateData: {
        videoSrc: 'clips/demo.mp4',
        videoAlt: 'Demo',
        caption: 'Demo',
      },
    });
    expect(videos).toHaveLength(1);
    expect(videos[0].content).toMatchObject({
      src: 'clips/demo.mp4',
      clipStart: 0,
      clipEnd: source.duration,
    });
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
