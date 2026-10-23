import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { CaptionTrack } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { CaptionOverlay } from '../CaptionOverlay';
import {
  buildWordStream,
  estimateSocialRows,
  estimateSocialWordEm,
  SOCIAL_CAPTION_MAX_ROWS,
} from '../socialCaptionLayout';

const captions: CaptionTrack = {
  version: 1,
  phrases: [{ text: 'Lajos designs the brand system.', startTime: 0, endTime: 4, audioSegment: 0 }],
};

function overlayStyle(container: HTMLElement, className: string): CSSStyleDeclaration {
  const el = container.querySelector<HTMLElement>(`.${className}`);
  if (!el) throw new Error(`${className} not rendered`);
  return el.style;
}

describe('CaptionOverlay placement', () => {
  it('standard captions sit at the top by default and move to the bottom on request', () => {
    const top = render(<CaptionOverlay captions={captions} currentTime={1} />);
    expect(overlayStyle(top.container, 'caption-overlay').top).toBe('6px');

    const bottom = render(
      <CaptionOverlay captions={captions} currentTime={1} captionPosition="bottom" />,
    );
    expect(overlayStyle(bottom.container, 'caption-overlay').bottom).toBe('6px');
  });

  it('social captions sit in the lower band by default and move to the top on request', () => {
    const lower = render(
      <CaptionOverlay captions={captions} currentTime={1} captionStyle="social" />,
    );
    expect(overlayStyle(lower.container, 'social-caption-overlay').bottom).toBe('16%');

    const top = render(
      <CaptionOverlay
        captions={captions}
        currentTime={1}
        captionStyle="social"
        captionPosition="top"
      />,
    );
    expect(overlayStyle(top.container, 'social-caption-overlay').top).toBe('8%');
  });
});

describe('Social caption layout', () => {
  const longCaptions: CaptionTrack = {
    version: 1,
    phrases: [
      {
        text: 'Strange songs the massive whales sing under the reef',
        startTime: 0,
        endTime: 5,
        audioSegment: 0,
      },
    ],
  };

  it('wraps words onto rows and keeps a portrait safe area above short-form UI', () => {
    const { container } = render(
      <CaptionOverlay
        captions={longCaptions}
        currentTime={1}
        captionStyle="social"
        viewport={{ width: 1080, height: 1920, name: 'portrait' }}
      />,
    );
    const band = overlayStyle(container, 'social-caption-overlay');
    expect(band.bottom).toBe('24%');
    const chunk = overlayStyle(container, 'social-caption-overlay__chunk');
    expect(chunk.flexWrap).toBe('wrap');
    expect(chunk.whiteSpace).toBe('normal');
    // Type follows the narrower axis: 6.8% of 1080 ≈ 73px, not 5.5% of 1920.
    expect(chunk.fontSize).toBe('73px');
    const words = container.querySelectorAll<HTMLElement>('.social-caption-overlay__word');
    expect(words.length).toBeGreaterThan(1);
    expect(container.querySelector('.social-caption-overlay__word.is-active')).not.toBeNull();
  });

  it('highlights the active word as a filled pill in the theme primary colour', () => {
    const { container } = render(
      <CaptionOverlay
        captions={longCaptions}
        currentTime={0.1}
        captionStyle="social"
        viewport={{ width: 1920, height: 1080, name: 'landscape' }}
      />,
    );
    const active = container.querySelector<HTMLElement>('.social-caption-overlay__word.is-active');
    expect(active).not.toBeNull();
    expect(active!.style.background).not.toBe('transparent');
    expect(overlayStyle(container, 'social-caption-overlay').bottom).toBe('16%');
  });
});

