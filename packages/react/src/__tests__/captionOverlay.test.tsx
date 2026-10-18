import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { CaptionTrack } from '@bendyline/squisq/schemas';
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
