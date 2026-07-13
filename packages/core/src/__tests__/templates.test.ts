import { describe, it, expect } from 'vitest';
import {
  expandDocBlocks,
  getAvailableTemplates,
  hasTemplate,
  templateRegistry,
  createTemplateContext,
  DEFAULT_THEME,
  VIEWPORT_PRESETS,
} from '../doc/templates/index';
import type { TemplateBlock } from '../schemas/BlockTemplates';
import type { Block, Layer, TextLayer } from '../schemas/Doc';
import type { RuntimeTemplateRegistry } from '../doc/templates/index';
import { materializeBlockLayersWithRuntime } from '../doc/materializeBlockLayers';
import { materializeLayers } from './materializeTestUtils';
import { markdownToDoc } from '../doc/markdownToDoc';
import { parseMarkdown } from '../markdown/parse';

function materializeTemplateForTest(
  block: TemplateBlock,
  context: ReturnType<typeof createTemplateContext>,
  registry: RuntimeTemplateRegistry = templateRegistry as unknown as RuntimeTemplateRegistry,
): Block {
  const { layers } = materializeBlockLayersWithRuntime(
    block,
    {
      theme: context.theme,
      viewport: context.viewport,
      persistentLayers: false,
      blockIndex: context.blockIndex,
      totalBlocks: context.totalBlocks,
      failureMode: 'empty',
    },
    { registry, templateContext: context, applyRenderStyle: false },
  );
  return {
    id: block.id,
    startTime: 0,
    duration: block.duration,
    audioSegment: block.audioSegment,
    ...(layers.length > 0 ? { layers } : {}),
    transition: block.transition,
    template: block.template,
  };
}

describe('templateRegistry', () => {
  it('contains all expected templates', () => {
    const expected = [
      'title',
      'sectionHeader',
      'statHighlight',
      'quote',
      'factCard',
      'twoColumn',
      'dateEvent',
      'imageWithCaption',
      'leftFeature',
      'rightFeature',
      'map',
      'fullBleedQuote',
      'list',
      'photoGrid',
      'definitionCard',
      'comparisonBar',
      'pullQuote',
      'videoWithCaption',
      'videoPullQuote',
    ];
    for (const name of expected) {
      expect(templateRegistry).toHaveProperty(name);
      const tpl = (templateRegistry as Record<string, unknown>)[name];
      expect(typeof tpl).toBe('function');
    }
  });
});

describe('getAvailableTemplates', () => {
  it('returns array of template names', () => {
    const templates = getAvailableTemplates();
    expect(templates).toContain('title');
    expect(templates).toContain('sectionHeader');
    expect(templates.length).toBeGreaterThanOrEqual(15);
  });
});

describe('hasTemplate', () => {
  it('returns true for existing templates', () => {
    expect(hasTemplate('title')).toBe(true);
    expect(hasTemplate('statHighlight')).toBe(true);
  });

  it('returns false for unknown templates', () => {
    expect(hasTemplate('nonexistent')).toBe(false);
  });
});