// Three rows climbed into the middle of portrait frames, over the picture.
describe('Social caption rows', () => {
  // The 1080×1920 portrait row: 86% of the width at 73px, less the chunk padding.
  const portraitRowEm = (1080 * 0.86) / 73 - 2 * 0.55;
  const narration: CaptionTrack = {
    version: 1,
    phrases: [
      {
        text: 'A constitutional monarchy since 1875, Tonga remained the only Pacific nation never colonised by a European power, Polynesia unbroken.',
        startTime: 0,
        endTime: 12,
        audioSegment: 0,
      },
      {
        text: 'Southernmost Ushuaia, the world’s southernmost city.',
        startTime: 12.2,
        endTime: 16,
        audioSegment: 1,
      },
    ],
  };

  it('never builds a chunk that would wrap onto a third row', () => {
    const { chunks } = buildWordStream(narration, portraitRowEm);
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) {
      expect(
        estimateSocialRows(
          chunk.words.map((w) => w.text),
          portraitRowEm,
        ),
      ).toBeLessThanOrEqual(SOCIAL_CAPTION_MAX_ROWS);
    }
  });

  it('measures capitals wider than lower-case counting would (M and W are an em wide)', () => {
    expect(estimateSocialWordEm('MMMM')).toBeGreaterThan(estimateSocialWordEm('IIII') * 2);
    expect(estimateSocialWordEm('Éire')).toBe(estimateSocialWordEm('EIRE'));
    expect(estimateSocialRows(['CONSTITUTIONAL', 'MONARCHY'], portraitRowEm)).toBe(2);
  });

  it('never lets a chunk run into the next audio segment', () => {
    const { chunks } = buildWordStream(narration, portraitRowEm);
    for (const chunk of chunks) expect(new Set(chunk.words.map((w) => w.segment)).size).toBe(1);
    // The second segment's first word opens its own chunk, at its own time.
    const first = chunks.find((c) => c.words[0].segment === 1)!;
    expect(first.words[0].text).toBe('Southernmost');
    expect(first.startTime).toBeCloseTo(12.2, 5);
  });

  it('shrinks a chunk whose single word is wider than a row instead of overflowing', () => {
    const word = 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch';
    const { container } = render(
      <CaptionOverlay
        captions={{
          version: 1,
          phrases: [{ text: word, startTime: 0, endTime: 4, audioSegment: 0 }],
        }}
        currentTime={1}
        captionStyle="social"
        viewport={{ width: 1080, height: 1920, name: 'portrait' }}
      />,
    );
    const size = parseInt(overlayStyle(container, 'social-caption-overlay__chunk').fontSize, 10);
    expect(size).toBeLessThan(73);
    expect(estimateSocialWordEm(word) * size).toBeLessThanOrEqual(portraitRowEm * 73);
  });
});

