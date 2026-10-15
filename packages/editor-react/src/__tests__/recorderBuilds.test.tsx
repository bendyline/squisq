import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildRecorderSlideDeck } from '../recorder/slides/slideDeck';
import { RecorderSlidesPanel } from '../recorder/slides/RecorderSlidesPanel';

describe('recorder builds', () => {
  it('reveals and reports steps on the last slide before disabling Next', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        '## Approach {[list build=branches buildEffect=appear]}\n\n- Discover\n  - Interview\n- Deliver\n',
      ),
    );
    const slides = buildRecorderSlideDeck(doc, DEFAULT_THEME, VIEWPORT_PRESETS.landscape);
    const onIndexChange = vi.fn();
    const onBuildShown = vi.fn();
    const view = render(
      <RecorderSlidesPanel
        slides={slides}
        index={0}
        onIndexChange={onIndexChange}
        onBuildShown={onBuildShown}
        viewport={VIEWPORT_PRESETS.landscape}
        recording
      />,
    );
    const next = screen.getByRole('button', { name: 'Next slide' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByRole('status').textContent).toContain('Build 1 of 2');
    expect(
      view.container.querySelectorAll('[data-squisq-build-step="0"][aria-hidden="false"]'),
    ).toHaveLength(2);
    expect(onBuildShown).toHaveBeenLastCalledWith('approach', 0, expect.any(String));
    expect(onIndexChange).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(screen.getByRole('status').textContent).toContain('Build 2 of 2');
    expect(onBuildShown).toHaveBeenLastCalledWith('approach', 1, expect.any(String));
    expect(next.disabled).toBe(true);
    fireEvent.keyDown(view.container.firstChild!, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toContain('Build 2 of 2');
    expect(onIndexChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(screen.getByRole('status').textContent).toContain('Build 1 of 2');
  });
});
