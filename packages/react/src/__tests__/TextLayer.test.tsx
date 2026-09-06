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

  it('renders authored lists as semantic lists with space before following prose', () => {
    const layer: TextLayerType = {
      id: 'content-body',
      type: 'text',
      content: {
        text: '• First\n• Second\n\nImplication: change is happening',
        html: '<ul><li><p>First</p></li><li><p>Second</p></li></ul><p>Implication: change is happening</p>',
        style: { fontSize: 28, color: '#fff' },
      },
      position: { x: 100, y: 200, width: 900, height: 400 },
    };

    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );

    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelector('ul + p')?.textContent).toBe('Implication: change is happening');
    expect(container.querySelector('style')?.textContent).toContain('margin:0 0 .7em');
    expect(container.querySelector('style')?.textContent).toContain('list-style-position:outside');
  });

  it('keeps source-gap lines in sanitized rich text', () => {
    const layer: TextLayerType = {
      id: 'content-body',
      type: 'text',
      content: {
        text: 'Before\n\n\n\nAfter',
        html: '<p>Before</p><div data-squisq-source-gap aria-hidden="true"><br></div><div data-squisq-source-gap aria-hidden="true"><br></div><p>After</p>',
        style: { fontSize: 28, color: '#fff' },
      },
      position: { x: 100, y: 200, width: 900, height: 400 },
    };

    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );

    const gaps = container.querySelectorAll('div[data-squisq-source-gap]');
    expect(gaps).toHaveLength(2);
    expect([...gaps].every((gap) => gap.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('styles Markdown tables embedded alongside slide prose', () => {
    const layer: TextLayerType = {
      id: 'content-body',
      type: 'text',
      content: {
        text: 'Summary\n\nName Value\nAlpha 100',
        html: '<p>Summary</p><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Alpha</td><td>100</td></tr></tbody></table>',
        style: { fontSize: 28, color: '#e2e8f0' },
      },
      position: { x: 100, y: 200, width: 900, height: 400 },
    };

    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );

    expect(container.querySelectorAll('table th')).toHaveLength(2);
    expect(container.querySelectorAll('table td')).toHaveLength(2);

    const scopedCss = container.querySelector('style')?.textContent ?? '';
    expect(scopedCss).toContain('table{width:100%');
    expect(scopedCss).toContain('border-collapse:collapse');
    expect(scopedCss).toContain('border:1px solid rgba(127,127,127,.55)');
    expect(scopedCss).toContain('th{background:rgba(127,127,127,.16)');
    expect(scopedCss).toContain('tbody tr:nth-child(even)');
    expect(scopedCss).toContain('overflow-wrap:anywhere');
  });
});