describe('canonical template materialization', () => {
  it('expands titleSlide template into layers', () => {
    const block: TemplateBlock = {
      template: 'title',
      id: 'title-1',
      duration: 10,
      audioSegment: 0,
      title: 'Test Title',
      subtitle: 'Test Subtitle',
    };
    const context = createTemplateContext(DEFAULT_THEME, 0, 5, VIEWPORT_PRESETS.landscape);
    const result = materializeTemplateForTest(block, context);

    expect(result.id).toBe('title-1');
    expect(result.duration).toBe(10);
    expect(result.layers ?? []).toBeInstanceOf(Array);
    expect((result.layers ?? []).length).toBeGreaterThan(0);
  });

  it('expands leftFeature template with image on the left half and left-aligned text right', () => {
    const block: TemplateBlock = {
      template: 'leftFeature',
      id: 'lf-1',
      duration: 6,
      audioSegment: 0,
      imageSrc: 'hero.jpg',
      imageAlt: 'hero',
      title: 'Product Builder',
      body: 'I love building software platforms.',
    };
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const result = materializeTemplateForTest(block, context);
    const layers = result.layers ?? [];
    const imageLayer = layers.find((l) => l.type === 'image');
    expect(imageLayer).toBeDefined();
    expect(imageLayer!.position.x).toBe('0');
    expect(imageLayer!.position.width).toBe('50%');
    // Text column sits just past the 50% divider, top-left anchored,
    // so the title and body share a left edge with comfortable padding.
    const textLayers = layers.filter((l) => l.type === 'text');
    expect(textLayers.length).toBeGreaterThanOrEqual(1);
    for (const t of textLayers) {
      expect(t.position.x).toBe('54%');
      expect(t.position.anchor).toBe('top-left');
      expect((t.content as { style: { textAlign?: string } }).style.textAlign).toBe('left');
    }
  });

  it('respects explicit image dimensions: contained + padded inside the half', () => {
    // When the user resizes an image in the WYSIWYG editor it round-
    // trips as `<img width …>`. Feature blocks should treat that as a
    // hint to NOT stretch the image — render it centered with padding
    // around it.
    const block: TemplateBlock = {
      template: 'leftFeature',
      id: 'lf-sized',
      duration: 6,
      audioSegment: 0,
      imageSrc: 'hero.jpg',
      imageAlt: 'hero',
      imageWidth: 194,
      title: 'Sized',
    };
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const result = materializeTemplateForTest(block, context);
    const imageLayer = (result.layers ?? []).find((l) => l.type === 'image');
    expect(imageLayer).toBeDefined();
    expect((imageLayer!.content as { fit?: string }).fit).toBe('contain');
    // Image is inset from the half's edges rather than filling them.
    expect(imageLayer!.position.x).toBe('5%');
    expect(imageLayer!.position.width).toBe('40%');
    expect(imageLayer!.position.y).toBe('5%');
    expect(imageLayer!.position.height).toBe('90%');
  });

  it('expands rightFeature template with image on the right half and left-aligned text on the left', () => {
    const block: TemplateBlock = {
      template: 'rightFeature',
      id: 'rf-1',
      duration: 6,
      audioSegment: 0,
      imageSrc: 'hero.jpg',
      imageAlt: 'hero',
      title: 'Projects',
      body: 'A list of things.',
    };
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const result = materializeTemplateForTest(block, context);
    const layers = result.layers ?? [];
    const imageLayer = layers.find((l) => l.type === 'image');
    expect(imageLayer).toBeDefined();
    expect(imageLayer!.position.x).toBe('50%');
    expect(imageLayer!.position.width).toBe('50%');
    const textLayers = layers.filter((l) => l.type === 'text');
    for (const t of textLayers) {
      // The mirror lives in the layout only: the text column occupies the
      // left half, but the running text stays left-aligned for readability.
      expect(t.position.x).toBe('6%');
      expect(t.position.anchor).toBe('top-left');
      expect((t.content as { style: { textAlign?: string } }).style.textAlign).toBe('left');
    }
  });

  it('expands statHighlight template', () => {
    const block: TemplateBlock = {
      template: 'statHighlight',
      id: 'stat-1',
      duration: 8,
      audioSegment: 0,
      stat: '89%',
      description: 'drop in salmon',
    };
    const context = createTemplateContext(DEFAULT_THEME, 0, 5, VIEWPORT_PRESETS.landscape);
    const result = materializeTemplateForTest(block, context);

    expect((result.layers ?? []).length).toBeGreaterThan(0);
    // Should have at least a shape background + text layers
    const textLayers = (result.layers ?? []).filter((l) => l.type === 'text');
    expect(textLayers.length).toBeGreaterThan(0);
  });

  it('returns empty layers for unknown template', () => {
    const block = {
      template: 'nonexistent',
      id: 'unknown-1',
      duration: 5,
      audioSegment: 0,
    } as unknown as TemplateBlock;
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const result = materializeTemplateForTest(block, context);
    expect(result.layers ?? []).toEqual([]);
  });

  it('each registered template returns valid layers', () => {
    const templates = getAvailableTemplates();
    const context = createTemplateContext(DEFAULT_THEME, 0, 10, VIEWPORT_PRESETS.landscape);

    for (const name of templates) {
      // `getAvailableTemplates()` returns string[]; cast when creating a TemplateBlock
      const block = {
        template: name as TemplateBlock['template'],
        id: `test-${name}`,
        duration: 10,
        audioSegment: 0,
        // Provide common props that templates might need
        title: 'Test',
        subtitle: 'Subtitle',
        stat: '42',
        description: 'Description',
        detail: 'Detail',
        quote: 'Quote text',
        attribution: 'Author',
        fact: 'A fact',
        explanation: 'Explanation',
        text: 'Some text',
        date: '1776',
        left: { label: 'Left', sublabel: 'Sub' },
        right: { label: 'Right', sublabel: 'Sub' },
        items: ['one', 'two', 'three'],
        images: [
          { src: 'test1.jpg', alt: 'Test 1' },
          { src: 'test2.jpg', alt: 'Test 2' },
        ],
        imageSrc: 'test.jpg',
        backgroundImage: { src: 'bg.jpg', alt: 'Background' },
        backgroundVideo: { src: 'test.mp4', alt: 'Video', clipStart: 0, clipEnd: 5 },
        videoSrc: 'test.mp4',
        caption: 'Caption text',
        term: 'Term',
        definition: 'Definition',
        leftLabel: 'A',
        rightLabel: 'B',
        leftValue: 50,
        rightValue: 50,
      } as unknown as TemplateBlock;
      const result = materializeTemplateForTest(block, context);
      expect(result.id).toBe(`test-${name}`);
      expect(result.layers ?? []).toBeInstanceOf(Array);
      // Each template should produce at least 1 layer
      expect((result.layers ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps photoGrid media captions compact without placeholder alt labels', () => {
    const block: TemplateBlock = {
      template: 'photoGrid',
      id: 'photo-grid-captions',
      duration: 10,
      audioSegment: 0,
      images: [
        { src: 'one.jpg', alt: 'A long archival caption for the first image' },
        { src: 'two.jpg', alt: 'A long archival caption for the second image' },
        { src: 'three.jpg', alt: 'A long archival caption for the third image' },
      ],
      caption:
        'A long Wikimedia description with source notes, place names, dates, and details that should remain compact.',
    };

    const context = createTemplateContext(DEFAULT_THEME, 0, 10, VIEWPORT_PRESETS.landscape);
    const result = materializeTemplateForTest(block, context);
    const layers = result.layers ?? [];
    const captionLayer = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'caption',
    );

    expect(layers.some((layer) => layer.id.startsWith('grid-alt-'))).toBe(false);
    expect(captionLayer).toBeDefined();
    expect(captionLayer!.content.style.maxLines).toBe(1);
    expect(captionLayer!.position.width).toBe('78%');
  });

  it('clamps full-bleed media captions above playback controls', () => {
    const imageBlock: TemplateBlock = {
      template: 'imageWithCaption',
      id: 'image-caption',
      duration: 10,
      audioSegment: 0,
      imageSrc: 'image.jpg',
      imageAlt: 'Image',
      caption:
        'A long Wikimedia description with source notes, place names, dates, and details that should remain compact.',
    };
    const videoBlock: TemplateBlock = {
      template: 'videoWithCaption',
      id: 'video-caption',
      duration: 10,
      audioSegment: 0,
      videoSrc: 'video.mp4',
      videoAlt: 'Video',
      clipStart: 0,
      clipEnd: 10,
      caption: imageBlock.caption,
    };

    const context = createTemplateContext(DEFAULT_THEME, 0, 10, VIEWPORT_PRESETS.landscape);
    const imageCaption = (materializeTemplateForTest(imageBlock, context).layers ?? []).find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'caption',
    );
    const videoCaption = (materializeTemplateForTest(videoBlock, context).layers ?? []).find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'caption',
    );

    expect(imageCaption).toBeDefined();
    expect(videoCaption).toBeDefined();
    expect(imageCaption!.content.style.maxLines).toBe(2);
    expect(videoCaption!.content.style.maxLines).toBe(2);
    expect(imageCaption!.position.y).toBe('74%');
    expect(videoCaption!.position.y).toBe('74%');
    expect(imageCaption!.position.width).toBe('78%');
    expect(videoCaption!.position.width).toBe('78%');
  });
});

