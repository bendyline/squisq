import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DocControlsSlideshow } from '../DocControlsSlideshow';
import type { PlaybackState, SlideNavActions } from '../types';

function makeState(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    isPlaying: false,
    currentTime: 0,
    totalDuration: 60,
    currentBlockIndex: 2,
    totalBlocks: 10,
    docProgress: 0.2,
    hasCaptions: false,
    captionsEnabled: false,
    currentSegmentIndex: 0,
    currentSegmentName: null,
    currentBlock: null,
    ...overrides,
  };
}

function makeSlideNav(overrides: Partial<SlideNavActions> = {}): SlideNavActions {
  return {
    nextSlide: overrides.nextSlide ?? (() => {}),
    prevSlide: overrides.prevSlide ?? (() => {}),
    goToSlide: overrides.goToSlide ?? (() => {}),
  };
}

describe('DocControlsSlideshow', () => {
  it('renders prev, next buttons and slide counter', () => {
    const { getByTestId } = render(
      <DocControlsSlideshow state={makeState()} slideNav={makeSlideNav()} />,
    );
    expect(getByTestId('slide-prev')).toBeTruthy();
    expect(getByTestId('slide-next')).toBeTruthy();
    expect(getByTestId('slide-counter')).toBeTruthy();
  });

  it('shows correct slide counter text', () => {
    const { getByTestId } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: 4, totalBlocks: 12 })}
        slideNav={makeSlideNav()}
      />,
    );
    expect(getByTestId('slide-counter').textContent).toBe('5 / 12');
  });

  it('disables prev button on first slide', () => {
    const { getByTestId } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: 0 })}
        slideNav={makeSlideNav()}
      />,
    );
    const prevBtn = getByTestId('slide-prev') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it('disables next button on last slide', () => {
    const { getByTestId } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: 9, totalBlocks: 10 })}
        slideNav={makeSlideNav()}
      />,
    );
    const nextBtn = getByTestId('slide-next') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it('enables both buttons on a middle slide', () => {
    const { getByTestId } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: 3, totalBlocks: 10 })}
        slideNav={makeSlideNav()}
      />,
    );
    const prevBtn = getByTestId('slide-prev') as HTMLButtonElement;
    const nextBtn = getByTestId('slide-next') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(false);
    expect(nextBtn.disabled).toBe(false);
  });

  it('calls nextSlide when next button is clicked', () => {
    let called = false;
    const nav = makeSlideNav({
      nextSlide: () => {
        called = true;
      },
    });
    const { getByTestId } = render(<DocControlsSlideshow state={makeState()} slideNav={nav} />);
    fireEvent.click(getByTestId('slide-next'));
    expect(called).toBe(true);
  });

  it('calls prevSlide when prev button is clicked', () => {
    let called = false;
    const nav = makeSlideNav({
      prevSlide: () => {
        called = true;
      },
    });
    const { getByTestId } = render(<DocControlsSlideshow state={makeState()} slideNav={nav} />);
    fireEvent.click(getByTestId('slide-prev'));
    expect(called).toBe(true);
  });

  it('shows dash for empty doc', () => {
    const { getByTestId } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: -1, totalBlocks: 0 })}
        slideNav={makeSlideNav()}
      />,
    );
    expect(getByTestId('slide-counter').textContent).toBe('—');
  });

  it('has correct aria-labels', () => {
    const { getByTestId } = render(
      <DocControlsSlideshow state={makeState()} slideNav={makeSlideNav()} />,
    );
    expect(getByTestId('slide-prev').getAttribute('aria-label')).toBe('Previous slide');
    expect(getByTestId('slide-next').getAttribute('aria-label')).toBe('Next slide');
  });
});
