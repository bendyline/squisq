import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { MediaClipLayer } from '../MediaClipLayer';

afterEach(() => vi.restoreAllMocks());

describe('MediaClipLayer', () => {
  it('mutes scheduled audio when the player muted contract is enabled', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const clip: ScheduledClip = {
      id: 'narration',
      kind: 'audio',
      src: 'narration.mp3',
      absoluteStart: 0,
      absoluteEnd: 5,
      sourceIn: 0,
      anchor: 'document',
    };
    const { container } = render(
      <MediaClipLayer schedule={[clip]} currentTime={0} isPlaying={false} basePath="." muted />,
    );
    expect(container.querySelector('audio')?.muted).toBe(true);
  });
});
