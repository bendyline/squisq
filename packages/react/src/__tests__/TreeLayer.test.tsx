import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TreeLayer } from '../layers/TreeLayer';
import type { TreeLayer as TreeLayerType } from '@bendyline/squisq/schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTreeLayer(overrides: Partial<TreeLayerType> = {}): TreeLayerType {
  return {
    type: 'tree',
    id: 'test-tree',
    content: {
      items: [
        {
          id: 'src',
          label: 'src/',
          isDir: true,
          children: [{ id: 'index', label: 'index.ts', isDir: false, children: [] }],
        },
      ],
      style: {
        fontSize: 24,
        fontFamily: 'system-ui',
        rowColor: '#e0e0e0',
        dirColor: '#ffffff',
        iconColor: '#8ab4f8',
        commentColor: '#9aa0a6',
        connectorColor: 'rgba(255,255,255,0.2)',
        indentPx: 20,
      },
    },
    position: { x: '10%', y: '10%', width: '80%', height: '80%' },
    ...overrides,
  } as TreeLayerType;
}

const viewport = { width: 1920, height: 1080 };

function renderTreeLayer(layer?: TreeLayerType) {
  return render(
    <svg>
      <TreeLayer layer={layer ?? makeTreeLayer()} viewport={viewport} blockTime={0} />
    </svg>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TreeLayer', () => {
  it('renders a foreignObject with the tree markup', () => {
    const { container } = renderTreeLayer();
    expect(container.querySelector('foreignObject')).toBeTruthy();
    expect(container.querySelector('.squisq-treelayer')).toBeTruthy();
  });

  it('renders each item label', () => {
    const { container } = renderTreeLayer();
    expect(container.textContent).toContain('src/');
    expect(container.textContent).toContain('index.ts');
  });

  // `getAnimationStyle` returns `{ className, style }`. Spreading that object
  // into a `style` prop drops the class (no keyframes ever run) and buries the
  // CSS vars one level too deep, so a themed entrance on a tree block silently
  // does nothing in the player AND in video-export frames.
  describe('animation', () => {
    const animated = () => {
      const layer = makeTreeLayer();
      layer.animation = { type: 'fadeIn', duration: 2, delay: 0.5, easing: 'ease-in-out' };
      return renderTreeLayer(layer);
    };

    it('applies the animation class to a rendered element', () => {
      const { container } = animated();
      const g = container.querySelector('g.block-layer--tree');
      expect(g).toBeTruthy();
      expect(g?.classList.contains('anim-fadeIn')).toBe(true);
    });

    it('applies the animation CSS custom properties to that same element', () => {
      const { container } = animated();
      const g = container.querySelector<SVGGElement>('g.block-layer--tree');
      expect(g?.style.getPropertyValue('--anim-duration')).toBe('2s');
      expect(g?.style.getPropertyValue('--anim-delay')).toBe('0.5s');
      expect(g?.style.getPropertyValue('--anim-easing')).toBe('ease-in-out');
    });

    it('renders no animation class when the layer has no animation', () => {
      const { container } = renderTreeLayer();
      const g = container.querySelector('g.block-layer--tree');
      expect(g?.getAttribute('class')?.trim()).toBe('block-layer block-layer--tree');
    });
  });
});
