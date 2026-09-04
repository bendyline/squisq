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
    expect(overlayStyle(lower.container, 'social-caption-overlay').bottom).toBe('18%');

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
