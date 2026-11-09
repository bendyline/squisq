import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { InlinePreviewGutter } from '../InlinePreviewGutter';
import type { HeadingLayoutEntry } from '../useHeadingLayout';
import type { Block } from '@bendyline/squisq/schemas';

const { renderBlock, materialize, layout } = vi.hoisted(() => ({
  renderBlock: vi.fn(() => null),
  materialize: vi.fn(),
  layout: {
    entries: [] as HeadingLayoutEntry[],
    scrollToBlock: vi.fn(),
    pageEdges: null,
    ready: false,
  },
}));

vi.mock('@bendyline/squisq-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bendyline/squisq-react')>()),
  BlockRenderer: renderBlock,
}));
vi.mock('../useHeadingLayout', () => ({ useHeadingLayout: () => layout }));
vi.mock('../resolveBlockVisual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../resolveBlockVisual')>();
  return {
    resolveBlockVisual: (...args: Parameters<typeof actual.resolveBlockVisual>) => {
      materialize();
      return actual.resolveBlockVisual(...args);
    },
  };
});

function EditProbe() {
  const { setMarkdownSource, setFindMode } = useEditorContext();
  return (
    <>
      <button onClick={() => setFindMode(true)}>Find</button>
      <button onClick={() => setMarkdownSource('# Updated\n\nChanged body.')}>Edit</button>
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
  renderBlock.mockClear();
  materialize.mockClear();
  layout.entries = [];
  vi.unstubAllGlobals();
});

describe('inline preview rendering during editing', () => {
  it('mounts preview contents only when a positioned card intersects the viewport', () => {
    let notify: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { container, unmount } = render(
      <EditorProvider
        initialMarkdown={'# Original\n\nBody.\n\n## Unpositioned\n\nBody.'}
        articleId="visibility"
      >
        <InlinePreviewGutter />
        <EditProbe />
      </EditorProvider>,
    );
    const card = container.querySelector<HTMLElement>('.squisq-inline-preview-card')!;
    expect(card).not.toBeNull();
    expect(renderBlock).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    layout.entries = [
      {
        block: { id: card.dataset.previewId } as Block,
        top: 0,
        bottom: 300,
        annotated: false,
      },
    ];
    fireEvent.click(screen.getByText('Find'));
    expect(observe).toHaveBeenCalledWith(card);
    expect(observe).toHaveBeenCalledTimes(1);
    const intersect = (isIntersecting: boolean) =>
      act(() => {
        notify(
          [
            {
              target: card,
              isIntersecting,
              boundingClientRect: card.getBoundingClientRect(),
              intersectionRatio: isIntersecting ? 1 : 0,
              intersectionRect: card.getBoundingClientRect(),
              rootBounds: null,
              time: 0,
            },
          ],
          {} as IntersectionObserver,
        );
      });
    intersect(true);
    expect(renderBlock).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    intersect(false);
    intersect(true);
    expect(renderBlock).toHaveBeenCalledTimes(2);
    expect(materialize).toHaveBeenCalledTimes(2);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('retains previews during source/context updates and refreshes them after parsing', async () => {
    vi.useFakeTimers();
    render(
      <EditorProvider initialMarkdown={'# Original\n\nBody.'} articleId="performance">
        <InlinePreviewGutter />
        <EditProbe />
      </EditorProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('Original')).toBeTruthy();
    expect(renderBlock).toHaveBeenCalled();
    renderBlock.mockClear();

    fireEvent.click(screen.getByText('Find'));
    fireEvent.click(screen.getByText('Edit'));
    expect(renderBlock).not.toHaveBeenCalled();
    expect(screen.getByText('Original')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(renderBlock).toHaveBeenCalled();
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.queryByText('Original')).toBeNull();
  });
});
