import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LinearDocView } from '../LinearDocView';
import type { Doc, Block } from '@bendyline/squisq/schemas';
import { THEMES } from '@bendyline/squisq/schemas';

// ── Helpers ────────────────────────────────────────────────────────

function mkBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'block-1',
    startTime: 0,
    duration: 3,
    audioSegment: 0,
    ...overrides,
  } as Block;
}

function mkDoc(blocks: Block[], extra: Partial<Doc> = {}): Doc {
  return {
    articleId: 'test-article',
    duration: 10,
    blocks,
    audio: { segments: [] },
    ...extra,
  };
}

function tmpl(template: string, id: string, extra: Record<string, unknown> = {}): Block {
  return mkBlock({ id, template, ...extra } as Partial<Block>);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('page section rendering', () => {
  it('stamps page-style token data attributes from the theme', () => {
    const doc = mkDoc([tmpl('quote', 'q1', { quote: 'hello' })]);
    const { container } = render(<LinearDocView doc={doc} theme={THEMES.magazine} />);
    const page = container.querySelector('.squisq-page') as HTMLElement;
    expect(page.getAttribute('data-family')).toBe('editorial');
    expect(page.getAttribute('data-divider')).toBe('double-rule');
    expect(page.getAttribute('data-eyebrow')).toBe('kicker');
  });

  it('two themes produce different token attributes and CSS vars', () => {
    const doc = mkDoc([tmpl('quote', 'q1', { quote: 'hello' })]);
    const a = render(<LinearDocView doc={doc} theme={THEMES['tech-dark']} />).container;
    const b = render(<LinearDocView doc={doc} theme={THEMES.gezellig} />).container;
    const pageA = a.querySelector('.squisq-page') as HTMLElement;
    const pageB = b.querySelector('.squisq-page') as HTMLElement;
    expect(pageA.getAttribute('data-family')).not.toBe(pageB.getAttribute('data-family'));
    expect(pageA.style.getPropertyValue('--squisq-page-radius')).not.toBe(
      pageB.style.getPropertyValue('--squisq-page-radius'),
    );
  });

  it('renders a cover hero from doc.startBlock and honors showCover=false', () => {
    const doc = mkDoc([tmpl('quote', 'q1', { quote: 'body quote' })], {
      startBlock: { title: 'Cover Title', subtitle: 'The subtitle', heroSrc: 'hero.jpg' },
    });
    const withCover = render(<LinearDocView doc={doc} />).container;
    const hero = withCover.querySelector('[data-section-kind="hero"]');
    expect(hero).toBeTruthy();
    expect(hero!.querySelector('h1')?.textContent).toBe('Cover Title');
    expect(hero!.querySelector('img')?.getAttribute('src')).toContain('hero.jpg');

    const withoutCover = render(<LinearDocView doc={doc} showCover={false} />).container;
    expect(withoutCover.querySelector('[data-section-kind="hero"]')).toBeNull();
  });

  it('renders stat bands with values, comparison bars, and unit meta', () => {
    const doc = mkDoc([
      tmpl('comparisonBar', 'cmp', {
        leftLabel: 'North',
        leftValue: 30,
        rightLabel: 'South',
        rightValue: 60,
        unit: 'km',
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const section = container.querySelector('[data-section-kind="stat-band"]')!;
    expect(section.textContent).toContain('North');
    expect(section.textContent).toContain('km');
    const bars = section.querySelectorAll<HTMLElement>('.squisq-page-stat-bar');
    expect(bars).toHaveLength(2);
    expect(bars[0].style.width).toBe('50%');
    expect(bars[1].style.width).toBe('100%');
  });

  it('renders feature splits with media side variants', () => {
    const doc = mkDoc([
      tmpl('leftFeature', 'f1', { imageSrc: 'l.png', title: 'Left', body: 'lb' }),
      tmpl('rightFeature', 'f2', { imageSrc: 'r.png', title: 'Right', body: 'rb' }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const features = container.querySelectorAll('.squisq-page-feature');
    expect(features).toHaveLength(2);
    expect(features[0].classList.contains('squisq-page-feature--media-right')).toBe(false);
    expect(features[1].classList.contains('squisq-page-feature--media-right')).toBe(true);
  });

  it('lazy-loads section images with decoding=async', () => {
    const doc = mkDoc([
      tmpl('photoGrid', 'grid', {
        images: [
          { src: 'a.png', alt: 'a' },
          { src: 'b.png', alt: 'b' },
        ],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      expect(img.getAttribute('loading')).toBe('lazy');
      expect(img.getAttribute('decoding')).toBe('async');
    }
  });

  it('renders dataTable with alignment and item lists with entries', () => {
    const doc = mkDoc([
      tmpl('dataTable', 'tbl', {
        title: 'Numbers',
        headers: ['Name', 'Score'],
        rows: [['Ada', '99']],
        align: [null, 'right'],
      }),
      tmpl('list', 'lst', { title: 'Steps', items: ['One', 'Two', 'Three'] }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const table = container.querySelector('.squisq-page-table')!;
    expect(table.querySelectorAll('th')[1].style.textAlign).toBe('right');
    expect(table.textContent).toContain('Ada');
    const items = container.querySelectorAll('.squisq-page-items li');
    expect(items).toHaveLength(3);
    expect(items[2].textContent).toBe('Three');
  });

  it('renders timeline milestones and consecutive rails as sibling sections', () => {
    const doc = mkDoc([
      tmpl('dateEvent', 'd1', { date: '1969', description: 'Moon landing' }),
      tmpl('dateEvent', 'd2', { date: '1970', description: 'Apollo 13' }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const rails = container.querySelectorAll('[data-section-kind="timeline-rail"]');
    expect(rails).toHaveLength(2);
    expect(rails[0].textContent).toContain('1969');
    expect(rails[1].textContent).toContain('Apollo 13');
  });

  it('applies per-section accent scheme custom properties', () => {
    const doc = mkDoc([tmpl('sectionHeader', 's1', { title: 'Banner', colorScheme: 'teal' })]);
    const { container } = render(<LinearDocView doc={doc} theme={THEMES.standard} />);
    const section = container.querySelector<HTMLElement>('[data-section-kind="banner"]')!;
    expect(section.style.getPropertyValue('--squisq-page-accent')).toBe(
      THEMES.standard.colorSchemes.teal.accent,
    );
  });

  it('gives tech-dark canvas embeds the terminal frame hint', () => {
    const doc = mkDoc([
      tmpl('diagram', 'dg', {
        templateData: { nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }], edges: [] },
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} theme={THEMES['tech-dark']} />);
    expect(container.querySelector('.squisq-page-canvas--terminal')).toBeTruthy();
  });

  it('renders video figures through the inline video player', () => {
    const doc = mkDoc([
      tmpl('videoWithCaption', 'v1', {
        videoSrc: 'clip.mp4',
        videoAlt: 'clip',
        clipStart: 0,
        clipEnd: 5,
        caption: 'A clip',
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const figure = container.querySelector('[data-section-kind="media-figure"]')!;
    expect(figure.querySelector('video')).toBeTruthy();
    expect(figure.textContent).toContain('A clip');
  });

  it('quote bands over media render a backdrop and attribution', () => {
    const doc = mkDoc([
      tmpl('pullQuote', 'pq', {
        text: 'To the stars',
        attribution: 'A. Author',
        backgroundImage: { src: 'stars.jpg', alt: 'stars' },
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const section = container.querySelector('[data-section-kind="quote-band"]')!;
    expect(section.classList.contains('squisq-page-section--bg-media')).toBe(true);
    expect(section.querySelector('.squisq-page-quote-backdrop img')).toBeTruthy();
    expect(section.textContent).toContain('To the stars');
    expect(section.textContent).toContain('A. Author');
  });
});