describe('expandDocBlocks', () => {
  it('expands array of template blocks with cumulative timing', () => {
    const blocks: TemplateBlock[] = [
      { template: 'title', id: 'slide-1', duration: 5, audioSegment: 0, title: 'Hello' },
      {
        template: 'factCard',
        id: 'slide-2',
        duration: 8,
        audioSegment: 0,
        fact: 'A fact',
        explanation: 'Why',
      },
      {
        template: 'statHighlight',
        id: 'slide-3',
        duration: 6,
        audioSegment: 0,
        stat: '99',
        description: 'percent',
      },
    ];

    const result = expandDocBlocks(blocks);
    expect(result).toHaveLength(3);
    expect(result[0].startTime).toBe(0);
    expect(result[1].startTime).toBe(5);
    expect(result[2].startTime).toBe(13);
  });

  it('expands with audio segment timing', () => {
    const blocks: TemplateBlock[] = [
      { template: 'sectionHeader', id: 'header-1', duration: 3, audioSegment: 0, title: 'Intro' },
      {
        template: 'factCard',
        id: 'fact-1',
        duration: 10,
        audioSegment: 0,
        fact: 'F',
        explanation: 'E',
      },
    ];

    const result = expandDocBlocks(blocks, {
      audioSegments: [{ startTime: 0, duration: 30 }],
    });

    expect(result.length).toBeGreaterThan(0);
    // First slide should start at 0
    expect(result[0].startTime).toBe(0);
  });

  it('never mutates or aliases raw blocks and persistent layers', () => {
    const rawLayer: Layer = {
      type: 'shape',
      id: 'raw-shape',
      content: { shape: 'rect', fill: '#112233' },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    const rawBlock: Block = {
      id: 'raw',
      startTime: 99,
      duration: 6,
      audioSegment: 0,
      layers: [rawLayer],
    };
    const persistentLayer: Layer = {
      type: 'shape',
      id: 'persistent',
      content: { shape: 'rect', fill: '#445566' },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    const beforeBlock = JSON.stringify(rawBlock);
    const beforePersistent = JSON.stringify(persistentLayer);

    const [expanded] = expandDocBlocks([rawBlock], {
      persistentLayers: { bottomLayers: [persistentLayer] },
      audioSegments: [{ startTime: 10, duration: 6 }],
    });

    expect(JSON.stringify(rawBlock)).toBe(beforeBlock);
    expect(JSON.stringify(persistentLayer)).toBe(beforePersistent);
    expect(expanded).not.toBe(rawBlock);
    expect(expanded.layers?.[0]).not.toBe(persistentLayer);
    expect(expanded.layers?.[1]).not.toBe(rawLayer);

    (expanded.layers?.[0] as Layer & { content: { fill: string } }).content.fill = '#ffffff';
    expect(JSON.stringify(persistentLayer)).toBe(beforePersistent);
    expect(expandDocBlocks([rawBlock])[0].layers).toHaveLength(1);
  });

  it('protects template inputs from mutating registry implementations', () => {
    const source: TemplateBlock = {
      template: 'title',
      id: 'title-safe',
      duration: 5,
      audioSegment: 0,
      title: 'Original',
    };
    const sharedLayer: Layer = {
      type: 'shape',
      id: 'shared-layer',
      content: { shape: 'rect', fill: '#112233' },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    const registry: RuntimeTemplateRegistry = {
      title: (input) => {
        (input as { title: string }).title = 'Mutated';
        return [sharedLayer];
      },
    };
    const first = materializeTemplateForTest(
      source,
      createTemplateContext(DEFAULT_THEME, 0, 1),
      registry,
    );
    const second = materializeTemplateForTest(
      source,
      createTemplateContext(DEFAULT_THEME, 0, 1),
      registry,
    );
    expect(source.title).toBe('Original');
    expect(first.layers?.[0]).not.toBe(sharedLayer);
    expect(first.layers?.[0]).not.toBe(second.layers?.[0]);
    (first.layers?.[0] as Layer & { content: { fill: string } }).content.fill = '#ffffff';
    expect((sharedLayer as Layer & { content: { fill: string } }).content.fill).toBe('#112233');
    expect((second.layers?.[0] as Layer & { content: { fill: string } }).content.fill).toBe(
      '#112233',
    );
  });

  it('supports landscape and portrait viewports', () => {
    const blocks: TemplateBlock[] = [
      { template: 'title', id: 'title-1', duration: 5, audioSegment: 0, title: 'Test' },
    ];

    const landscape = expandDocBlocks(blocks, { viewport: VIEWPORT_PRESETS.landscape });
    const portrait = expandDocBlocks(blocks, { viewport: VIEWPORT_PRESETS.portrait });

    expect(landscape).toHaveLength(1);
    expect(portrait).toHaveLength(1);
    // Both should produce valid blocks
    expect((landscape[0].layers ?? []).length).toBeGreaterThan(0);
    expect((portrait[0].layers ?? []).length).toBeGreaterThan(0);
  });

  describe('theme renderStyle wiring', () => {
    const blocks = (): TemplateBlock[] => [
      { template: 'title', id: 't-1', duration: 5, audioSegment: 0, title: 'One' },
      {
        template: 'imageWithCaption',
        id: 't-2',
        duration: 6,
        audioSegment: 0,
        imageSrc: 'photo.jpg',
        imageAlt: 'photo',
        caption: 'A caption',
      },
    ];

    it('fills the theme default transition on blocks after the first, never block 0', () => {
      const theme = {
        ...DEFAULT_THEME,
        renderStyle: {
          ...DEFAULT_THEME.renderStyle,
          defaultTransition: { type: 'dissolve' as const, duration: 1.1 },
        },
      };
      const result = expandDocBlocks(blocks(), { theme });
      expect(result[0].transition).toBeUndefined();
      expect(result[1].transition).toEqual({ type: 'dissolve', duration: 1.1 });
    });

    it('never overrides an authored block transition', () => {
      const theme = {
        ...DEFAULT_THEME,
        renderStyle: {
          ...DEFAULT_THEME.renderStyle,
          defaultTransition: { type: 'dissolve' as const },
        },
      };
      const authored = blocks();
      authored[1].transition = { type: 'cut' };
      const result = expandDocBlocks(authored, { theme });
      expect(result[1].transition).toEqual({ type: 'cut' });
    });

    it('scales template animation durations by theme animationSpeed', () => {
      const theme = {
        ...DEFAULT_THEME,
        style: { ...DEFAULT_THEME.style, animationSpeed: 2.0 },
      };
      const base = expandDocBlocks(blocks());
      const slowed = expandDocBlocks(blocks(), { theme });
      const baseTitle = base[0].layers?.find((l) => l.id === 'title');
      const slowedTitle = slowed[0].layers?.find((l) => l.id === 'title');
      expect(slowedTitle?.animation?.duration).toBe((baseTitle?.animation?.duration ?? 0) * 2);
    });

    it('gives full-bleed imagery ambient Ken Burns when the theme opts in', () => {
      const theme = {
        ...DEFAULT_THEME,
        renderStyle: { ...DEFAULT_THEME.renderStyle, ambientMotion: true },
      };
      const result = expandDocBlocks(blocks(), { theme });
      const bg = result[1].layers?.find((l) => l.id === 'bg-image');
      expect(bg?.animation?.type).toBe('slowZoom');
      // Standard theme (ambientMotion: false) leaves the image static.
      const plain = expandDocBlocks(blocks());
      const plainBg = plain[1].layers?.find((l) => l.id === 'bg-image');
      expect(plainBg?.animation).toBeUndefined();
    });

    it('themedEntrance: theme default text animation overrides entrance type, keeps timing', () => {
      const theme = {
        ...DEFAULT_THEME,
        renderStyle: { ...DEFAULT_THEME.renderStyle, defaultTextAnimation: 'zoomIn' as const },
      };
      const result = expandDocBlocks(blocks(), { theme });
      const title = result[0].layers?.find((l) => l.id === 'title');
      expect(title?.animation?.type).toBe('zoomIn');
      // Duration authored by the template is preserved (title uses 2s)
      expect(title?.animation?.duration).toBe(2);
    });

    it('templateHints: dramatic entrance switches statHighlight timing', () => {
      const statBlock: TemplateBlock[] = [
        {
          template: 'statHighlight',
          id: 's-1',
          duration: 5,
          audioSegment: 0,
          stat: '42%',
          description: 'described',
        },
      ];
      const theme = {
        ...DEFAULT_THEME,
        renderStyle: {
          ...DEFAULT_THEME.renderStyle,
          templateHints: { statHighlight: { entrance: 'dramatic' } },
        },
      };
      const hinted = expandDocBlocks(statBlock, { theme });
      const plain = expandDocBlocks(statBlock);
      const hintedStat = hinted[0].layers?.find((l) => l.id === 'stat');
      const plainStat = plain[0].layers?.find((l) => l.id === 'stat');
      expect(hintedStat?.animation?.duration).toBe(0.4);
      expect(plainStat?.animation?.duration).toBe(0.6);
    });

    it('theme persistentLayers render for docs without their own (wholesale precedence)', () => {
      const theme = {
        ...DEFAULT_THEME,
        persistentLayers: {
          bottomLayers: [
            {
              template: 'solidBackground' as const,
              config: { type: 'solidBackground' as const, color: '#112233' },
            },
          ],
        },
      };
      const inherited = expandDocBlocks(blocks(), { theme });
      expect(inherited[0].layers?.[0]?.id).toContain('solid');

      // Doc's own persistent layers win wholesale
      const docOwn = expandDocBlocks(blocks(), {
        theme,
        persistentLayers: {
          bottomLayers: [
            {
              template: 'solidBackground' as const,
              config: { type: 'solidBackground' as const, color: '#445566' },
            },
          ],
        },
      });
      const first = docOwn[0].layers?.[0];
      expect(first && 'content' in first && (first.content as { fill?: string }).fill).toBe(
        '#445566',
      );
    });
  });
});

describe('DEFAULT_THEME', () => {
  it('has required color properties', () => {
    expect(DEFAULT_THEME.colors).toHaveProperty('primary');
    expect(DEFAULT_THEME.colors).toHaveProperty('background');
    expect(DEFAULT_THEME.colors).toHaveProperty('text');
  });
});

describe('inline-param coercion → materializeBlockLayers', () => {
  function firstBlock(md: string) {
    return markdownToDoc(parseMarkdown(md), { generateCoverBlock: false }).blocks[0];
  }

  it('renders a map from pure-inline {[map center=… zoom=…]} annotation', () => {
    const block = firstBlock('# Downtown {[map center="47.6,-122.3" zoom=9 mapStyle="road"]}\n');
    // Raw overrides stay strings for lossless round-trip.
    expect(block.templateOverrides).toEqual({
      center: '47.6,-122.3',
      zoom: '9',
      mapStyle: 'road',
    });

    const layers = materializeLayers(block, {});
    const mapLayer = layers.find((l) => l.type === 'map');
    expect(mapLayer).toBeDefined();
    // Coerced center/zoom flow into the map layer's content — not empty strings.
    const content = mapLayer!.content as { center: { lat: number; lng: number }; zoom: number };
    expect(content.center).toEqual({ lat: 47.6, lng: -122.3 });
    expect(content.zoom).toBe(9);
  });

  it('renders a twoColumn from pure-inline labeled-pair annotation', () => {
    const block = firstBlock('# Coffee {[twoColumn left="Espresso|Bold" right="Filter|Smooth"]}\n');
    const layers = materializeLayers(block, {});
    // Guard requires both labels — a non-empty layer set proves coercion worked.
    expect(layers.length).toBeGreaterThan(0);
    const texts = layers
      .filter((l) => l.type === 'text')
      .map((l) => (l.content as { text: string }).text);
    expect(texts).toContain('Espresso');
    expect(texts).toContain('Filter');
    // The sublabels from the "|" split render too.
    expect(texts).toContain('Bold');
    expect(texts).toContain('Smooth');
  });
});

describe('shared template materialization', () => {
  it('keeps on-demand and timed expansion layer output in lockstep', () => {
    const block: TemplateBlock = {
      template: 'title',
      id: 'shared-title',
      duration: 7,
      audioSegment: 0,
      title: 'One materializer',
      subtitle: 'Two orchestration modes',
    };

    const onDemand = materializeLayers(block, { theme: DEFAULT_THEME });
    const [expanded] = expandDocBlocks([block], { theme: DEFAULT_THEME });

    expect(expanded.layers).toEqual(onDemand);
  });
});

describe('VIEWPORT_PRESETS', () => {
  it('has landscape and portrait presets', () => {
    expect(VIEWPORT_PRESETS).toHaveProperty('landscape');
    expect(VIEWPORT_PRESETS).toHaveProperty('portrait');
    expect(VIEWPORT_PRESETS.landscape.width).toBe(1920);
    expect(VIEWPORT_PRESETS.landscape.height).toBe(1080);
    expect(VIEWPORT_PRESETS.portrait.width).toBe(1080);
    expect(VIEWPORT_PRESETS.portrait.height).toBe(1920);
  });
});
