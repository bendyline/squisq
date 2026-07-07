/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { CodeContextSectionView } from '../codeContext/CodeContextSectionView';

const noop = () => {};

const baseSection = {
  id: 'foo@10',
  summaryMarkdown: '**foo** — does things · ↓2 imported-by',
  markdown: 'Body text with [`a.ts`](gezel-nav:src%2Fa.ts) and [line 4](#L4).',
};

function renderView(over: Partial<Parameters<typeof CodeContextSectionView>[0]> = {}) {
  const props = {
    section: baseSection,
    expanded: false,
    onToggle: vi.fn(),
    linkSchemes: ['gezel-nav'] as const,
    onLinkClick: vi.fn(),
    onRevealLine: vi.fn(),
    onMeasure: noop,
    ...over,
  };
  const utils = render(<CodeContextSectionView {...props} />);
  return { ...utils, props };
}

describe('<CodeContextSectionView>', () => {
  it('renders the strip collapsed, body absent (lazy)', () => {
    const { container } = renderView();
    expect(container.querySelector('.squisq-ccx-strip')).toBeTruthy();
    expect(container.textContent).toContain('foo');
    expect(container.querySelector('.squisq-ccx-body')).toBeNull();
  });

  it('strip click calls onToggle with the section id', () => {
    const { container, props } = renderView();
    fireEvent.click(container.querySelector('.squisq-ccx-strip')!);
    expect(props.onToggle).toHaveBeenCalledWith('foo@10');
  });

  it('expanded body renders markdown with host-scheme links as real anchors', () => {
    const { container } = renderView({ expanded: true });
    const body = container.querySelector('.squisq-ccx-body')!;
    expect(body.textContent).toContain('Body text');
    const anchors = [...body.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(anchors).toContain('gezel-nav:src%2Fa.ts');
    expect(anchors).toContain('#L4');
  });

  it('expanded without markdown shows the loading row', () => {
    const { container } = renderView({
      expanded: true,
      section: { ...baseSection, markdown: undefined },
    });
    expect(container.querySelector('.squisq-ccx-body--loading')?.textContent).toBe('Loading…');
  });

  it('link clicks are intercepted: handled by default, defaulted on false', () => {
    const onLinkClick = vi.fn(() => undefined);
    const { container } = renderView({ expanded: true, onLinkClick });
    const nav = [...container.querySelectorAll('a')].find(
      (a) => a.getAttribute('href') === 'gezel-nav:src%2Fa.ts',
    )!;
    const first = fireEvent.click(nav);
    expect(onLinkClick).toHaveBeenCalledWith('gezel-nav:src%2Fa.ts', { sectionId: 'foo@10' });
    expect(first).toBe(false); // preventDefault was called

    onLinkClick.mockReturnValue(false as unknown as undefined);
    const second = fireEvent.click(nav);
    expect(second).toBe(true); // host declined — default navigation allowed
  });

  it('#L links reveal natively and never reach onLinkClick', () => {
    const onLinkClick = vi.fn();
    const onRevealLine = vi.fn();
    const { container } = renderView({ expanded: true, onLinkClick, onRevealLine });
    const line = [...container.querySelectorAll('a')].find(
      (a) => a.getAttribute('href') === '#L4',
    )!;
    fireEvent.click(line);
    expect(onRevealLine).toHaveBeenCalledWith(4);
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it('without linkSchemes, custom-scheme links render blocked (no anchor)', () => {
    const { container } = renderView({ expanded: true, linkSchemes: undefined });
    const anchors = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(anchors).not.toContain('gezel-nav:src%2Fa.ts');
    expect(container.querySelector('.squisq-md-link--blocked')).toBeTruthy();
  });
});
