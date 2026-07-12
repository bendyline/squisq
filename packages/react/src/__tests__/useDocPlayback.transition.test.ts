/**
 * useDocPlayback — block transition state is derived synchronously.
 *
 * Regression guard for the between-block "flash": a newly active block must
 * report `isEntering` (and its outgoing `previousBlock`) on the SAME render it
 * becomes current — not a frame later via an effect. Otherwise the block paints
 * fully settled for a frame and then snaps back to the start of its entrance
 * animation. The distinguishing assertion is `previousBlock` during the next
 * block's entrance with NO timer/effect advanced (the old effect-based path
 * only set it after a `setTimeout`).
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/doc';
import type { Doc, Block } from '@bendyline/squisq/schemas';
import { useDocPlayback } from '../hooks/useDocPlayback';

function block(id: string, startTime: number): Block {
  return {
    id,
    startTime,
    duration: 5,
    audioSegment: 0,
    transition: { type: 'fade', duration: 0.5 },
    layers: [],
  };
}

const doc: Doc = {
  articleId: 'd',
  duration: 10,
  blocks: [block('a', 0), block('b', 5)],
  audio: { segments: [] },
};

describe('useDocPlayback — synchronous block transitions', () => {
  it('exposes the entering block + outgoing previousBlock on the same render (no effect flush)', () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: number }) => useDocPlayback(doc, t, { viewport: VIEWPORT_PRESETS.landscape }),
      { initialProps: { t: 0 } },
    );

    // Establish block A as the current block first.
    expect(result.current.currentBlockIndex).toBe(0);

    // Cross into block B's entrance window: it is entering AND crossfading from
    // A immediately — the old code left previousBlock null until a setTimeout.
    rerender({ t: 5.1 });
    expect(result.current.currentBlockIndex).toBe(1);
    expect(result.current.isEntering).toBe(true);
    expect(result.current.isExiting).toBe(true);
    expect(result.current.previousBlock?.id).toBe('a');

    // Past the entrance window: settled, no crossfade.
    rerender({ t: 7 });
    expect(result.current.isEntering).toBe(false);
    expect(result.current.isExiting).toBe(false);
    expect(result.current.previousBlock).toBeNull();
  });

  it('isEntering is a pure function of blockTime vs the transition duration', () => {
    const enteringAt = (t: number) =>
      renderHook(() => useDocPlayback(doc, t, { viewport: VIEWPORT_PRESETS.landscape })).result
        .current.isEntering;
    expect(enteringAt(5.0)).toBe(true); // blockTime 0.0 < 0.5
    expect(enteringAt(5.4)).toBe(true); // blockTime 0.4 < 0.5
    expect(enteringAt(5.6)).toBe(false); // blockTime 0.6 >= 0.5
  });

  it('can enter a swipe destination without restoring the outgoing block', () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: number }) => useDocPlayback(doc, t, { viewport: VIEWPORT_PRESETS.landscape }),
      { initialProps: { t: 0 } },
    );

    act(() => result.current.suppressOutgoingForNextBlock('b'));
    rerender({ t: 5 });

    // The destination still gets its own entrance animation, but the slide
    // already carried away by the swipe is not mounted again as context.
    expect(result.current.isEntering).toBe(true);
    expect(result.current.isExiting).toBe(false);
    expect(result.current.previousBlock).toBeNull();
  });

  it('clears stale outgoing context when a cover reveals the already-active block', () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: number }) => useDocPlayback(doc, t, { viewport: VIEWPORT_PRESETS.landscape }),
      { initialProps: { t: 0 } },
    );
    rerender({ t: 5 });
    expect(result.current.previousBlock?.id).toBe('a');

    act(() => result.current.suppressOutgoingForNextBlock('b'));
    rerender({ t: 5 });

    expect(result.current.isEntering).toBe(true);
    expect(result.current.isExiting).toBe(false);
    expect(result.current.previousBlock).toBeNull();
  });

  it('navigation actions seek to the target block', () => {
    const seek = vi.fn();
    const { result } = renderHook(() =>
      useDocPlayback(doc, 0, { viewport: VIEWPORT_PRESETS.landscape, onSeek: seek }),
    );
    act(() => result.current.nextBlock());
    expect(seek).toHaveBeenCalledWith(5);
    act(() => result.current.goToBlock(0));
    expect(seek).toHaveBeenLastCalledWith(0);
  });
});
