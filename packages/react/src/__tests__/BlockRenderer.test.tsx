import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { BlockRenderer } from '../BlockRenderer';
import { largestFittingTextScale, largestShrunkTextScale } from '../utils/textFit';
import type { Block } from '@bendyline/squisq/schemas';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 100 50"><text>Slide graph</text></svg>`,
      diagramType: 'flowchart-v2',
    })),
  },
}));

describe('BlockRenderer', () => {
  const minimalBlock: Block = {
    id: 'test-block',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [],
  };

  it('chooses one shared scale up to 2x', () => {
    expect(largestFittingTextScale((scale) => scale <= 1.63)).toBe(1.62);
    expect(largestFittingTextScale(() => true)).toBe(2);
    expect(largestFittingTextScale(() => false)).toBe(1);
  });

  it('shrinks to the largest readable scale that fits, or not at all', () => {
    expect(largestShrunkTextScale((scale) => scale <= 0.9)).toBe(0.89);
    expect(largestShrunkTextScale((scale) => scale <= 0.75)).toBe(0.75);
    // Past the readable floor the authored size stays: shrinking cannot help.
    expect(largestShrunkTextScale(() => false)).toBe(1);
  });

  it('renders an SVG element', () => {
    const { container } = render(
      <BlockRenderer block={minimalBlock} blockTime={0} basePath="/test" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders with correct viewBox', () => {
    const { container } = render(
      <BlockRenderer block={minimalBlock} blockTime={0} basePath="/test" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1920 1080');
  });

  it('renders with custom viewport', () => {
    const { container } = render(
      <BlockRenderer
        block={minimalBlock}
        blockTime={0}
        basePath="/test"
        viewport={{ width: 1080, height: 1920 }}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1080 1920');
  });

  it('pans dominant cover images across portrait frames without adding zoom', () => {
    const portraitHero: Block = {
      ...minimalBlock,
      layers: [
        {
          type: 'image',
          id: 'portrait-hero',
          content: { src: 'wide-hero.jpg', alt: 'Wide hero', fit: 'cover' },
          position: { x: 0, y: 0, width: '100%', height: '100%' },
          animation: { type: 'slowZoom', duration: 9, direction: 'in' },
        },
      ],
    };

    const { container } = render(
      <BlockRenderer
        block={portraitHero}
        blockTime={0}
        basePath="/test"
        viewport={{ width: 1080, height: 1920 }}
      />,
    );

    const layer = container.querySelector('[data-layer-id="portrait-hero"]');
    const image = layer?.querySelector('img');
    expect(layer?.getAttribute('data-image-framing')).toBe('portrait-pan');
    expect(image?.classList.contains('squisq-image--portrait-pan-right')).toBe(true);
    expect(layer?.classList.contains('anim-slowZoom-in')).toBe(false);
    expect(image?.style.objectFit).toBe('cover');
    expect(image?.style.getPropertyValue('--portrait-pan-duration')).toBe('9s');
  });

  it('keeps smaller portrait cover tiles static', () => {
    const portraitTile: Block = {
      ...minimalBlock,
      layers: [
        {
          type: 'image',
          id: 'portrait-tile',
          content: { src: 'tile.jpg', alt: 'Tile', fit: 'cover' },
          position: { x: '5%', y: '5%', width: '42%', height: '42%' },
        },
      ],
    };

    const { container } = render(
      <BlockRenderer
        block={portraitTile}
        blockTime={0}
        basePath="/test"
        viewport={{ width: 1080, height: 1920 }}
      />,
    );

    expect(container.querySelector('[data-image-framing="portrait-pan"]')).toBeNull();
  });

  it('renders text layers', () => {
    const blockWithText: Block = {
      id: 'text-block',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      layers: [
        {
          type: 'text',
          id: 'title',
          content: {
            text: 'Hello World',
            style: {
              fontSize: 48,
              color: '#ffffff',
            },
          },
          position: { x: 100, y: 100 },
        },
      ],
    };

    const { container } = render(
      <BlockRenderer block={blockWithText} blockTime={0} basePath="/test" />,
    );
    // Text should be rendered somewhere in the SVG
    expect(container.textContent).toContain('Hello World');
  });

  it('marks the slide for one shared text-growth pass', () => {
    const blockWithRichText: Block = {
      ...minimalBlock,
      layers: [
        {
          type: 'text',
          id: 'body',
          content: {
            text: 'Short body',
            html: '<p>Short body</p>',
            style: { fontSize: 28, color: '#ffffff' },
          },
          position: { x: 100, y: 100, width: 900, height: 500 },
        },
      ],
    };

    const { container } = render(
      <BlockRenderer block={blockWithRichText} blockTime={0} basePath="/test" growTextToFit />,
    );

    expect(container.querySelector('svg')?.dataset.squisqTextScale).toBe('1');
    expect(container.querySelector('[data-squisq-text-fit="html"]')).not.toBeNull();
  });

  it('renders shape layers', () => {
    const blockWithShape: Block = {
      id: 'shape-block',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      layers: [
        {
          type: 'shape',
          id: 'bg',
          content: {
            shape: 'rect',
            fill: '#000000',
          },
          position: { x: 0, y: 0, width: 1920, height: 1080 },
        },
      ],
    };

    const { container } = render(
      <BlockRenderer block={blockWithShape} blockTime={0} basePath="/test" />,
    );
    const rect = container.querySelector('rect');
    expect(rect).toBeTruthy();
  });

  it('renders Mermaid layers inside the slide SVG', async () => {
    const block: Block = {
      ...minimalBlock,
      layers: [
        {
          type: 'mermaid',
          id: 'diagram',
          content: { source: 'flowchart LR\n  a --> b' },
          position: { x: 100, y: 100, width: 800, height: 500 },
        },
      ],
    };
    const { container } = render(<BlockRenderer block={block} blockTime={0} basePath="/test" />);

    await waitFor(() => {
      expect(container.querySelector('.block-layer--mermaid svg')).not.toBeNull();
    });
    expect(container.textContent).toContain('Slide graph');
  });

  it('namespaces SVG definitions per renderer instance', () => {
    const { container } = render(
      <>
        <BlockRenderer block={minimalBlock} blockTime={0} basePath="/test" />
        <BlockRenderer block={minimalBlock} blockTime={0} basePath="/test" />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('clipPath')).map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('renders transitions and layer animations by default', () => {
    const animatedBlock: Block = {
      ...minimalBlock,
      transition: { type: 'fade', duration: 0.5 },
      layers: [
        {
          type: 'text',
          id: 'animated-title',
          content: { text: 'Animated', style: { fontSize: 48, color: '#fff' } },
          position: { x: 100, y: 100 },
          animation: { type: 'fadeIn', duration: 1 },
        },
      ],
    };

    const { container } = render(
      <BlockRenderer block={animatedBlock} blockTime={0} basePath="/test" isEntering />,
    );

    expect(container.querySelector('svg')?.classList.contains('transition-fade-enter')).toBe(true);
    expect(
      container
        .querySelector('[data-layer-id="animated-title"]')
        ?.classList.contains('anim-fadeIn'),
    ).toBe(true);
  });

  it('suppresses transitions and every layer animation without mutating the block', () => {
    const animatedBlock: Block = {
      ...minimalBlock,
      transition: { type: 'fade', duration: 0.5 },
      layers: [
        {
          type: 'text',
          id: 'animated-title',
          content: { text: 'Static', style: { fontSize: 48, color: '#fff' } },
          position: { x: 100, y: 100 },
          animation: { type: 'fadeIn', duration: 1 },
        },
        {
          type: 'image',
          id: 'animated-hero',
          content: { src: 'hero.jpg', alt: 'Hero', fit: 'cover' },
          position: { x: 0, y: 0, width: '100%', height: '100%' },
          animation: { type: 'slowZoom', duration: 5 },
        },
      ],
    };
    const originalAnimations = animatedBlock.layers?.map((layer) => layer.animation);

    const { container } = render(
      <BlockRenderer
        block={animatedBlock}
        blockTime={0}
        basePath="/test"
        isEntering
        animationsEnabled={false}
        viewport={{ width: 1080, height: 1920 }}
      />,
    );

    expect(container.querySelector('svg')?.className.baseVal).not.toContain('transition-');
    expect(container.querySelector('[class*="anim-"]')).toBeNull();
    expect(container.querySelector('[data-image-framing="portrait-pan"]')).toBeNull();
    expect(animatedBlock.transition).toEqual({ type: 'fade', duration: 0.5 });
    expect(animatedBlock.layers?.map((layer) => layer.animation)).toEqual(originalAnimations);
  });
});

describe('BlockRenderer grow-text-to-fit', () => {
  const textLayer = {
    id: 'label',
    type: 'text' as const,
    position: { x: 100, y: 100 },
    content: { text: 'Label', style: { fontSize: 20, color: '#fff' } },
  };

  it('publishes a text scale for prose blocks but never for geometry-bound templates', () => {
    const prose = render(
      <BlockRenderer
        block={{ id: 'p', startTime: 0, duration: 5, audioSegment: 0, layers: [textLayer] }}
        blockTime={0}
        basePath="."
        growTextToFit
      />,
    );
    expect(
      prose.container.querySelector('.block-svg')?.getAttribute('data-squisq-text-scale'),
    ).toBe('1');

    const chart = render(
      <BlockRenderer
        block={
          {
            id: 'c',
            startTime: 0,
            duration: 5,
            audioSegment: 0,
            template: 'pieChart',
            layers: [textLayer],
          } as never
        }
        blockTime={0}
        basePath="."
        growTextToFit
      />,
    );
    expect(
      chart.container.querySelector('.block-svg')?.hasAttribute('data-squisq-text-scale'),
    ).toBe(false);
  });
});

describe('BlockRenderer shrink-to-fit', () => {
  const BOX_HEIGHT = 180;
  const richBlock: Block = {
    id: 'rich',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [
      {
        type: 'text',
        id: 'item-0',
        content: {
          text: 'Choose Source to see the Markdown text behind this page.',
          html: 'Choose <strong>Source</strong> to see the Markdown text behind this page.',
          style: { fontSize: 50, color: '#fff' },
        },
        position: { x: 100, y: 100, width: 900, height: BOX_HEIGHT },
      },
    ],
  };
  let lines = 4;
  const restores: Array<() => void> = [];

  // jsdom lays nothing out, so stand in for the browser: rich text is `lines`
  // lines tall at its current font size, inside a BOX_HEIGHT box.
  function stubLayout(name: string, value: (element: HTMLElement) => number): void {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return value(this);
      },
    });
    restores.push(() => delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]);
  }
  const fontPx = (element: HTMLElement): number =>
    parseFloat(
      element.closest<HTMLElement>('[data-squisq-text-fit="html"]')?.style.fontSize ?? '0',
    );
  const isContent = (element: HTMLElement): boolean => element.dataset.squisqTextContent === 'true';
  const isBox = (element: HTMLElement): boolean => element.dataset.squisqTextFit === 'html';

  beforeEach(() => {
    lines = 4;
    stubLayout('scrollHeight', (el) => (isContent(el) ? fontPx(el) * lines : 0));
    stubLayout('scrollWidth', (el) => (isContent(el) ? 800 : 0));
    stubLayout('clientHeight', (el) => (isBox(el) ? BOX_HEIGHT : 0));
    stubLayout('clientWidth', (el) => (isBox(el) ? 900 : 0));
  });
  afterEach(() => {
    while (restores.length) restores.pop()!();
  });

  const scaleOf = (container: HTMLElement): number =>
    Number(container.querySelector('.block-svg')?.getAttribute('data-squisq-text-scale'));

  it('shrinks clipped rich text just enough to show every line', async () => {
    // Four 50px lines need 200px of a 180px box: a scale of at most 0.9.
    const { container } = render(
      <BlockRenderer block={richBlock} blockTime={0} basePath="." growTextToFit />,
    );
    await waitFor(() => expect(scaleOf(container)).toBeLessThan(1));
    expect(scaleOf(container)).toBeGreaterThan(0.85);
    expect(scaleOf(container)).toBeLessThanOrEqual(0.9);
  });

  it('shrinks clipped text on every surface, not only a growing slideshow', async () => {
    // A video export draws without growTextToFit and clipped the same way.
    const { container } = render(<BlockRenderer block={richBlock} blockTime={0} basePath="." />);
    await waitFor(() => expect(scaleOf(container)).toBeLessThanOrEqual(0.9));
    expect(scaleOf(container)).toBeGreaterThan(0.85);
  });

  it('leaves clipped text alone when the host opts out', () => {
    const { container } = render(
      <BlockRenderer block={richBlock} blockTime={0} basePath="." shrinkTextToFit={false} />,
    );
    expect(container.querySelector('.block-svg')?.hasAttribute('data-squisq-text-scale')).toBe(
      false,
    );
  });

  it('keeps the authored size when the readable floor still clips', () => {
    lines = 6; // 300px would need a scale of 0.6
    const { container } = render(
      <BlockRenderer block={richBlock} blockTime={0} basePath="." growTextToFit />,
    );
    expect(scaleOf(container)).toBe(1);
  });

  it('re-measures when a webfont finishes loading after the first pass', async () => {
    // WebKit can report the font set loaded before it requests the slide's
    // face; the wider real face then arrives with no pending `ready`.
    const fonts = Object.assign(new EventTarget(), {
      status: 'loaded',
      ready: Promise.resolve(),
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    restores.push(() => delete (document as unknown as Record<string, unknown>).fonts);

    lines = 3; // the fallback face fits, with room to grow
    const { container } = render(
      <BlockRenderer block={richBlock} blockTime={0} basePath="." growTextToFit />,
    );
    await waitFor(() => expect(scaleOf(container)).toBeGreaterThan(1));

    lines = 4; // the designed face wraps one more line
    act(() => {
      fonts.dispatchEvent(new Event('loadingdone'));
    });
    await waitFor(() => expect(scaleOf(container)).toBeLessThanOrEqual(0.9));
  });
});
