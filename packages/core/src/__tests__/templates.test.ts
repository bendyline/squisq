import { describe, it, expect } from 'vitest';
import {
  expandTemplateBlock,
  expandDocBlocks,
  getAvailableTemplates,
  hasTemplate,
  templateRegistry,
  createTemplateContext,
  DEFAULT_THEME,
  VIEWPORT_PRESETS,
} from '../doc/templates/index';
import type { TemplateBlock } from '../schemas/BlockTemplates';

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

describe('expandTemplateBlock', () => {
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
    const result = expandTemplateBlock(block, context);

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
    const result = expandTemplateBlock(block, context);
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
    const result = expandTemplateBlock(block, context);
    const imageLayer = (result.layers ?? []).find((l) => l.type === 'image');
    expect(imageLayer).toBeDefined();
    expect((imageLayer!.content as { fit?: string }).fit).toBe('contain');
    // Image is inset from the half's edges rather than filling them.
    expect(imageLayer!.position.x).toBe('5%');
    expect(imageLayer!.position.width).toBe('40%');
    expect(imageLayer!.position.y).toBe('5%');
    expect(imageLayer!.position.height).toBe('90%');
  });

  it('expands rightFeature template with image on the right half and right-aligned text left', () => {
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
    const result = expandTemplateBlock(block, context);
    const layers = result.layers ?? [];
    const imageLayer = layers.find((l) => l.type === 'image');
    expect(imageLayer).toBeDefined();
    expect(imageLayer!.position.x).toBe('50%');
    expect(imageLayer!.position.width).toBe('50%');
    const textLayers = layers.filter((l) => l.type === 'text');
    for (const t of textLayers) {
      expect(t.position.x).toBe('46%');
      expect(t.position.anchor).toBe('top-right');
      expect((t.content as { style: { textAlign?: string } }).style.textAlign).toBe('right');
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
    const result = expandTemplateBlock(block, context);

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
    const result = expandTemplateBlock(block, context);
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
      const result = expandTemplateBlock(block, context);
      expect(result.id).toBe(`test-${name}`);
      expect(result.layers ?? []).toBeInstanceOf(Array);
      // Each template should produce at least 1 layer
      expect((result.layers ?? []).length).toBeGreaterThanOrEqual(1);
    }
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
});

describe('DEFAULT_THEME', () => {
  it('has required color properties', () => {
    expect(DEFAULT_THEME.colors).toHaveProperty('primary');
    expect(DEFAULT_THEME.colors).toHaveProperty('background');
    expect(DEFAULT_THEME.colors).toHaveProperty('text');
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
