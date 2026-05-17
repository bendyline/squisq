import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import {
  profileBlockContents,
  recommendTemplatesForBlock,
} from '../recommend/templates.js';

const ALL_TEMPLATES = [
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
  'dataTable',
];

function profileOf(source: string) {
  const doc = parseMarkdown(source);
  return profileBlockContents(doc.children);
}

describe('profileBlockContents', () => {
  it('returns an empty profile for no nodes', () => {
    const p = profileBlockContents([]);
    expect(p.wordCount).toBe(0);
    expect(p.hasImage).toBe(false);
    expect(p.hasVideo).toBe(false);
  });

  it('detects a single markdown image', () => {
    const p = profileOf('![alt](https://example.com/a.png)');
    expect(p.imageCount).toBe(1);
    expect(p.hasImage).toBe(true);
  });

  it('detects an HTML <img> tag', () => {
    const p = profileOf('<img src="a.png" alt="x" />');
    expect(p.imageCount).toBe(1);
    expect(p.hasImage).toBe(true);
  });

  it('detects a blockquote', () => {
    const p = profileOf('> The mountain was calling me.');
    expect(p.hasBlockquote).toBe(true);
  });

  it('detects a bullet list', () => {
    const p = profileOf('- one\n- two\n- three');
    expect(p.hasList).toBe(true);
  });

  it('detects a GFM table', () => {
    const p = profileOf('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(p.hasTable).toBe(true);
  });

  it('detects a date string in body text', () => {
    const p = profileOf('Construction began in July 1899.');
    expect(p.hasDate).toBe(true);
  });

  it('detects an ISO date', () => {
    const p = profileOf('Launched on 2024-03-15.');
    expect(p.hasDate).toBe(true);
  });

  it('detects a prominent number paragraph', () => {
    const p = profileOf('$2.3M raised');
    expect(p.hasNumberHighlight).toBe(true);
  });

  it('detects a YouTube embed via link', () => {
    const p = profileOf('[Watch](https://www.youtube.com/watch?v=abc)');
    expect(p.hasVideo).toBe(true);
  });

  it('detects a <video> tag', () => {
    const p = profileOf('<video src="x.mp4"></video>');
    expect(p.hasVideo).toBe(true);
  });

  it('counts multiple images', () => {
    const p = profileOf(
      '![a](a.png)\n\n![b](b.png)\n\n![c](c.png)',
    );
    expect(p.imageCount).toBe(3);
  });
});

describe('recommendTemplatesForBlock', () => {
  it('falls back to universal defaults when nothing is detected', () => {
    const profile = profileBlockContents([]);
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toEqual(['title', 'sectionHeader', 'factCard', 'twoColumn']);
  });

  it('keeps recommended ordering aligned with the input list', () => {
    const profile = profileOf('![a](a.png)');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    // imageWithCaption comes before leftFeature/rightFeature in ALL_TEMPLATES
    expect(recommended.indexOf('imageWithCaption')).toBeLessThan(
      recommended.indexOf('leftFeature'),
    );
  });

  it('recommends image templates for blocks with one image (no photoGrid)', () => {
    const profile = profileOf('![a](a.png)');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toContain('imageWithCaption');
    expect(recommended).toContain('leftFeature');
    expect(recommended).toContain('rightFeature');
    expect(recommended).not.toContain('photoGrid');
  });

  it('adds photoGrid when 2+ images present', () => {
    const profile = profileOf('![a](a.png)\n\n![b](b.png)');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toContain('photoGrid');
  });

  it('recommends quote templates for blocks with blockquotes', () => {
    const profile = profileOf('> something memorable');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toContain('quote');
    expect(recommended).toContain('pullQuote');
    expect(recommended).toContain('fullBleedQuote');
  });

  it('recommends dateEvent for blocks with date strings', () => {
    const profile = profileOf('On March 5, 2024, the ribbon was cut.');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toContain('dateEvent');
  });

  it('recommends statHighlight for blocks with prominent numbers', () => {
    const profile = profileOf('$2.3M raised');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toContain('statHighlight');
  });

  it('recommends dataTable + comparisonBar for blocks with tables', () => {
    const profile = profileOf('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toContain('dataTable');
    expect(recommended).toContain('comparisonBar');
  });

  it('omits universal generics (factCard, twoColumn) when specific signal fires', () => {
    const profile = profileOf('> something memorable');
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    // title + sectionHeader still come along, but factCard/twoColumn do not
    expect(recommended).toContain('title');
    expect(recommended).toContain('sectionHeader');
    expect(recommended).not.toContain('factCard');
    expect(recommended).not.toContain('twoColumn');
  });

  it('combines multiple signals additively', () => {
    const profile = profileOf(
      '![a](a.png)\n\n> a great line\n\n- alpha\n- beta',
    );
    const { recommended } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(recommended).toContain('imageWithCaption');
    expect(recommended).toContain('quote');
    expect(recommended).toContain('list');
  });

  it('places unrecommended templates in the rest bucket', () => {
    const profile = profileOf('![a](a.png)');
    const { recommended, rest } = recommendTemplatesForBlock(profile, ALL_TEMPLATES);
    expect(rest).toContain('map');
    expect(rest).toContain('definitionCard');
    // No template appears in both buckets
    for (const name of recommended) expect(rest).not.toContain(name);
  });
});
