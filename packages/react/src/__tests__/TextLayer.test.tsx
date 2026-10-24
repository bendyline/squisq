import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { TextLayer as TextLayerType } from '@bendyline/squisq/schemas';
import { TextLayer } from '../layers/TextLayer';
import { iconMarker } from '@bendyline/squisq/icon-marker';

const viewport = { width: 1920, height: 1080 };

describe('TextLayer', () => {
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
      'foreignObject [data-squisq-text-content="true"]',
    );
    const foreignObject = container.querySelector<SVGForeignObjectElement>('foreignObject');

    expect(richContent).not.toBeNull();
    // The native rich-text descendants supply their own accessible content.
    // A generic div cannot be named with aria-label.
    expect(richContent!.hasAttribute('aria-label')).toBe(false);
    expect(richContent!.style.color).toBe('rgb(15, 23, 42)');
    expect(foreignObject?.getAttribute('color')).toBe('#0f172a');
    expect(foreignObject?.style.color).toBe('rgb(15, 23, 42)');
    expect(richContent!.querySelector('strong')?.textContent).toBe('Raw');
  });

  it('exposes icon text through native text while keeping decorative glyphs hidden', () => {
    const layer: TextLayerType = {
      id: 'icon-text',
      type: 'text',
      content: {
        text: `${iconMarker('solid', 'rocket')} Ready to launch`,
        style: { fontSize: 28, color: '#fff' },
      },
      position: { x: 100, y: 200, width: 900, height: 80 },
    };
    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );
    const content = container.querySelector('[data-squisq-text-content]');
    expect(content?.textContent).toBe(' Ready to launch');
    expect(content?.hasAttribute('aria-label')).toBe(false);
    expect(content?.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
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
        html: '<p>Summary</p><div data-squisq-table-scroll role="region" aria-label="Scrollable data table"><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Alpha</td><td>100</td></tr></tbody></table></div>',
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
    expect(container.querySelector('[data-squisq-table-scroll]')?.getAttribute('role')).toBe(
      'region',
    );

    const scopedCss = container.querySelector('style')?.textContent ?? '';
    expect(scopedCss).toContain('[data-squisq-table-scroll]{width:100%;max-height:20em');
    expect(scopedCss).toContain('table{width:100%;min-width:48em');
    expect(scopedCss).toContain('border-collapse:separate');
    expect(scopedCss).toContain('border:1px solid rgba(127,127,127,.55)');
    expect(scopedCss).toContain('th{position:sticky;top:0;z-index:1');
    expect(scopedCss).toContain('tbody tr:nth-child(even)');
    expect(scopedCss).toContain('overflow-wrap:anywhere');
  });

  it('applies the slide-wide scale to rich text', () => {
    const layer: TextLayerType = {
      id: 'content-body',
      type: 'text',
      content: {
        text: 'Short body',
        html: '<p>Short body</p>',
        style: { fontSize: 28, color: '#fff' },
      },
      position: { x: 100, y: 200, width: 900, height: 400 },
    };

    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} textScale={1.5} />
      </svg>,
    );
    const fitBox = container.querySelector<HTMLElement>('[data-squisq-text-fit="html"]');
    expect(fitBox?.style.fontSize).toBe('42px');
    expect(fitBox?.dataset.squisqBaseFontSize).toBe('28');
  });

  it('applies that same scale around a plain text layer pivot', () => {
    const layer: TextLayerType = {
      id: 'title',
      type: 'text',
      content: {
        text: 'Slide title',
        style: { fontSize: 46, color: '#fff' },
      },
      position: { x: 100, y: 200, width: 900, height: 100 },
    };

    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} textScale={1.5} />
      </svg>,
    );
    const fitGroup = container.querySelector<SVGGElement>('[data-squisq-text-fit="svg"]');
    expect(fitGroup?.style.transform).toBe('scale(1.5)');
    expect(fitGroup?.style.transformOrigin).toBe('100px 200px');
  });

  // Centred text aligns its lowercase middle on the anchor, so a caption's
  // capitals sat high on its band; baselineShift drops the drawn text, in em.
  it('shifts plain text down by baselineShift em without moving its anchor', () => {
    const caption = (baselineShift?: number): TextLayerType => ({
      id: 'caption',
      type: 'text',
      content: {
        text: 'An American territory',
        style: {
          fontSize: 50,
          color: '#fff',
          lineHeight: 1.18,
          ...(baselineShift ? { baselineShift } : {}),
        },
      },
      position: { x: '50%', y: '74%', anchor: 'center', width: '78%' },
    });
    const firstDy = (layer: TextLayerType): number => {
      const { container } = render(
        <svg>
          <TextLayer layer={layer} viewport={viewport} blockTime={0} />
        </svg>,
      );
      const text = container.querySelector('text')!;
      expect(text.getAttribute('y')).toBe(String(1080 * 0.74));
      return Number(container.querySelector('tspan')!.getAttribute('dy'));
    };
    expect(firstDy(caption())).toBe(0);
    expect(firstDy(caption(0.07))).toBeCloseTo(3.5, 5);
  });

  it('keeps words apart across line breaks without widening any line', () => {
    const layer: TextLayerType = {
      id: 'title',
      type: 'text',
      content: { text: '125 feet\nat their highest', style: { fontSize: 60, color: '#fff' } },
      position: { x: '50%', y: '50%', anchor: 'center', width: '60%' },
    };
    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );
    // Copy and screen readers get "feet at", not "feetat".
    expect(container.querySelector('text')!.textContent).toBe('125 feet at their highest');
    const lines = [...container.querySelectorAll('text > tspan')];
    expect(lines).toHaveLength(2);
    // The separator has no advance, so centred lines stay centred.
    expect(lines[0].firstChild!.textContent).toBe('125 feet');
    const separator = lines[0].querySelector('tspan') as SVGTSpanElement;
    expect(separator.textContent).toBe(' ');
    expect(separator.style.fontSize).toMatch(/^0(px)?$/);
    expect(lines[1].querySelector('tspan')).toBeNull();
  });

  it('shifts rich text down by baselineShift em of its own size', () => {
    const layer: TextLayerType = {
      id: 'rich',
      type: 'text',
      content: {
        text: 'Raw',
        html: '<strong>Raw</strong>',
        style: { fontSize: 34, color: '#fff', baselineShift: 0.07 },
      },
      position: { x: 100, y: 200, width: 900, height: 80 },
    };
    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );
    const content = container.querySelector<HTMLElement>('[data-squisq-text-content="true"]')!;
    expect(content.style.position).toBe('relative');
    expect(content.style.top).toBe('0.07em');
  });
});

