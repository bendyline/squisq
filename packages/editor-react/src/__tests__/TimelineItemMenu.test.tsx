import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineItemMenu, type TimelineVideoMenuTarget } from '../TimelineItemMenu';

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const originalResizeObserver = globalThis.ResizeObserver;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
  if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight);
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});

describe('TimelineItemMenu viewport placement', () => {
  it('remeasures and clamps the menu when PIP controls make it taller', () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    let resizeObserver: ResizeObserver | undefined;

    class ResizeObserverStub implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
        resizeObserver = this;
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    globalThis.ResizeObserver = ResizeObserverStub;
    setViewport(500, 400);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('squisq-timeline-item-menu')) {
        const hasPipControls = this.querySelector('[aria-label="Picture-in-picture size"]') != null;
        return DOMRect.fromRect({ width: 320, height: hasPipControls ? 360 : 120 });
      }
      return DOMRect.fromRect();
    });

    const target: TimelineVideoMenuTarget = {
      kind: 'video',
      key: 'presenter',
      title: 'Presenter',
      placement: 'default',
      canUseContentPlacement: false,
      lockToBlock: false,
      absoluteStart: 0,
      defaultPipSize: 'small',
      defaultPipShape: 'square',
      defaultPipPosition: 'bottom-right',
    };

    render(
      <TimelineItemMenu
        anchor={{ top: 300, right: 490, bottom: 320, left: 460 }}
        target={target}
        onBlockDuration={vi.fn()}
        onBlockStartTime={vi.fn()}
        onBlockTransition={vi.fn()}
        onVideoPatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const menu = screen.getByRole('dialog', { name: 'Timeline video options' });
    expect(menu.style.top).toBe('175px');

    fireEvent.click(screen.getByRole('button', { name: 'PIP' }));
    expect(screen.getByRole('combobox', { name: 'Picture-in-picture size' })).toBeTruthy();
    act(() => resizeCallback?.([], resizeObserver!));

    expect(menu.style.top).toBe('8px');
    expect(menu.style.maxHeight).toBe('calc(100vh - 16px)');
  });
});
