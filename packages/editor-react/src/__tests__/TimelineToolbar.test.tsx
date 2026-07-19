/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimelineToolbar } from '../TimelineToolbar';

afterEach(cleanup);

describe('TimelineToolbar', () => {
  it('independently toggles literal and composed video panes', () => {
    const onToggleLiteralVideo = vi.fn();
    const onToggleComposition = vi.fn();
    render(
      <TimelineToolbar
        literalVideoVisible
        compositionVisible={false}
        videoAvailable
        compositionAvailable
        onToggleLiteralVideo={onToggleLiteralVideo}
        onToggleComposition={onToggleComposition}
      />,
    );

    const literal = screen.getByRole('button', { name: 'Literal video' });
    const composition = screen.getByRole('button', { name: 'Video composition' });
    expect(literal.getAttribute('aria-pressed')).toBe('true');
    expect(composition.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(literal);
    fireEvent.click(composition);
    expect(onToggleLiteralVideo).toHaveBeenCalledOnce();
    expect(onToggleComposition).toHaveBeenCalledOnce();
  });

  it('disables only the literal pane when the document has no video', () => {
    render(
      <TimelineToolbar
        literalVideoVisible={false}
        compositionVisible={false}
        videoAvailable={false}
        compositionAvailable
        onToggleLiteralVideo={() => undefined}
        onToggleComposition={() => undefined}
      />,
    );

    expect(
      (screen.getByRole('button', { name: 'Literal video' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Video composition' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
