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
      'titleBlock',
      'sectionHeader',
      'statHighlight',
      'quoteBlock',
      'factCard',
      'twoColumn',
      'dateEvent',
      'imageWithCaption',
      'mapBlock',
      'fullBleedQuote',
      'listBlock',
      'photoGrid',
      'definitionCard',
      'comparisonBar',
      'pullQuote',
      'videoWithCaption',
      'videoPullQuote',
    ];
    for (const name of expected) {
      expect(templateRegistry).toHaveProperty(name);
      const tpl = (templateRegistry as any)[name];
      expect(typeof tpl).toBe('function');
    }
  });
});

describe('getAvailableTemplates', () => {
  it('returns array of template names', () => {
    const templates = getAvailableTemplates();
    expect(templates).toContain('titleBlock');
    expect(templates).toContain('sectionHeader');
    expect(templates.length).toBeGreaterThanOrEqual(15);
  });
});

describe('hasTemplate', () => {
  it('returns true for existing templates', () => {
    expect(hasTemplate('titleBlock')).toBe(true);
    expect(hasTemplate('statHighlight')).toBe(true);
  });

  it('returns false for unknown templates', () => {
    expect(hasTemplate('nonexistent')).toBe(false);
  });
});

describe('expandTemplateBlock', () => {
  it('expands titleSlide template into layers', () => {
    const block: TemplateBlock = {
      template: 'titleBlock',
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
    expect((result.layers ?? [])).toBeInstanceOf(Array);
    expect((result.layers ?? []).length).toBeGreaterThan(0);
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
    const block = ({
      template: 'nonexistent',
      id: 'unknown-1',
      duration: 5,
      audioSegment: 0,
    } as unknown) as TemplateBlock;
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const result = expandTemplateBlock(block, context);
    expect(result.layers ?? []).toEqual([]);
  });

  it('each registered template returns valid layers', () => {
    const templates = getAvailableTemplates();
    const context = createTemplateContext(DEFAULT_THEME, 0, 10, VIEWPORT_PRESETS.landscape);

    for (const name of templates) {
      // `getAvailableTemplates()` returns string[]; cast when creating a TemplateBlock
      const block = ({
        template: name as any,
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
        left: 'Left',
        right: 'Right',
        items: ['one', 'two', 'three'],
        images: [{ src: 'test1.jpg' }, { src: 'test2.jpg' }],
        imageSrc: 'test.jpg',
        backgroundImage: 'bg.jpg',
        backgroundVideo: { src: 'test.mp4' },
        videoSrc: 'test.mp4',
        caption: 'Caption text',
        term: 'Term',
        definition: 'Definition',
        leftLabel: 'A',
        rightLabel: 'B',
        leftValue: 50,
        rightValue: 50,
      } as unknown) as TemplateBlock;
      const result = expandTemplateBlock(block, context);
      expect(result.id).toBe(`test-${name}`);
      expect((result.layers ?? [])).toBeInstanceOf(Array);
      // Each template should produce at least 1 layer
      expect((result.layers ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('expandDocBlocks', () => {
  it('expands array of template blocks with cumulative timing', () => {
    const blocks: TemplateBlock[] = [
      { template: 'titleBlock', id: 'slide-1', duration: 5, audioSegment: 0, title: 'Hello' },
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
      { template: 'titleBlock', id: 'title-1', duration: 5, audioSegment: 0, title: 'Test' },
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
    expect(DEFAULT_THEME).toHaveProperty('primary');
    expect(DEFAULT_THEME).toHaveProperty('background');
    expect(DEFAULT_THEME).toHaveProperty('text');
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
