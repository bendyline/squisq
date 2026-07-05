/**
 * Missing-stylesheet sentinel test.
 *
 * Lives in its own file so it owns a fresh module instance of DocPlayer
 * (vitest isolates module registries per test file) — the sentinel warning
 * is one-shot at module level, so this file's first mount deterministically
 * observes it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DocPlayer } from '../DocPlayer';
import type { Doc } from '@bendyline/squisq/schemas';

function minimalDoc(): Doc {
  return {
    articleId: 'sentinel',
    duration: 5,
    blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
    audio: { segments: [] },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocPlayer missing-CSS sentinel', () => {
  it('warns once (and only once) in dev when the stylesheet is not loaded', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<DocPlayer doc={minimalDoc()} />);
    const sentinelCalls = () =>
      warnSpy.mock.calls.filter((c) => String(c[0]).includes('squisq-react/styles'));
    expect(sentinelCalls().length).toBe(1);

    // Second mount must not warn again — module-level one-shot.
    render(<DocPlayer doc={minimalDoc()} />);
    expect(sentinelCalls().length).toBe(1);
  });
});
