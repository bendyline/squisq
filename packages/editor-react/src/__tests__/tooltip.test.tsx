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
});
