import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { DocPlayer } from '../DocPlayer';
import type { SlideshowControlsProps } from '../DocControlsSlideshow';

function twoSlideDoc(): Doc {
  return {
    articleId: 'host-controls',
    duration: 10,
    blocks: [
      { id: 'first', startTime: 0, duration: 5, audioSegment: 0, layers: [] },
      { id: 'second', startTime: 5, duration: 5, audioSegment: 0, layers: [] },
    ],
    audio: { segments: [] },
  };
}

describe('DocPlayer renderSlideshowControls', () => {
  it('draws the overlay pill when the host supplies no controls', () => {
    render(<DocPlayer doc={twoSlideDoc()} displayMode="slideshow" audioMode="synthetic" />);
    expect(screen.getByTestId('slideshow-controls').className).toBe('doc-controls-slideshow');
  });

  it("draws the host's controls in place of the pill, with live state and actions", () => {
    let latest: SlideshowControlsProps | null = null;
    const renderControls = vi.fn((controls: SlideshowControlsProps) => {
      latest = controls;
      return <output data-testid="host-controls">{controls.state.currentBlockIndex}</output>;
    });
    render(
      <DocPlayer
        doc={twoSlideDoc()}
        displayMode="slideshow"
        audioMode="synthetic"
        renderSlideshowControls={renderControls}
      />,
    );

    expect(document.querySelector('.doc-controls-slideshow')).toBeNull();
    expect(screen.getByTestId('host-controls').textContent).toBe('0');
    expect(latest!.slides?.map((slide) => slide.label)).toEqual(['1', '2']);

    act(() => latest!.slideNav.goToSlide(1));
    expect(screen.getByTestId('host-controls').textContent).toBe('1');

    act(() => latest!.onPickerOpenChange?.(true));
    expect(latest!.pickerOpen).toBe(true);
  });

  it('asks for no controls when showControls is off', () => {
    const renderControls = vi.fn(() => null);
    render(
      <DocPlayer
        doc={twoSlideDoc()}
        displayMode="slideshow"
        showControls={false}
        renderSlideshowControls={renderControls}
      />,
    );
    expect(renderControls).not.toHaveBeenCalled();
    expect(document.querySelector('.doc-controls-slideshow')).toBeNull();
  });
});
