import { describe, expect, it } from 'vitest';
import {
  extractContent,
  stripMarkdown,
  type ExtractionResult,
} from '../generate/contentExtractor.js';

const SAMPLE_TEXT = [
  'Mount Rainier is the largest volcano in the Cascades, standing at 14,411 feet.',
  'In July 1899, the mountain was designated a national park.',
  'The park sees roughly 2 million visitors each year.',
  '"The mountain was calling me," wrote John Muir after his 1888 expedition.',
  'Temperatures range from 20 degrees to 70 degrees depending on elevation.',
  'The park features hiking, camping, fishing, and climbing.',
  'Imagine standing above the clouds at sunrise!',
  'Paradise is a popular visitor area known for its wildflower meadows.',
  'Rainier is the most glaciated peak in the lower 48 states.',
].join(' ');

describe('extractContent', () => {
  let result: ExtractionResult;

  // Run extraction once for all tests
  it('extracts elements from sample text', () => {
    result = extractContent(SAMPLE_TEXT);
    expect(result.elements.length).toBeGreaterThan(0);
    expect(result.sourceLength).toBe(SAMPLE_TEXT.length);
  });

  it('finds stats', () => {
    const stats = result.elements.filter((e) => e.type === 'stat');
    expect(stats.length).toBeGreaterThan(0);
    // Should find 14,411 feet and/or 2 million
    const values = stats.map((s) => (s.data.type === 'stat' ? s.data.value : ''));
    expect(
      values.some((v) => v.includes('14,411') || v.includes('2 million') || v.includes('feet')),
    ).toBe(true);
  });

  it('finds dates', () => {
    const dates = result.elements.filter((e) => e.type === 'date');
    expect(dates.length).toBeGreaterThan(0);
  });

  it('finds quotes', () => {
    const quotes = result.elements.filter((e) => e.type === 'quote');
    expect(quotes.length).toBeGreaterThan(0);
    const quoteData = quotes[0].data;
    if (quoteData.type === 'quote') {
      expect(quoteData.quote).toContain('mountain was calling me');
    }
  });

  it('respects minConfidence filter', () => {
    const strict = extractContent(SAMPLE_TEXT, { minConfidence: 0.9 });
    const loose = extractContent(SAMPLE_TEXT, { minConfidence: 0.1 });
    expect(loose.elements.length).toBeGreaterThanOrEqual(strict.elements.length);
  });

  it('respects types filter', () => {
    const onlyStats = extractContent(SAMPLE_TEXT, { types: ['stat'] });
    for (const elem of onlyStats.elements) {
      expect(elem.type).toBe('stat');
    }
  });

  it('respects maxPerType', () => {
    const limited = extractContent(SAMPLE_TEXT, { maxPerType: 1 });
    const typeCounts = new Map<string, number>();
    for (const elem of limited.elements) {
      typeCounts.set(elem.type, (typeCounts.get(elem.type) ?? 0) + 1);
    }
    for (const count of typeCounts.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('deduplicates overlapping extractions', () => {
    // Every element should have a unique source position range
    for (let i = 0; i < result.elements.length; i++) {
      for (let j = i + 1; j < result.elements.length; j++) {
        const a = result.elements[i];
        const b = result.elements[j];
        // They shouldn't share the exact same start position
        if (a.sourcePosition === b.sourcePosition) {
          // If they overlap, one should have been removed by dedup
          // (this is checking that the dedup is working at all)
          expect(a.type).not.toBe(b.type);
        }
      }
    }
  });

  it('returns correct stats counts', () => {
    expect(result.stats.totalCount).toBe(result.elements.length);
    expect(result.stats.statCount).toBe(result.elements.filter((e) => e.type === 'stat').length);
  });

  it('sorts elements by source position', () => {
    for (let i = 1; i < result.elements.length; i++) {
      expect(result.elements[i].sourcePosition).toBeGreaterThanOrEqual(
        result.elements[i - 1].sourcePosition,
      );
    }
  });
});

describe('extractContent — comparisons', () => {
  it('detects "from X to Y" comparisons', () => {
    const text = 'Temperatures range from 20 degrees to 70 degrees depending on altitude.';
    const result = extractContent(text, { types: ['comparison'] });
    expect(result.elements.length).toBeGreaterThan(0);
    const comp = result.elements[0].data;
    if (comp.type === 'comparison') {
      expect(comp.left.label).toBeTruthy();
      expect(comp.right.label).toBeTruthy();
    }
  });
});

describe('extractContent — impact lines', () => {
  it('detects short punchy sentences', () => {
    const text =
      'Imagine standing above the clouds! Discover the hidden valley. The weather is variable.';
    const result = extractContent(text, { types: ['impactLine'] });
    expect(result.elements.length).toBeGreaterThan(0);
  });
});

describe('extractContent — lists', () => {
  it('detects "including X, Y, and Z" lists', () => {
    const text = 'Activities including hiking, camping, fishing, and climbing are popular.';
    const result = extractContent(text, { types: ['list'] });
    expect(result.elements.length).toBeGreaterThan(0);
    const listData = result.elements[0].data;
    if (listData.type === 'list') {
      expect(listData.items.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('extractContent — definitions', () => {
  it('detects "Term is a definition" patterns', () => {
    const text =
      'Paradise is a popular visitor area known for its wildflower meadows and scenic viewpoints.';
    const result = extractContent(text, { types: ['definition'] });
    expect(result.elements.length).toBeGreaterThan(0);
    const defData = result.elements[0].data;
    if (defData.type === 'definition') {
      expect(defData.term).toBe('Paradise');
    }
  });
});

describe('stripMarkdown', () => {
  it('removes headers', () => {
    expect(stripMarkdown('# Hello\n## World')).toBe('Hello\nWorld');
  });

  it('removes bold and italic', () => {
    expect(stripMarkdown('**bold** and *italic*')).toBe('bold and italic');
  });

  it('removes links, keeping text', () => {
    expect(stripMarkdown('[Click here](https://example.com)')).toBe('Click here');
  });

  it('removes images entirely', () => {
    expect(stripMarkdown('![alt text](image.png)')).toBe('');
  });

  it('removes code blocks', () => {
    expect(stripMarkdown('before\n```js\ncode\n```\nafter')).toBe('before\n\nafter');
  });

  it('removes blockquote markers', () => {
    expect(stripMarkdown('> quoted text')).toBe('quoted text');
  });

  it('collapses excess newlines', () => {
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
  });
});
