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
    const { container } = render(<DocPlayer doc={minimalDoc()} basePath="/test" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders without crashing in slideshow mode', () => {
    const { container } = render(
      <DocPlayer doc={minimalDoc()} basePath="/test" displayMode="slideshow" />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('renders without crashing in linear mode', () => {
    const { container } = render(
      <DocPlayer doc={minimalDoc()} basePath="/test" displayMode="linear" />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('exposes playback controls via onControlsReady', () => {
    let controls: { play: () => void; pause: () => void } | null = null;
    render(
      <DocPlayer
        doc={minimalDoc()}
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

describe('DocPlayer front door (doc / markdown resolution)', () => {
  it('renders a doc built from the markdown prop', () => {
    const { container } = render(
      <DocPlayer markdown={'# Hello From Markdown\n\nBody text here.'} displayMode="linear" />,
    );
    expect(container.querySelector('.doc-player')).toBeTruthy();
    expect(container.textContent).toContain('Hello From Markdown');
  });

  it('doc wins over markdown when both are provided', () => {
    const { container } = render(
      <DocPlayer doc={minimalDoc()} markdown="# Markdown Loses" displayMode="linear" />,
    );
    expect(container.querySelector('.doc-player')).toBeTruthy();
    expect(container.textContent).not.toContain('Markdown Loses');
  });

  it('renders an empty state without throwing when neither doc nor markdown is given', () => {
    const { container } = render(<DocPlayer />);
    const empty = container.querySelector('.doc-player--empty');
    expect(empty).toBeTruthy();
    expect(empty!.classList.contains('doc-player')).toBe(true);
  });

  it('defaults basePath when omitted', () => {
    const { container } = render(<DocPlayer doc={minimalDoc()} />);
    expect(container.querySelector('.doc-player')).toBeTruthy();
  });
});