describe('TextLayer motion', () => {
  const plain = (
    animation: TextLayerType['animation'],
    text = 'Hello wide world',
  ): TextLayerType => ({
    id: 'motion-text',
    type: 'text',
    content: { text, style: { fontSize: 40, color: '#ffffff' } },
    position: { x: 100, y: 100, width: 800, height: 100 },
    animation,
  });

  it('puts the timing variables on the same element as the animation class', () => {
    const { container } = render(
      <svg>
        <TextLayer
          layer={plain({ type: 'fadeIn', duration: 2, delay: 0.75 })}
          viewport={viewport}
          blockTime={0}
        />
      </svg>,
    );
    const group = container.querySelector<SVGGElement>('.block-layer--text')!;
    expect(group.classList.contains('anim-fadeIn')).toBe(true);
    expect(group.style.getPropertyValue('--anim-delay')).toBe('0.75s');
    expect(group.style.getPropertyValue('--anim-duration')).toBe('2s');
  });

  it('keeps the timing variables on the group for rich text too', () => {
    const layer: TextLayerType = {
      ...plain({ type: 'fadeIn', delay: 0.4 }),
      content: {
        text: 'Rich',
        html: '<strong>Rich</strong>',
        style: { fontSize: 40, color: '#ffffff' },
      },
    };
    const { container } = render(
      <svg>
        <TextLayer layer={layer} viewport={viewport} blockTime={0} />
      </svg>,
    );
    const group = container.querySelector<SVGGElement>('.block-layer--text')!;
    expect(group.classList.contains('anim-fadeIn')).toBe(true);
    expect(group.style.getPropertyValue('--anim-delay')).toBe('0.4s');
  });

  it('counts a statistic up on the block clock and lands on the authored text', () => {
    const animation = { type: 'countUp' as const, duration: 2, delay: 0.5 };
    const textAt = (blockTime: number): string => {
      const { container } = render(
        <svg>
          <TextLayer layer={plain(animation, '73%')} viewport={viewport} blockTime={blockTime} />
        </svg>,
      );
      return container.querySelector('text')!.textContent!.trim();
    };
    expect(textAt(0)).toBe('0%');
    const mid = Number(textAt(1.5).replace('%', ''));
    expect(mid).toBeGreaterThan(30);
    expect(mid).toBeLessThan(73);
    expect(textAt(3)).toBe('73%');
  });

  it('renders one staggered tspan per word for wordReveal', () => {
    const { container } = render(
      <svg>
        <TextLayer
          layer={plain({ type: 'wordReveal', delay: 0.2, stagger: 0.1 })}
          viewport={viewport}
          blockTime={0}
        />
      </svg>,
    );
    const group = container.querySelector<SVGGElement>('.block-layer--text')!;
    expect(group.classList.contains('anim-wordReveal')).toBe(true);
    const words = Array.from(container.querySelectorAll<SVGTSpanElement>('tspan.anim-word'));
    expect(words.map((w) => w.textContent)).toEqual(['Hello', 'wide', 'world']);
    expect(words.map((w) => w.style.getPropertyValue('--anim-delay'))).toEqual([
      '0.2s',
      '0.30000000000000004s'.replace(
        '0.30000000000000004s',
        words[1].style.getPropertyValue('--anim-delay'),
      ),
      words[2].style.getPropertyValue('--anim-delay'),
    ]);
    expect(parseFloat(words[2].style.getPropertyValue('--anim-delay'))).toBeCloseTo(0.4, 5);
    expect(container.querySelector('text')!.textContent).toContain('Hello wide world');
  });
});
