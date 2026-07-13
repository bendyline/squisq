import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DocControlsSlideshow } from '../DocControlsSlideshow';
import type { PlaybackState, SlideNavActions } from '../types';

const slides = [
  { id: 'intro', label: '1', summary: 'Introduction' },
  { id: 'results', label: '2', summary: 'Key results' },
  { id: 'next', label: '3', summary: 'What comes next' },
];

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
    captionMode: 'off',
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

  it('opens an upward slide picker with block summaries', () => {
    const { getByTestId, getByRole } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: 1, totalBlocks: slides.length })}
        slideNav={makeSlideNav()}
        slides={slides}
      />,
    );

    fireEvent.click(getByTestId('slide-counter'));

    const picker = getByRole('menu', { name: 'Choose a slide' });
    expect(picker.style.bottom).toBe('calc(100% + 8px)');
    expect(getByTestId('slide-picker-item-0').textContent).toContain('1Introduction');
    expect(getByTestId('slide-picker-item-1').textContent).toContain('2Key results');
    expect(getByTestId('slide-picker-item-1').getAttribute('aria-current')).toBe('true');
  });

  it('uses the available player height above the toolbar', () => {
    const { getByTestId } = render(
      <div className="doc-player">
        <DocControlsSlideshow
          state={makeState({ currentBlockIndex: 1, totalBlocks: slides.length })}
          slideNav={makeSlideNav()}
          slides={slides}
        />
      </div>,
    );
    const controls = getByTestId('slideshow-controls');
    const player = controls.parentElement as HTMLElement;
    const rect = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        top,
        right: 640,
        bottom: top + height,
        left: 0,
        width: 640,
        height,
        toJSON: () => ({}),
      }) as DOMRect;
    const playerBounds = vi.spyOn(player, 'getBoundingClientRect').mockReturnValue(rect(0, 480));
    const controlsBounds = vi
      .spyOn(controls, 'getBoundingClientRect')
      .mockReturnValue(rect(420, 40));

    fireEvent.click(getByTestId('slide-counter'));

    expect(getByTestId('slide-picker').style.maxHeight).toBe('396px');
    playerBounds.mockRestore();
    controlsBounds.mockRestore();
  });

  it('navigates directly to a selected slide and closes the picker', () => {
    let selectedIndex = -1;
    const { getByTestId, queryByTestId } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: 0, totalBlocks: slides.length })}
        slideNav={makeSlideNav({ goToSlide: (index) => (selectedIndex = index) })}
        slides={slides}
      />,
    );

    fireEvent.click(getByTestId('slide-counter'));
    fireEvent.click(getByTestId('slide-picker-item-2'));

    expect(selectedIndex).toBe(2);
    expect(queryByTestId('slide-picker')).toBeNull();
  });

  it('closes the slide picker with Escape', () => {
    const { getByTestId, queryByTestId } = render(
      <DocControlsSlideshow
        state={makeState({ currentBlockIndex: 0, totalBlocks: slides.length })}
        slideNav={makeSlideNav()}
        slides={slides}
      />,
    );

    fireEvent.click(getByTestId('slide-counter'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(queryByTestId('slide-picker')).toBeNull();
    expect(document.activeElement).toBe(getByTestId('slide-counter'));
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
