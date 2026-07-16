import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, expandDocBlocks } from '../doc/templates/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import { parseMarkdown } from '../markdown/parse.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import type {
  Block,
  ImageLayer,
  Layer,
  MermaidLayer,
  ShapeLayer,
  TextLayer,
  VideoLayer,
} from '../schemas/Doc.js';
import type { DocBlock, TemplateBlock } from '../schemas/BlockTemplates.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';

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
    expect(templated.layers.find((layer) => layer.id === 'title')?.position).toMatchObject({
      x: '50%',
      y: '48%',
      width: '80%',
    });
    expect(templated.layers.some((layer) => layer.id.endsWith('-rich-media-frame'))).toBe(false);

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
    const title = templated.layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'title',
    );
    const frame = templated.layers.find(
      (layer): layer is ShapeLayer =>
        layer.type === 'shape' && layer.id === 'title-1-rich-media-frame',
    );
    const mermaid = templated.layers.find(
      (layer): layer is MermaidLayer => layer.type === 'mermaid',
    );

    expect(templated.source).toBe('template');
    expect(title?.position.y).toBeTypeOf('number');
    expect(title?.position.y as number).toBeLessThan(VIEWPORT_PRESETS.landscape.height * 0.25);
    expect(frame?.position).toEqual({
      x: VIEWPORT_PRESETS.landscape.width * 0.08,
      y: VIEWPORT_PRESETS.landscape.height * 0.4,
      width: VIEWPORT_PRESETS.landscape.width * 0.84,
      height: VIEWPORT_PRESETS.landscape.height * 0.52,
    });
    expect(mermaid?.position.y as number).toBeGreaterThan(frame?.position.y as number);
  });

  it('materializes an explicit timeline fence as media inside a title block', () => {
    const timeline = [
      '                                          ▲ Start {#start column=12}                    ▲ Ship {#ship column=58}',
      'Milestones {#milestones start=12 end=76}: ●─────────────────────●───────────────────────●─────────────────────►',
      '                                                                ▼ Review {#review column=34}',
      '',
      '                                                           ▲ New event {#new-event column=29.007}',
      'New line {#new-line start=12 end=76}:     ─────────────────●──────────────────────────────────────────────────►',
    ].join('\n');
    const markdown = [
      '# About SquigglySquare {[title]}',
      '',
      'SquigglySquare -- **squisq** for short -- turns plain Markdown into designed, animated documents.',
      '',
      '```timeline',
      timeline,
      '```',
    ].join('\n');
    const doc = markdownToDoc(parseMarkdown(markdown), { generateCoverBlock: false });
    const source = doc.blocks[0] as DocBlock;
    const materialized = materializeBlockLayers(source, { persistentLayers: false });
    const frame = materialized.layers.find(
      (layer) => layer.id === 'about-squigglysquare-rich-media-frame',
    );
    const track = materialized.layers.find((layer) =>
      layer.id.startsWith('about-squigglysquare-embedded-timeline-1-timeline-track-'),
    );
    const eventLabels = materialized.layers
      .filter(
        (layer): layer is TextLayer =>
          layer.type === 'text' &&
          layer.id.startsWith('about-squigglysquare-embedded-timeline-1-timeline-event-label-'),
      )
      .map((layer) => layer.content.text);
    const pathStart =
      track?.type === 'path' ? /^M\s+([\d.]+)\s+([\d.]+)/.exec(track.content.d) : null;

    expect(source.template).toBe('title');
    expect(frame?.type).toBe('shape');
    expect(track?.type).toBe('path');
    expect(track?.position.y as number).toBeGreaterThan(frame?.position.y as number);
    expect(Number(pathStart?.[1])).toBeGreaterThan(frame?.position.x as number);
    expect(Number(pathStart?.[2])).toBeGreaterThan(frame?.position.y as number);
    expect(eventLabels).toEqual(expect.arrayContaining(['Start', 'Review', 'Ship', 'New event']));
  });

  it.each([
    {
      name: 'diagram',
      art: ['┌────────┐', '│  API   │', '└────────┘'].join('\n'),
      expectedLayerType: 'shape',
      expectedIdPart: 'node-card-',
      expectedPlacement: 'stacked',
    },
    {
      name: 'tree',
      art: ['src/', '├── index.ts', '└── utils/'].join('\n'),
      expectedLayerType: 'tree',
      expectedIdPart: '-tree',
      expectedPlacement: 'split',
    },
  ])(
    'materializes an explicit $name fence through the same title-media path',
    ({ name, art, expectedLayerType, expectedIdPart, expectedPlacement }) => {
      const markdown = [`# Embedded ${name} {[title]}`, '', `\`\`\`${name}`, art, '```'].join('\n');
      const doc = markdownToDoc(parseMarkdown(markdown), { generateCoverBlock: false });
      const block = doc.blocks[0] as DocBlock;
      const materialized = materializeBlockLayers(block, { persistentLayers: false });
      const frame = materialized.layers.find(
        (layer) => layer.id === `embedded-${name}-rich-media-frame`,
      );
      const embedded = materialized.layers.find(
        (layer) =>
          layer.id.startsWith(`embedded-${name}-embedded-${name}-1-`) &&
          layer.id.includes(expectedIdPart) &&
          layer.type === expectedLayerType,
      );

      expect(embedded?.type).toBe(expectedLayerType);
      if (expectedPlacement === 'split') {
        expect(frame?.position.x as number).toBeGreaterThan(VIEWPORT_PRESETS.landscape.width * 0.5);
      } else {
        expect(frame?.position.y).toBe(VIEWPORT_PRESETS.landscape.height * 0.4);
      }
    },
  );

  it('grids multiple unconsumed images inside one reserved title-media rectangle', () => {
    const doc = markdownToDoc(
      parseMarkdown(`# Gallery {[title]}

![First image](media/one.jpg)

![Second image](media/two.jpg)`),
      { generateCoverBlock: false },
    );
    const materialized = materializeBlockLayers(doc.blocks[0] as DocBlock, {
      persistentLayers: false,
    });
    const frame = materialized.layers.find((layer) => layer.id === 'gallery-rich-media-frame');
    const images = materialized.layers.filter(
      (layer): layer is ImageLayer => layer.type === 'image',
    );

    expect(frame?.type).toBe('shape');
    expect(images).toHaveLength(2);
    expect(images.map((image) => image.content.src)).toEqual(['media/one.jpg', 'media/two.jpg']);
    expect(images[0].position.y).toBe(images[1].position.y);
    expect(images[0].position.x as number).toBeLessThan(images[1].position.x as number);
    expect(images.every((image) => image.content.fit === 'contain')).toBe(true);
  });

  it('retains native media geometry and gives additional media an explicit inset', () => {
    const doc = markdownToDoc(
      parseMarkdown(`# Native gallery {[imageWithCaption]}

![Primary](media/primary.jpg)

![Additional](media/additional.jpg)`),
      { generateCoverBlock: false },
    );
    const materialized = materializeBlockLayers(doc.blocks[0] as DocBlock, {
      persistentLayers: false,
    });
    const primary = materialized.layers.find(
      (layer): layer is ImageLayer => layer.type === 'image' && layer.id === 'bg-image',
    );
    const additional = materialized.layers.find(
      (layer): layer is ImageLayer =>
        layer.type === 'image' && layer.id === 'native-gallery-embedded-image-1',
    );
    const frame = materialized.layers.find(
      (layer) => layer.id === 'native-gallery-rich-media-frame',
    );

    expect(primary?.position).toEqual({ x: 0, y: 0, width: '100%', height: '100%' });
    expect(frame?.position).toEqual({
      x: VIEWPORT_PRESETS.landscape.width * 0.54,
      y: VIEWPORT_PRESETS.landscape.height * 0.58,
      width: VIEWPORT_PRESETS.landscape.width * 0.42,
      height: VIEWPORT_PRESETS.landscape.height * 0.34,
    });
    expect(additional?.position.y as number).toBeGreaterThan(frame?.position.y as number);
  });

  it('matrices title media placement by asset and viewport aspect ratio', () => {
    const doc = markdownToDoc(
      parseMarkdown(`# Portrait {[title]}

<img src="media/portrait.jpg" alt="Portrait" width="400" height="900">`),
      { generateCoverBlock: false },
    );
    const source = doc.blocks[0] as DocBlock;
    const landscape = materializeBlockLayers(source, {
      persistentLayers: false,
      viewport: VIEWPORT_PRESETS.landscape,
    });
    const portrait = materializeBlockLayers(source, {
      persistentLayers: false,
      viewport: VIEWPORT_PRESETS.portrait,
    });
    const landscapeFrame = landscape.layers.find(
      (layer) => layer.id === 'portrait-rich-media-frame',
    );
    const portraitFrame = portrait.layers.find((layer) => layer.id === 'portrait-rich-media-frame');

    // A tall single asset uses a side rectangle in a landscape slide.
    expect(landscapeFrame?.position.x as number).toBeGreaterThan(
      VIEWPORT_PRESETS.landscape.width * 0.5,
    );
    expect(landscapeFrame?.position.height as number).toBeGreaterThan(
      VIEWPORT_PRESETS.landscape.height * 0.8,
    );
    // The portrait slide stacks the same asset below a full-width title band.
    expect(portraitFrame?.position.x).toBe(VIEWPORT_PRESETS.portrait.width * 0.06);
    expect(portraitFrame?.position.y as number).toBeGreaterThan(
      VIEWPORT_PRESETS.portrait.height * 0.35,
    );
    expect(portraitFrame?.position.width).toBe(VIEWPORT_PRESETS.portrait.width * 0.88);
  });

  it('uses a companion media column for ordinary text-first templates', () => {
    const block = {
      template: 'statHighlight',
      id: 'stat-with-diagram',
      duration: 5,
      audioSegment: 0,
      stat: '42%',
      description: 'A supporting measure',
      contents: [
        {
          type: 'code',
          lang: 'mermaid',
          value: 'flowchart LR\n  before --> after',
        },
      ],
    } as unknown as TemplateBlock;
    const materialized = materializeBlockLayers(block, { persistentLayers: false });
    const stat = materialized.layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'stat',
    );
    const frame = materialized.layers.find(
      (layer) => layer.id === 'stat-with-diagram-rich-media-frame',
    );
    const mermaid = materialized.layers.find(
      (layer): layer is MermaidLayer => layer.type === 'mermaid',
    );

    expect(stat?.position.x as number).toBeLessThan(VIEWPORT_PRESETS.landscape.width * 0.5);
    expect(frame?.position.x as number).toBeGreaterThan(VIEWPORT_PRESETS.landscape.width * 0.5);
    expect(mermaid?.position.x as number).toBeGreaterThan(VIEWPORT_PRESETS.landscape.width * 0.5);
  });

  it('treats fullBleedQuote as text-first despite its template name', () => {
    const block = {
      template: 'fullBleedQuote',
      id: 'impact-with-diagram',
      duration: 5,
      audioSegment: 0,
      text: 'The system changed.',
      contents: [
        {
          type: 'code',
          lang: 'mermaid',
          value: 'flowchart LR\n  old --> new',
        },
      ],
    } as unknown as TemplateBlock;
    const materialized = materializeBlockLayers(block, { persistentLayers: false });
    const impact = materialized.layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'impact-text',
    );
    const frame = materialized.layers.find(
      (layer) => layer.id === 'impact-with-diagram-rich-media-frame',
    );

    expect(frame?.position.y).toBe(VIEWPORT_PRESETS.landscape.height * 0.4);
    expect(impact?.position.y as number).toBeLessThan(frame?.position.y as number);
  });

  it('renders a heading-only quote once as the quote text', () => {
    const doc = markdownToDoc(parseMarkdown('# Words worth quoting {[quote]}'), {
      generateCoverBlock: false,
    });
    const materialized = materializeBlockLayers(doc.blocks[0] as DocBlock, {
      persistentLayers: false,
    });
    const quote = materialized.layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'quote',
    );

    expect(quote?.content.text).toBe('Words worth quoting');
    expect(materialized.layers.some((layer) => layer.id === 'quote-title')).toBe(false);
  });

  it('keeps the heading as a title when quote text is supplied as a template param', () => {
    const doc = markdownToDoc(parseMarkdown('# Context {[quote quote="Words worth quoting"]}'), {
      generateCoverBlock: false,
    });
    const materialized = materializeBlockLayers(doc.blocks[0] as DocBlock, {
      persistentLayers: false,
    });
    const textById = new Map(
      materialized.layers
        .filter((layer): layer is TextLayer => layer.type === 'text')
        .map((layer) => [layer.id, layer.content.text]),
    );

    expect(textById.get('quote-title')).toBe('Context');
    expect(textById.get('quote')).toBe('Words worth quoting');
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
