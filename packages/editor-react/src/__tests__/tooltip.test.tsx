import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipLayer } from '../Tooltip';
import { clampTooltipLeft } from '../tooltipPlacement';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalInnerWidth) {
    Object.defineProperty(window, 'innerWidth', originalInnerWidth);
  }
});

describe('TooltipLayer', () => {
  it('clamps centered tooltip placement inside the viewport', () => {
    expect(clampTooltipLeft(380, 120, 400)).toBe(272);
    expect(clampTooltipLeft(20, 120, 400)).toBe(8);
    expect(clampTooltipLeft(200, 120, 400)).toBe(140);
  });

  it('keeps a tooltip from spilling off the right edge', () => {
    vi.useFakeTimers();
    setViewportWidth(400);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('squisq-tooltip')) {
        return rect(0, 0, 120, 28);
      }
      return rect(0, 0, 0, 0);
    });

    render(
      <div>
        <button type="button" data-tooltip="View options">
          View
        </button>
        <TooltipLayer />
      </div>,
    );

    const button = screen.getByRole('button', { name: 'View' });
    Object.defineProperty(button, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(360, 10, 40, 32),
    });

    act(() => {
      fireEvent.mouseOver(button);
      vi.advanceTimersByTime(180);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('View options');
    expect(tooltip.style.left).toBe('272px');
    expect(tooltip.style.visibility).toBe('visible');
  });

  function pointer(type: string, target: Element, pointerType: 'mouse' | 'touch'): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target.dispatchEvent(event);
  }

  function renderButton() {
    render(
      <div>
        <button type="button" data-tooltip="Slideshow (⌘⇧3)">
          Slideshow
        </button>
        <span data-testid="elsewhere">Elsewhere</span>
        <TooltipLayer />
      </div>,
    );
    return screen.getByRole('button', { name: 'Slideshow' });
  }

  it('takes the tooltip down on click and keeps it down until the pointer leaves', () => {
    vi.useFakeTimers();
    const button = renderButton();

    act(() => {
      pointer('pointerover', button, 'mouse');
      fireEvent.mouseOver(button);
      vi.advanceTimersByTime(180);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();

    // Regression: the hint stayed up over whatever the click opened.
    act(() => pointer('pointerdown', button, 'mouse'));
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      fireEvent.mouseOver(button);
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      fireEvent.mouseOut(button, { relatedTarget: screen.getByTestId('elsewhere') });
      fireEvent.mouseOver(button);
      vi.advanceTimersByTime(180);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('shows no tooltip for the emulated hover that follows a tap', () => {
    vi.useFakeTimers();
    const button = renderButton();

    // Regression: "Write (⌘⇧1)" stuck over the phone toolbar after a tap.
    act(() => {
      pointer('pointerdown', button, 'touch');
      fireEvent.mouseOver(button);
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
