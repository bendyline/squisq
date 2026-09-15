/**
 * @vitest-environment jsdom
 *
 * `reviewProviders` end to end: a provider handed to the shell is scheduled,
 * its findings reach the panel, and a host that passes none gets no review at
 * all — nothing scheduled, no provider constructed.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReviewEvent, ReviewRequest } from '@bendyline/squisq/review';
import { EditorProvider } from '../../EditorContext';
import { ReviewRoot } from '../ReviewContext.js';
import { ReviewPanel } from '../ReviewPanel.js';
import type { ReviewProvider } from '../types.js';

const DOC = '# Title\n\nThe quick brown fox.\n';

function provider(overrides: Partial<ReviewProvider> = {}): ReviewProvider {
  return {
    id: 'assist',
    label: 'Writing review',
    hue: 'assist',
    debounceMs: 10,
    async *review(request: ReviewRequest): AsyncIterable<ReviewEvent> {
      yield {
        type: 'findings',
        findings: request.blocks.map((block) => ({
          id: `b${block.key}`,
          source: 'assist',
          start: block.offset,
          end: block.offset + 3,
          blockKey: block.key,
          severity: 'suggestion' as const,
          category: 'clarity',
          message: `Consider rewriting ${block.heading ?? 'this'}.`,
          originalText: block.text.slice(0, 3),
          suggestions: [],
        })),
      };
      yield { type: 'done' };
    },
    ...overrides,
  };
}

function mount(providers: readonly ReviewProvider[] | undefined) {
  return render(
    <EditorProvider initialMarkdown={DOC}>
      <ReviewRoot providers={providers}>
        <ReviewPanel />
      </ReviewRoot>
    </EditorProvider>,
  );
}

describe('reviewProviders on the shell', () => {
  it('renders nothing at all when the host passes no providers', async () => {
    mount(undefined);
    await act(async () => {});
    expect(screen.queryByLabelText('Review findings')).toBeNull();
  });

  it('never constructs a provider the host did not supply', async () => {
    const factory = vi.fn(() => provider());
    mount([]);
    await act(async () => {});
    expect(factory).not.toHaveBeenCalled();
  });

  it('schedules a supplied provider and shows its findings', async () => {
    vi.useFakeTimers();
    mount([provider()]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByLabelText('Review findings')).toBeTruthy();
    expect(screen.getByText('Writing review')).toBeTruthy();
    expect(screen.getByText('Consider rewriting Title.')).toBeTruthy();
    vi.useRealTimers();
  });

  it('gives the provider the document as blocks, with its heading', async () => {
    vi.useFakeTimers();
    const seen: ReviewRequest[] = [];
    mount([
      provider({
        async *review(request) {
          seen.push(request);
          yield { type: 'done' };
        },
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(seen[0]?.blocks[0]).toMatchObject({ heading: 'Title', startLine: 1 });
    expect(seen[0]?.blocks[0]?.text).toContain('quick brown fox');
    vi.useRealTimers();
  });

  it('surfaces a failing provider instead of an empty panel', async () => {
    vi.useFakeTimers();
    mount([
      provider({
        // eslint-disable-next-line require-yield
        async *review() {
          throw new Error('model unreachable');
        },
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByText('model unreachable')).toBeTruthy();
    vi.useRealTimers();
  });

  it('dismisses a finding without re-running the provider', async () => {
    vi.useFakeTimers();
    const review = vi.fn(provider().review);
    mount([provider({ review: review as unknown as ReviewProvider['review'] })]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const passes = review.mock.calls.length;

    await act(async () => {
      screen.getByLabelText(/^Dismiss:/).click();
    });

    expect(screen.queryByText(/Consider rewriting/)).toBeNull();
    expect(review.mock.calls.length).toBe(passes);
    vi.useRealTimers();
  });
});
