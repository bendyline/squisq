import { describe, expect, it } from 'vitest';
import type { TextLayer, TextStyle } from '@bendyline/squisq/schemas';
import {
  averageCharEm,
  blockGapsEm,
  estimateSlideTextScale,
  estimateTextHeight,
  wrapByChars,
} from '../pptx/textFit';

function textLayer(
  id: string,
  text: string,
  position: TextLayer['position'],
  style: Partial<TextStyle> = {},
  html?: string,
): TextLayer {
  return {
    id,
    type: 'text',
    position,
    content: {
      text,
      ...(html ? { html } : {}),
      style: { fontSize: 40, lineHeight: 1.2, color: '#000000', ...style },
    },
  };
}

describe('estimateSlideTextScale', () => {
  it('grows a lone short line to the slideshow ceiling', () => {
    const layer = textLayer('t', 'Short', { x: 100, y: 100, width: 1600, height: 400 });
    expect(estimateSlideTextScale([layer])).toBe(2);
  });

  it('keeps text that already fills its box at its base size', () => {
    // Two lines at 40px × 1.2 need 96px; the box holds exactly that.
    const layer = textLayer('t', 'One\nTwo', { x: 100, y: 100, width: 1600, height: 96 });
    expect(estimateSlideTextScale([layer])).toBe(1);
  });

  it('stops growing before two text blocks newly overlap', () => {
    // Neither box has a height, so only the gap between them limits growth:
    // 48px of title text may reach 53px (the 52px gap plus the player's 1px
    // tolerance), and the scale floors to hundredths like the player's.
    const title = textLayer('title', 'Title', { x: 100, y: 100 }, { lineHeight: 1.2 });
    const body = textLayer('body', 'Body', { x: 100, y: 152 }, { lineHeight: 1.2 });
    expect(estimateSlideTextScale([title, body])).toBe(1.1);
  });

  it('reflows HTML text at the larger size instead of scaling its lines', () => {
    // A long paragraph in a fixed rich-text box: growing it adds lines, so it
    // stops short of the ceiling even though one line alone would reach it.
    const words = Array.from({ length: 60 }, () => 'word').join(' ');
    const layer = textLayer(
      'body',
      words,
      { x: 100, y: 100, width: 800, height: 500 },
      {},
      `<p>${words}</p>`,
    );
    const scale = estimateSlideTextScale([layer]);
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThan(2);
    expect(estimateTextHeight(layer, scale)).toBeLessThanOrEqual(501);
  });
});

describe('estimateTextHeight', () => {
  it('spaces rich-text blocks by margins, not blank lines', () => {
    const position = { x: 0, y: 0, width: 1600, height: 600 };
    const rich = textLayer('rich', 'One\n\nTwo', position, {}, '<p>One</p><p>Two</p>');
    const plain = textLayer('plain', 'One\n\nTwo', position);
    // Two lines plus a 0.4em paragraph gap, against three full lines.
    expect(estimateTextHeight(rich, 1)).toBeCloseTo(40 * 1.2 * 2 + 40 * 0.4, 5);
    expect(estimateTextHeight(plain, 1)).toBeCloseTo(40 * 1.2 * 3, 5);
  });

  it('keeps SVG line breaks from the base size and scales every line', () => {
    const layer = textLayer('t', 'alpha beta gamma delta', { x: 0, y: 0, width: 220 });
    // 220px at half an em (20px) a character wraps at 11 characters: 2 lines.
    expect(estimateTextHeight(layer, 1)).toBeCloseTo(2 * 48, 5);
    expect(estimateTextHeight(layer, 1.5)).toBeCloseTo(2 * 48 * 1.5, 5);
  });
});

describe('blockGapsEm', () => {
  it('folds blank runs into the next block, a full line per extra blank', () => {
    const gaps = blockGapsEm(
      [
        { text: 'Intro' },
        { text: '' },
        { text: 'Item', list: { ordered: false, level: 0 } },
        { text: '' },
        { text: '' },
        { text: 'After' },
      ],
      1.2,
    );
    expect(gaps).toEqual([0, null, 0.4, null, null, 0.7 + 1.2]);
  });
});

describe('wrapByChars', () => {
  it('wraps on words and breaks a word longer than a line', () => {
    expect(wrapByChars('aa bb cc', 5)).toEqual(['aa bb', 'cc']);
    expect(wrapByChars('abcdefgh', 3)).toEqual(['abc', 'def', 'gh']);
    expect(wrapByChars('   ', 5)).toEqual(['']);
  });
});

describe('averageCharEm', () => {
  it('distinguishes sans, serif, mono and bold', () => {
    const sans = averageCharEm({
      fontSize: 10,
      color: '#000',
      fontFamily: 'system-ui, sans-serif',
    });
    const serif = averageCharEm({ fontSize: 10, color: '#000', fontFamily: 'Georgia, serif' });
    const mono = averageCharEm({
      fontSize: 10,
      color: '#000',
      fontFamily: '"JetBrains Mono", monospace',
    });
    const bold = averageCharEm({
      fontSize: 10,
      color: '#000',
      fontFamily: 'system-ui',
      fontWeight: 'bold',
    });
    expect(serif).toBeGreaterThan(sans);
    expect(mono).toBeGreaterThan(serif);
    expect(bold).toBeGreaterThan(sans);
    // Office's estimate runs wider than the browser's, so exported text fits.
    expect(sans).toBeGreaterThan(
      averageCharEm({ fontSize: 10, color: '#000', fontFamily: 'system-ui' }, 'browser'),
    );
  });
});
