import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { TextLayer as TextLayerType } from '@bendyline/squisq/schemas';
import { TextLayer } from '../layers/TextLayer';

const viewport = { width: 1920, height: 1080 };

describe('TextLayer rich text', () => {
  it('sets the foreground directly on foreignObject content for export', () => {
    const layer: TextLayerType = {
      id: 'formatted-list-item',
      type: 'text',
      content: {
        text: 'Raw -- the Markdown source',
        html: '<strong>Raw</strong> -- the Markdown source',
        style: {
          fontSize: 34,
          color: '#0f172a',
        },
      },
      position: { x: 100, y: 200, width: 900, height: 80 },
    };

    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );

    const richContent = container.querySelector<HTMLElement>(
      'foreignObject [aria-label="Raw -- the Markdown source"]',
    );
    const foreignObject = container.querySelector<SVGForeignObjectElement>('foreignObject');

    expect(richContent).not.toBeNull();
    expect(richContent!.style.color).toBe('rgb(15, 23, 42)');
    expect(foreignObject?.getAttribute('color')).toBe('#0f172a');
    expect(foreignObject?.style.color).toBe('rgb(15, 23, 42)');
    expect(richContent!.querySelector('strong')?.textContent).toBe('Raw');
  });
});
