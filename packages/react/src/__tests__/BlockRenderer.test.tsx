import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BlockRenderer, VIEWPORT } from '../BlockRenderer';
import type { Block } from '@bendyline/prodcore/schemas';

describe('VIEWPORT constant', () => {
  it('has correct 1080p dimensions', () => {
    expect(VIEWPORT.width).toBe(1920);
    expect(VIEWPORT.height).toBe(1080);
  });
});

describe('BlockRenderer', () => {
  const minimalBlock: Block = {
    id: 'test-block',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [],
  };

  it('renders an SVG element', () => {
    const { container } = render(
      <BlockRenderer
        block={minimalBlock}
        blockTime={0}
        basePath="/test"
      />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders with correct viewBox', () => {
    const { container } = render(
      <BlockRenderer
        block={minimalBlock}
        blockTime={0}
        basePath="/test"
      />
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
      />
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1080 1920');
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
      <BlockRenderer
        block={blockWithText}
        blockTime={0}
        basePath="/test"
      />
    );
    // Text should be rendered somewhere in the SVG
    expect(container.textContent).toContain('Hello World');
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
      <BlockRenderer
        block={blockWithShape}
        blockTime={0}
        basePath="/test"
      />
    );
    const rect = container.querySelector('rect');
    expect(rect).toBeTruthy();
  });
});
