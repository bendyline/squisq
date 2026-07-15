/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeCustomizerPanel } from '../ThemeCustomizerPanel';

const initialViewport = {
  width: window.innerWidth,
  height: window.innerHeight,
};

describe('ThemeCustomizerPanel', () => {
  afterEach(() => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: initialViewport.width },
      innerHeight: { configurable: true, value: initialViewport.height },
    });
  });

  it('clamps the popover inside a narrow viewport', () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 151 },
      innerHeight: { configurable: true, value: 800 },
    });

    const { container } = render(
      <ThemeCustomizerPanel value={null} onChange={() => undefined} triggerLabel="Theme..." />,
    );
    const customizer = container.querySelector<HTMLElement>('.squisq-theme-customizer')!;
    vi.spyOn(customizer, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 28,
      left: 17,
      right: 94,
      top: 12,
      width: 77,
      x: 17,
      y: 12,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Customize theme' }));

    const dialog = screen.getByRole('dialog', { name: 'Customize theme' });
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.left).toBe('8px');
    expect(dialog.style.top).toBe('40px');
    expect(dialog.style.width).toBe('135px');
    expect(dialog.style.maxHeight).toBe('748px');
  });
});