// All-caps serif captions read as shouting (Qualla feedback, 2026-10-22): a theme
// can set them in another face, in the narration's own casing.
describe('Social caption case', () => {
  const portraitRowEm = (1080 * 0.86) / 73 - 2 * 0.55;
  const narration: CaptionTrack = {
    version: 1,
    phrases: [
      {
        text: 'The mountains submerge at Tierra del Fuego, loop underwater through the Scotia Arc, then rise again as this final frozen extension of the American cordillera.',
        startTime: 0,
        endTime: 12,
        audioSegment: 0,
      },
    ],
  };

  it('sets as-written captions in the theme caption font, keeping their capitals', () => {
    const { container } = render(
      <CaptionOverlay
        captions={narration}
        currentTime={2}
        captionStyle="social"
        theme={resolveTheme('warm-earth')}
        viewport={{ width: 1080, height: 1920, name: 'portrait' }}
      />,
    );
    const chunk = overlayStyle(container, 'social-caption-overlay__chunk');
    expect(chunk.textTransform).toBe('none');
    expect(chunk.fontFamily).toContain('PT Sans');
  });

  it('keeps capitals in the title font when a theme sets no caption style', () => {
    const { container } = render(
      <CaptionOverlay
        captions={narration}
        currentTime={2}
        captionStyle="social"
        theme={resolveTheme('standard')}
        viewport={{ width: 1080, height: 1920, name: 'portrait' }}
      />,
    );
    expect(overlayStyle(container, 'social-caption-overlay__chunk').textTransform).toBe('uppercase');
  });

  it('starts a new chunk at a sentence end', () => {
    const sentences: CaptionTrack = {
      version: 1,
      phrases: [
        {
          text: 'Hold your breath. Ahead, icebergs glow blue.',
          startTime: 0,
          endTime: 4,
          audioSegment: 0,
          words: ['Hold', 'your', 'breath.', 'Ahead,', 'icebergs', 'glow', 'blue.'].map((text, i) => ({
            text,
            startTime: i * 0.5,
            endTime: i * 0.5 + 0.5,
          })),
        },
      ],
    };
    const { chunks } = buildWordStream(sentences, portraitRowEm, 'as-written');
    expect(chunks.map((c) => c.words.map((w) => w.text).join(' '))).toEqual([
      'Hold your breath.',
      'Ahead, icebergs glow blue.',
    ]);
    // A spoken title ends its paragraph without a full stop.
    const titled: CaptionTrack = {
      version: 1,
      phrases: [
        {
          text: 'Antarctic Peninsula',
          startTime: 0,
          endTime: 1,
          audioSegment: 0,
          words: [
            { text: 'Antarctic', startTime: 0, endTime: 0.5 },
            { text: 'Peninsula', startTime: 0.5, endTime: 1, paragraphEnd: true },
          ],
        },
        {
          text: 'The Lemaire Channel narrows.',
          startTime: 1,
          endTime: 3,
          audioSegment: 0,
          words: ['The', 'Lemaire', 'Channel', 'narrows.'].map((text, i) => ({ text, startTime: 1 + i * 0.5, endTime: 1.5 + i * 0.5 })),
        },
      ],
    };
    const titleChunks = buildWordStream(titled, portraitRowEm, 'as-written').chunks.map((c) => c.words.map((w) => w.text).join(' '));
    expect(titleChunks[0]).toBe('Antarctic Peninsula');
    expect(titleChunks[1].startsWith('The')).toBe(true);
  });

  it('measures mixed case narrower than capitals, and still never needs a third row', () => {
    expect(estimateSocialWordEm('submerge', 'as-written')).toBeLessThan(estimateSocialWordEm('submerge'));
    // Capitals measure the same either way (the widest faces).
    expect(estimateSocialWordEm('MMM', 'as-written')).toBeCloseTo(estimateSocialWordEm('MMM'), 1);
    const upper = buildWordStream(narration, portraitRowEm, 'upper').chunks;
    const asWritten = buildWordStream(narration, portraitRowEm, 'as-written').chunks;
    expect(asWritten.length).toBeLessThanOrEqual(upper.length);
    for (const chunk of asWritten) {
      expect(
        estimateSocialRows(
          chunk.words.map((w) => w.text),
          portraitRowEm,
          'as-written',
        ),
      ).toBeLessThanOrEqual(SOCIAL_CAPTION_MAX_ROWS);
    }
  });
});

// The last chunk used to stay up for the rest of the video, so a silent
// closing card carried the narration's final words.
describe('Social caption hold', () => {
  // Two four-word sentences make two chunks that break at the pause.
  const twoSentences: CaptionTrack = {
    version: 1,
    phrases: [
      { text: 'Penguins are going nowhere.', startTime: 0, endTime: 3, audioSegment: 0 },
      { text: 'Neither are the islanders.', startTime: 6, endTime: 8, audioSegment: 0 },
    ],
  };
  const wordsAt = (currentTime: number): string[] => {
    const { container } = render(
      <CaptionOverlay captions={twoSentences} currentTime={currentTime} captionStyle="social" />,
    );
    return [...container.querySelectorAll('.social-caption-overlay__word')].map(
      (w) => w.textContent?.trim() ?? '',
    );
  };

  it('keeps the chunk just finished up through a short pause', () => {
    expect(wordsAt(3.5).join(' ')).toMatch(/nowhere/i);
    expect(wordsAt(8.5).join(' ')).toMatch(/islanders/i);
  });

  it('clears the frame during a long pause and after the narration ends', () => {
    expect(wordsAt(4.5)).toEqual([]);
    expect(wordsAt(10)).toEqual([]);
  });
});
