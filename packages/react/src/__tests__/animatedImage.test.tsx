import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MarkdownBlockNode } from '@bendyline/squisq/markdown';
import { MarkdownRenderer } from '../MarkdownRenderer';

/**
 * Animated images (GIF / WebP / APNG) render with play/pause controls; stills
 * — including a single-frame GIF — render exactly as before. Exercised
 * through MarkdownRenderer, the read path that hosts `useAnimatedImage` +
 * `AnimatedImageControls` for plain markdown images.
 */

/** A GIF of `frames` frames, each `delayCs` hundredths of a second. */
function gifDataUrl(frames: number, opts: { delayCs?: number; loopForever?: boolean } = {}) {
  const bytes: number[] = [...'GIF89a'].map((c) => c.charCodeAt(0));
  bytes.push(1, 0, 1, 0, 0, 0, 0);
  if (opts.loopForever ?? true) {
    bytes.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  }
  for (let i = 0; i < frames; i++) {
    bytes.push(0x21, 0xf9, 4, 0, opts.delayCs ?? 10, 0, 0, 0);
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0);
  }
  bytes.push(0x3b);
  return `data:image/gif;base64,${Buffer.from(bytes).toString('base64')}`;
}

function imageDoc(url: string, alt = 'party'): MarkdownBlockNode[] {
  return [{ type: 'paragraph', children: [{ type: 'image', url, alt }] }];
}

/** Let pending fetch → arrayBuffer → inspect chains settle. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
}

let drawImage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  drawImage = vi.fn();
  // jsdom has no canvas backend or object URLs.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  URL.createObjectURL = vi.fn(() => 'blob:squisq-replay');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('animated images in MarkdownRenderer', () => {
  it('renders a still format as a bare image, as before', () => {
    const { container } = render(<MarkdownRenderer nodes={imageDoc('photos/cat.png')} />);
    const img = container.querySelector('img.squisq-md-image');
    expect(img?.parentElement?.classList.contains('squisq-animated-image')).toBe(false);
  });

  it('adds play/pause controls once a GIF proves to be animated', async () => {
    const { container } = render(<MarkdownRenderer nodes={imageDoc(gifDataUrl(3))} />);
    const toggle = await screen.findByRole('button', { name: 'Pause animation' });
    expect(toggle.textContent).toContain('GIF');
    expect(container.querySelector('.squisq-animated-image')?.getAttribute('data-animated')).toBe(
      'true',
    );
  });

  it('leaves a single-frame GIF without controls', async () => {
    const { container } = render(<MarkdownRenderer nodes={imageDoc(gifDataUrl(1))} />);
    await settle();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.squisq-animated-image')?.hasAttribute('data-animated')).toBe(
      false,
    );
  });

  it('pausing freezes a still frame; playing restarts from a fresh copy', async () => {
    const { container } = render(<MarkdownRenderer nodes={imageDoc(gifDataUrl(3))} />);
    const img = container.querySelector('img.squisq-md-image') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 40 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 30 });
    Object.defineProperty(img, 'complete', { configurable: true, value: true });

    fireEvent.click(await screen.findByRole('button', { name: 'Pause animation' }));
    const still = container.querySelector(
      'canvas.squisq-animated-image-still',
    ) as HTMLCanvasElement;
    expect(still).toBeTruthy();
    expect(still.width).toBe(40);
    expect(drawImage).toHaveBeenCalledWith(img, 0, 0);

    fireEvent.click(screen.getByRole('button', { name: 'Play animation' }));
    await screen.findByRole('button', { name: 'Pause animation' });
    expect(container.querySelector('canvas')).toBeNull();
    expect(img.getAttribute('src')).toBe('blob:squisq-replay');
  });

  it('starts on a still frame for readers who prefer reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query })),
    );
    const { container } = render(<MarkdownRenderer nodes={imageDoc(gifDataUrl(3))} />);
    await screen.findByRole('button', { name: 'Play animation' });
    expect(container.querySelector('canvas.squisq-animated-image-still')).toBeTruthy();
  });

  it('offers a replay once a play-once animation has finished', async () => {
    // Two 50 ms frames, no looping extension: one 100 ms pass.
    render(
      <MarkdownRenderer nodes={imageDoc(gifDataUrl(2, { delayCs: 5, loopForever: false }))} />,
    );
    await screen.findByRole('button', { name: 'Pause animation' });
    await screen.findByRole('button', { name: 'Replay animation' });
  });

  it('does not fetch a cross-origin image', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(
      <MarkdownRenderer nodes={imageDoc('https://elsewhere.example/loop.gif')} />,
    );
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Still rendered — it simply animates without controls.
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://elsewhere.example/loop.gif',
    );
  });
});
