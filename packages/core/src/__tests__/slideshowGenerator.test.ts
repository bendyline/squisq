import { describe, expect, it } from 'vitest';
import { generateSlideshow, type SlideshowImage } from '../generate/index.js';
import { isTemplateBlock } from '../schemas/BlockTemplates.js';

const ARTICLE_TEXT = [
  'Mount Rainier is the largest volcano in the Cascades, standing at 14,411 feet.',
  'In July 1899, President McKinley signed the act establishing Mount Rainier National Park.',
  'The park encompasses roughly 236,381 acres of old-growth forest and alpine meadows.',
  '"The mountain was calling me," wrote John Muir after his 1888 expedition to explore the glaciers.',
  'Temperatures range from 20 degrees to 70 degrees depending on elevation and season.',
  'Popular activities including hiking, camping, fishing, and climbing draw visitors year-round.',
  'Paradise is a popular visitor area known for its wildflower meadows and spectacular views.',
  'The mountain has 25 named glaciers covering about 35 square miles of ice.',
  'Rainier is the most glaciated peak in the lower 48 states, a remarkable natural wonder.',
  'Imagine standing above the clouds at sunrise!',
].join('\n\n');

const SAMPLE_IMAGES: SlideshowImage[] = [
  { src: '/img/rainier-1.jpg', alt: 'Mount Rainier from Paradise' },
  { src: '/img/rainier-2.jpg', alt: 'Wildflower meadow', credit: 'NPS Photo' },
  { src: '/img/rainier-3.jpg', alt: 'Nisqually Glacier' },
];

describe('generateSlideshow', () => {
  it('produces a valid Doc with blocks', () => {
    const doc = generateSlideshow(ARTICLE_TEXT);
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.duration).toBeGreaterThan(0);
    expect(doc.articleId).toBe('slideshow');
  });

  it('includes a title slide when title is provided', () => {
    const doc = generateSlideshow(ARTICLE_TEXT, [], { title: 'Mount Rainier' });
    expect(doc.articleId).toBe('Mount Rainier');
    const first = doc.blocks[0];
    if (isTemplateBlock(first)) {
      expect(first.template).toBe('titleBlock');
    }
  });

  it('embeds themeId in the Doc', () => {
    const doc = generateSlideshow(ARTICLE_TEXT, [], { themeId: 'cinematic' });
    expect(doc.themeId).toBe('cinematic');
  });

  it('interleaves image slides when images are provided', () => {
    const doc = generateSlideshow(ARTICLE_TEXT, SAMPLE_IMAGES);
    const imageSlides = doc.blocks.filter(
      (b) => isTemplateBlock(b) && b.template === 'imageWithCaption',
    );
    expect(imageSlides.length).toBeGreaterThan(0);
  });

  it('produces deterministic output with the same seed', () => {
    const a = generateSlideshow(ARTICLE_TEXT, SAMPLE_IMAGES, { seed: 42 });
    const b = generateSlideshow(ARTICLE_TEXT, SAMPLE_IMAGES, { seed: 42 });
    expect(a.blocks.length).toBe(b.blocks.length);
    for (let i = 0; i < a.blocks.length; i++) {
      if (isTemplateBlock(a.blocks[i]) && isTemplateBlock(b.blocks[i])) {
        const aBlock = a.blocks[i] as { template: string };
        const bBlock = b.blocks[i] as { template: string };
        expect(aBlock.template).toBe(bBlock.template);
      }
    }
  });

  it('produces different output with different seeds', () => {
    const a = generateSlideshow(ARTICLE_TEXT, SAMPLE_IMAGES, { seed: 1 });
    const b = generateSlideshow(ARTICLE_TEXT, SAMPLE_IMAGES, { seed: 999 });
    // At least some image accents or motions should differ
    const aSerialized = JSON.stringify(a.blocks);
    const bSerialized = JSON.stringify(b.blocks);
    // They should differ in at least some detail (ambient motions, accent positions)
    expect(aSerialized).not.toBe(bSerialized);
  });

  it('handles empty text gracefully', () => {
    const doc = generateSlideshow('', []);
    expect(doc.blocks.length).toBe(0);
    expect(doc.duration).toBe(0);
  });

  it('handles markdown input when isMarkdown is set', () => {
    const md = '# Title\n\nThe park covers **236,381 acres** of wilderness.';
    const doc = generateSlideshow(md, [], { isMarkdown: true });
    expect(doc.blocks.length).toBeGreaterThan(0);
  });

  it('uses explicit duration when provided', () => {
    const doc = generateSlideshow(ARTICLE_TEXT, [], { duration: 60 });
    expect(doc.duration).toBe(60);
  });

  it('respects targetSlides option', () => {
    const doc = generateSlideshow(ARTICLE_TEXT, [], { targetSlides: 3 });
    // Should have ~3 slides (may be slightly more due to title, images)
    expect(doc.blocks.length).toBeLessThanOrEqual(5);
    expect(doc.blocks.length).toBeGreaterThan(0);
  });

  it('every block has an id and duration', () => {
    const doc = generateSlideshow(ARTICLE_TEXT, SAMPLE_IMAGES, { title: 'Test' });
    for (const block of doc.blocks) {
      if (isTemplateBlock(block)) {
        expect(block.id).toBeTruthy();
        expect(block.duration).toBeGreaterThan(0);
      }
    }
  });

  it('rotates color schemes across content slides', () => {
    const doc = generateSlideshow(ARTICLE_TEXT, [], {
      colorSchemes: ['blue', 'green'],
      targetSlides: 6,
    });
    const colors: string[] = [];
    for (const block of doc.blocks) {
      if (isTemplateBlock(block) && 'colorScheme' in block) {
        const cs = (block as { colorScheme?: string }).colorScheme;
        if (cs) colors.push(cs);
      }
    }
    // With 2 schemes, we should see alternation
    if (colors.length >= 2) {
      expect(colors[0]).not.toBe(colors[1]);
    }
  });
});
