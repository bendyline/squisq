import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildPreviewDoc, expandDocBlocks, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { DocBlock } from '@bendyline/squisq/schemas';
import { BlockRenderer } from '../BlockRenderer';
import { DocPlayer } from '../DocPlayer';
import type { SquisqRenderAPI } from '../types';

function fixture() {
  return buildPreviewDoc(
    markdownToDoc(
      parseMarkdown(
        '## Approach {[list build=items buildEffect=appear duration=12]}\n\n- Discover\n  - [Interview](https://example.com)\n- Deliver\n\n## End {[content duration=5]}\n\nDone.\n',
      ),
    ),
    { interleaveImages: false },
  );
}
function visible(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLElement>(
      '.doc-player__block--active [data-squisq-build-step]',
    ),
  ].filter((node) => node.style.visibility !== 'hidden');
}

describe('slide and video builds', () => {
  it('static renderers show all, manual cursors hide inaccessible links without removing layout', () => {
    const block = expandDocBlocks(fixture().blocks as DocBlock[])[0]!;
    const view = render(<BlockRenderer block={block} blockTime={0} basePath="." />);
    const fragments = () => [
      ...view.container.querySelectorAll<HTMLElement>('[data-squisq-build-step]'),
    ];
    expect(fragments()).toHaveLength(3);
    expect(fragments().every((node) => node.style.visibility === 'visible')).toBe(true);
    view.rerender(
      <BlockRenderer
        block={block}
        blockTime={0}
        basePath="."
        buildPlayback={{ revealed: 1, progress: 1 }}
      />,
    );
    expect(fragments().map((node) => node.style.visibility)).toEqual([
      'visible',
      'hidden',
      'hidden',
    ]);
    expect(fragments()[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(fragments()[1]!.hasAttribute('inert')).toBe(true);
    expect(fragments()[1]!.querySelector('a')?.textContent).toBe('Interview');
  });

  it('Next and Previous traverse steps before slides, including the last slide', async () => {
    const view = render(
      <DocPlayer
        doc={fixture()}
        displayMode="slideshow"
        showCoverSlide={false}
        animationsEnabled={false}
      />,
    );
    await waitFor(() => expect(screen.getByText('Build 0 of 3')).toBeTruthy());
    const next = () => fireEvent.click(screen.getByTestId('slide-next'));
    expect(visible(view.container)).toHaveLength(0);
    next();
    expect(visible(view.container)).toHaveLength(1);
    next();
    expect(visible(view.container)).toHaveLength(2);
    fireEvent.click(screen.getByTestId('slide-prev'));
    expect(visible(view.container)).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Show all build steps'));
    expect(visible(view.container)).toHaveLength(3);
    next();
    await waitFor(() =>
      expect(
        view.container
          .querySelector('.doc-player__block--active [data-block-id]')
          ?.getAttribute('data-block-id'),
      ).toBe('end'),
    );
    fireEvent.click(screen.getByTestId('slide-prev'));
    await waitFor(() => expect(visible(view.container)).toHaveLength(3));
  });

  it('video seek renders the requested build state independently of seek order, even with motion off', async () => {
    let api: SquisqRenderAPI | null = null;
    const view = render(
      <DocPlayer
        doc={fixture()}
        renderMode
        animationsEnabled={false}
        showCoverSlide={false}
        onRenderAPIReady={(value) => {
          api = value;
        }}
      />,
    );
    await waitFor(() => expect(api).not.toBeNull());
    for (const [time, count] of [
      [11, 3],
      [0, 0],
      [2, 1],
      [11, 3],
      [0, 0],
    ]) {
      await act(async () => {
        await api!.seekTo(time!);
      });
      expect(visible(view.container)).toHaveLength(count!);
    }
  });

  it('finishes an entrance before revealing another step, including the final entrance', async () => {
    const doc = buildPreviewDoc(
      markdownToDoc(
        parseMarkdown('## H {[list build=items buildDuration=10]}\n\n- First\n- Last\n'),
      ),
    );
    const view = render(<DocPlayer doc={doc} displayMode="slideshow" showCoverSlide={false} />);
    await waitFor(() => expect(screen.getByText('Build 0 of 2')).toBeTruthy());
    const next = screen.getByTestId('slide-next') as HTMLButtonElement;
    fireEvent.click(next);
    fireEvent.click(next);
    expect(visible(view.container)).toHaveLength(1);
    expect(visible(view.container)[0]!.style.opacity).toBe('1');
    fireEvent.click(next);
    expect(visible(view.container)).toHaveLength(2);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(visible(view.container)[1]!.style.opacity).toBe('1');
    expect(next.disabled).toBe(true);
  });

  it('a host can bypass build visibility for still capture', async () => {
    const view = render(
      <DocPlayer
        doc={fixture()}
        renderMode
        buildsEnabled={false}
        animationsEnabled={false}
        showCoverSlide={false}
      />,
    );
    await waitFor(() => expect(visible(view.container)).toHaveLength(3));
  });
});
