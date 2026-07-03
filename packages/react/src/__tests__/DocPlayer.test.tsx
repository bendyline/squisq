import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DocPlayer } from '../DocPlayer';
import type { Doc } from '@bendyline/squisq/schemas';

function minimalDoc(): Doc {
  return {
    articleId: 'smoke',
    duration: 5,
    blocks: [{ id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] }],
    audio: { segments: [] },
  };
}

describe('DocPlayer smoke test', () => {
  it('renders without crashing in video mode (default)', () => {
    const { container } = render(<DocPlayer script={minimalDoc()} basePath="/test" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders without crashing in slideshow mode', () => {
    const { container } = render(
      <DocPlayer script={minimalDoc()} basePath="/test" displayMode="slideshow" />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('renders without crashing in linear mode', () => {
    const { container } = render(
      <DocPlayer script={minimalDoc()} basePath="/test" displayMode="linear" />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('exposes playback controls via onControlsReady', () => {
    let controls: { play: () => void; pause: () => void } | null = null;
    render(
      <DocPlayer
        script={minimalDoc()}
        basePath="/test"
        showControls={false}
        onControlsReady={(c) => {
          controls = c;
        }}
      />,
    );
    expect(controls).not.toBeNull();
    expect(typeof controls!.play).toBe('function');
    expect(typeof controls!.pause).toBe('function');
  });
});
