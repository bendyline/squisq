import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { borderDashArray, resolveFill } from '../utils/fillStyle';
import { ShapeLayer } from '../layers/ShapeLayer';
import { TextLayer } from '../layers/TextLayer';
import type {
  ShapeLayer as ShapeLayerType,
  TextLayer as TextLayerType,
} from '@bendyline/squisq/schemas';

const viewport = { width: 1000, height: 1000 };

describe('borderDashArray', () => {
  it('returns undefined for solid / unset', () => {
    expect(borderDashArray(undefined, 2)).toBeUndefined();
    expect(borderDashArray('solid', 2)).toBeUndefined();
  });
  it('scales the pattern by stroke width', () => {
    expect(borderDashArray('dashed', 2)).toBe('6 4');
    expect(borderDashArray('dotted', 2)).toBe('2 4');
  });
});

describe('resolveFill', () => {
  it('returns the solid color with no def when there is no gradient', () => {
    const { fill, def } = resolveFill('x', '#abcdef', undefined);
    expect(fill).toBe('#abcdef');
    expect(def).toBeNull();
  });
  it('returns a url() fill and a gradient def when a gradient is set', () => {
    const { fill, def } = resolveFill('x', '#abcdef', { from: '#000', to: '#fff', angle: 90 });
    expect(fill).toBe('url(#squisq-grad-x)');
    expect(def).not.toBeNull();
  });
});

describe('ShapeLayer fill/border', () => {
  function makeShape(content: Partial<ShapeLayerType['content']>): ShapeLayerType {
    return {
      id: 's1',
      type: 'shape',
      position: { x: 0, y: 0, width: 100, height: 100 },
      content: { shape: 'rect', ...content },
    } as ShapeLayerType;
  }

  function makeFullBleedShape(content: Partial<ShapeLayerType['content']>): ShapeLayerType {
    return {
      ...makeShape(content),
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
  }

  it('applies fill opacity and a dashed border', () => {
    const { container } = render(
      <svg>
        <ShapeLayer
          layer={makeShape({
            fill: '#3b82f6',
            fillOpacity: 0.5,
            stroke: '#000',
            strokeWidth: 4,
            borderStyle: 'dashed',
          })}
          viewport={viewport}
          blockTime={0}
        />
      </svg>,
    );
    const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('fill-opacity')).toBe('0.5');
    expect(rect.getAttribute('stroke-dasharray')).toBe('12 8');
  });

  it('renders a gradient via an SVG linearGradient', () => {
    const { container } = render(
      <svg>
        <ShapeLayer
          layer={makeShape({ gradient: { from: '#111', to: '#eee', angle: 0 } })}
          viewport={viewport}
          blockTime={0}
        />
      </svg>,
    );
    const gradient = container.querySelector('linearGradient');
    expect(gradient).not.toBeNull();
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe(`url(#${gradient!.id})`);
  });

  it('overscans a full-bleed solid shade to prevent an image edge seam', () => {
    const { container } = render(
      <svg>
        <ShapeLayer
          layer={makeFullBleedShape({ fill: 'rgba(0, 0, 0, 0.5)' })}
          viewport={viewport}
          blockTime={0}
        />
      </svg>,
    );

    const rect = container.querySelector('rect')!;
    expect(rect.getAttribute('x')).toBe('-1');
    expect(rect.getAttribute('y')).toBe('-1');
    expect(rect.getAttribute('width')).toBe('1002');
    expect(rect.getAttribute('height')).toBe('1002');
  });

  it('overscans a full-bleed CSS gradient shade and its HTML fill', () => {
    const { container } = render(
      <svg>
        <ShapeLayer
          layer={makeFullBleedShape({
            fill: 'linear-gradient(0deg, rgba(0,0,0,0.8), transparent)',
          })}
          viewport={viewport}
          blockTime={0}
        />
      </svg>,
    );

    const foreignObject = container.querySelector('foreignObject')!;
    expect(foreignObject.getAttribute('x')).toBe('-1');
    expect(foreignObject.getAttribute('y')).toBe('-1');
    expect(foreignObject.getAttribute('width')).toBe('1002');
    expect(foreignObject.getAttribute('height')).toBe('1002');
    expect(foreignObject.querySelector('div')!.style.width).toBe('1002px');
    expect(foreignObject.querySelector('div')!.style.height).toBe('1002px');
  });
});

describe('TextLayer box border', () => {
  it('draws a border rect on the position box', () => {
    const layer: TextLayerType = {
      id: 't1',
      type: 'text',
      position: { x: 0, y: 0, width: 400, height: 200 },
      content: {
        text: 'Hi',
        style: {
          fontSize: 40,
          color: '#000',
          borderColor: '#f00',
          borderWidth: 3,
          borderStyle: 'dotted',
        },
      },
    };
    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );
    const rect = container.querySelector('rect')!;
    expect(rect).not.toBeNull();
    expect(rect.getAttribute('stroke')).toBe('#f00');
    expect(rect.getAttribute('stroke-width')).toBe('3');
    expect(rect.getAttribute('width')).toBe('400');
    expect(rect.getAttribute('height')).toBe('200');
  });
});
