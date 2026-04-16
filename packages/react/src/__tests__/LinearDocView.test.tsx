import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LinearDocView } from '../LinearDocView';
import type { Doc, Block } from '@bendyline/squisq/schemas';
import {
  DARK_SURFACE,
  DEFAULT_THEME,
  LIGHT_SURFACE,
} from '@bendyline/squisq/schemas';
import type {
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownHeading,
} from '@bendyline/squisq/markdown';

// ── Helpers ────────────────────────────────────────────────────────

function text(value: string): MarkdownInlineNode {
  return { type: 'text', value };
}

function paragraph(...children: MarkdownInlineNode[]): MarkdownBlockNode {
  return { type: 'paragraph', children };
}

function mkHeading(depth: 1 | 2 | 3, value: string): MarkdownHeading {
  return { type: 'heading', depth, children: [text(value)] };
}

function mkBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'block-1',
    startTime: 0,
    duration: 3,
    audioSegment: 0,
    ...overrides,
  };
}

function mkDoc(blocks: Block[]): Doc {
  return {
    articleId: 'test-article',
    duration: 10,
    blocks,
    audio: { segments: [] },
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('LinearDocView', () => {
  it('renders a scrollable container', () => {
    const doc = mkDoc([
      mkBlock({
        id: 'preamble',
        contents: [paragraph(text('Introduction text'))],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const el = container.querySelector('.squisq-linear');
    expect(el).toBeTruthy();
    expect((el as HTMLElement).style.overflowY).toBe('auto');
  });

  it('renders preamble content (no heading)', () => {
    const doc = mkDoc([
      mkBlock({
        id: 'preamble',
        contents: [paragraph(text('Preamble body'))],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    // Should render paragraph but no heading
    expect(container.textContent).toContain('Preamble body');
    const headings = container.querySelectorAll('h1, h2, h3');
    expect(headings.length).toBe(0);
  });

  it('renders non-annotated block with heading + content', () => {
    const doc = mkDoc([
      mkBlock({
        id: 'section-1',
        sourceHeading: mkHeading(2, 'My Section'),
        contents: [paragraph(text('Section body text'))],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    expect(container.querySelector('h2')?.textContent).toBe('My Section');
    expect(container.textContent).toContain('Section body text');
  });

  it('renders annotated block as SVG card', () => {
    const doc = mkDoc([
      mkBlock({
        id: 'annotated-1',
        template: 'sectionHeader',
        sourceHeading: {
          type: 'heading',
          depth: 2,
          children: [text('Visual Block')],
          templateAnnotation: {
            template: 'sectionHeader',
          },
        },
        contents: [paragraph(text('Body'))],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    // Should have a card wrapper
    const card = container.querySelector('.squisq-linear-card');
    expect(card).toBeTruthy();
    // Should contain an SVG (from BlockRenderer)
    const svg = card?.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders children recursively', () => {
    const doc = mkDoc([
      mkBlock({
        id: 'parent',
        sourceHeading: mkHeading(1, 'Parent'),
        contents: [paragraph(text('Parent body'))],
        children: [
          mkBlock({
            id: 'child',
            sourceHeading: mkHeading(2, 'Child'),
            contents: [paragraph(text('Child body'))],
          }),
        ],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    expect(container.querySelector('h1')?.textContent).toBe('Parent');
    expect(container.querySelector('h2')?.textContent).toBe('Child');
    expect(container.textContent).toContain('Parent body');
    expect(container.textContent).toContain('Child body');
  });

  it('renders multiple top-level blocks', () => {
    const doc = mkDoc([
      mkBlock({
        id: 'b1',
        sourceHeading: mkHeading(1, 'First'),
        contents: [],
      }),
      mkBlock({
        id: 'b2',
        sourceHeading: mkHeading(1, 'Second'),
        contents: [],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    const sections = container.querySelectorAll('.squisq-linear-section');
    expect(sections.length).toBe(2);
  });

  it('does not render SVG for non-annotated blocks', () => {
    const doc = mkDoc([
      mkBlock({
        id: 'plain',
        sourceHeading: mkHeading(2, 'Plain Section'),
        contents: [paragraph(text('Just text'))],
      }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    expect(container.querySelector('.squisq-linear-card')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('applies custom className', () => {
    const doc = mkDoc([mkBlock({ id: 'x', contents: [] })]);
    const { container } = render(<LinearDocView doc={doc} className="my-class" />);
    expect(container.querySelector('.squisq-linear.my-class')).toBeTruthy();
  });

  it('sets data-block-id on each section', () => {
    const doc = mkDoc([
      mkBlock({ id: 'alpha', contents: [] }),
      mkBlock({ id: 'beta', contents: [] }),
    ]);
    const { container } = render(<LinearDocView doc={doc} />);
    expect(container.querySelector('[data-block-id="alpha"]')).toBeTruthy();
    expect(container.querySelector('[data-block-id="beta"]')).toBeTruthy();
  });

  it('uses the theme background by default', () => {
    const doc = mkDoc([mkBlock({ id: 'b', contents: [paragraph(text('hi'))] })]);
    const { container } = render(<LinearDocView doc={doc} />);
    const el = container.querySelector('.squisq-linear') as HTMLElement;
    expect(el.style.background).toBeTruthy();
    // DEFAULT_THEME has a specific background; applying LIGHT_SURFACE below
    // must produce a different value to prove override is working.
    expect(el.style.background).not.toBe(LIGHT_SURFACE.background);
  });

  it('light surface overlays the theme background', () => {
    const doc = mkDoc([mkBlock({ id: 'b', contents: [paragraph(text('hi'))] })]);
    const { container } = render(
      <LinearDocView doc={doc} theme={DEFAULT_THEME} surface={LIGHT_SURFACE} />,
    );
    const el = container.querySelector('.squisq-linear') as HTMLElement;
    // React inline style background may round-trip as hex or rgb; compare the
    // colour-normalized value by mounting a plain div with the expected.
    const probe = document.createElement('div');
    probe.style.background = LIGHT_SURFACE.background;
    expect(el.style.background).toBe(probe.style.background);
  });

  it('dark surface overlays the theme background', () => {
    const doc = mkDoc([mkBlock({ id: 'b', contents: [paragraph(text('hi'))] })]);
    const { container } = render(
      <LinearDocView doc={doc} theme={DEFAULT_THEME} surface={DARK_SURFACE} />,
    );
    const el = container.querySelector('.squisq-linear') as HTMLElement;
    const probe = document.createElement('div');
    probe.style.background = DARK_SURFACE.background;
    expect(el.style.background).toBe(probe.style.background);
  });
});
