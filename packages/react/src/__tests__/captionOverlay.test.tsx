import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { CaptionTrack } from '@bendyline/squisq/schemas';
import { CaptionOverlay } from '../CaptionOverlay';

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
      { text: 'Strange songs the massive whales sing under the reef', startTime: 0, endTime: 5, audioSegment: 0 },
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
    // Type follows the narrower axis: 8.2% of 1080 ≈ 89px, not 5.5% of 1920 clamped to 72.
    expect(chunk.fontSize).toBe('89px');
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
