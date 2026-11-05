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

  it('reveals a concept block card by card, each card’s shape and words together', () => {
    const block = expandDocBlocks(
      markdownToDoc(
        parseMarkdown(
          '## Kinds {[cards build=items buildEffect=appear duration=12]}\n\n- Live: two doses\n- Non-live: three or more\n- Updated: every year\n',
        ),
      ).blocks as DocBlock[],
    )[0]!;
    const view = render(
      <BlockRenderer
        block={block}
        blockTime={0}
        basePath="."
        buildPlayback={{ revealed: 1, progress: 1 }}
      />,
    );
    const groups = [...view.container.querySelectorAll<SVGGElement>('g[data-squisq-build-step]')];
    // Each card's shape, rule, label and detail are separate layers in one step.
    expect(groups.length).toBeGreaterThan(3);
    const shown = groups.filter((group) => group.style.visibility === 'visible');
    expect(new Set(shown.map((group) => group.dataset.squisqBuildStep))).toEqual(new Set(['0']));
    expect(shown.map((group) => group.textContent).join(' ')).toContain('Live');
    expect(
      groups
        .filter((group) => group.dataset.squisqBuildStep === '1')
        .every((group) => group.style.visibility === 'hidden'),
    ).toBe(true);
  });

  it('times a building step’s entrances from its reveal, keeping their order within it', () => {
    const [block] = expandDocBlocks(
      [
        {
          id: 'kinds',
          template: 'cards',
          title: 'Kinds',
          items: ['Live: two doses', 'Non-live: three or more'],
          startTime: 0,
          duration: 12,
          audioSegment: 0,
          build: { mode: 'items', effect: 'fadeInUp' },
          buildTiming: { sourceText: '', starts: [] },
        } as unknown as DocBlock,
      ],
      { motion: 'documentary' },
    );
    const steps = [0, 1].map((index) =>
      Math.min(
        ...block!.layers!.filter((l) => l.buildStep === index).map((l) => l.animation!.delay!),
      ),
    );
    const view = render(
      <BlockRenderer block={block!} blockTime={9} basePath="." buildPlayback="timed" />,
    );
    const offsets = [0, 1].map((index) => {
      const group = view.container.querySelector<SVGGElement>(
        `g[data-squisq-build-step="${index}"]`,
      )!;
      return parseFloat(group.style.getPropertyValue('--squisq-step-offset'));
    });
    // Each step's earliest entrance starts at its reveal; the rest follow at
    // their authored spacing, since the offset shifts the whole step.
    const starts = [0, 1].map((index) => offsets[index]! + steps[index]!);
    expect(starts[0]).toBeGreaterThanOrEqual(0);
    expect(starts[1]).toBeGreaterThan(starts[0]!);
    expect(starts[1]).toBeLessThan(12);
    // A step whose layers enter on their own is not also moved as a group.
    const shown = view.container.querySelector<SVGGElement>('g[data-squisq-build-step="0"]')!;
    expect(shown.style.transform).toBe('translate(0px, 0px)');
    // Played without a build, the template's own stagger stands.
    view.rerender(<BlockRenderer block={block!} blockTime={9} basePath="." />);
    expect(shown.style.getPropertyValue('--squisq-step-offset')).toBe('');
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
