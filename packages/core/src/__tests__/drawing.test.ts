import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { stringifyMarkdown } from '../markdown/stringify.js';
import { markdownToDoc, flattenBlocks, flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { validateMarkdownSource } from '../doc/validate.js';
import { isContainerTemplate } from '../doc/templates/index.js';

const ORG_CHART = `## Org chart {[drawing]}

### CEO {#ceo} {[rectangle x=21 y=25 width=100 height=100]}

The CEO is the chief executive.

### reports to {[line from=ceo to=dev1]}

### Developer {#dev1} {[rectangle x=21 y=190 width=100 height=100]}

The lead developer.
`;

describe('drawing markdown → doc', () => {
  it('turns child headings into shape blocks with geometry overrides', () => {
    const doc = markdownToDoc(parseMarkdown(ORG_CHART));
    const drawing = doc.blocks[0];
    expect(drawing.template).toBe('drawing');
    expect(drawing.children).toHaveLength(3);

    const ceo = drawing.children!.find((c) => c.id === 'ceo')!;
    expect(ceo.template).toBe('rectangle');
    expect(ceo.title).toBe('CEO');
    expect(ceo.templateOverrides).toEqual({
      x: '21',
      y: '25',
      width: '100',
      height: '100',
    });

    const line = drawing.children!.find((c) => c.id === 'reports-to')!;
    expect(line.template).toBe('line');
    expect(line.templateOverrides).toEqual({ from: 'ceo', to: 'dev1' });
  });

  it('round-trips losslessly (shape annotations + ids survive)', () => {
    const once = stringifyMarkdown(parseMarkdown(ORG_CHART));
    // Canonical form is stable: a second pass is identical to the first.
    const twice = stringifyMarkdown(parseMarkdown(once));
    expect(twice).toBe(once);
    expect(once).toContain('{#ceo} {[rectangle x=21 y=25 width=100 height=100]}');
    expect(once).toContain('{[line from=ceo to=dev1]}');
  });
});

describe('drawing validation', () => {
  it('reports no diagnostics for a well-formed drawing', () => {
    const { diagnostics, errorCount } = validateMarkdownSource(ORG_CHART);
    expect(errorCount).toBe(0);
    expect(diagnostics).toEqual([]);
  });

  it('flags an unknown shape with a did-you-mean suggestion', () => {
    const md = `## D {[drawing]}\n\n### A {[rectanlge x=0 y=0]}\n`;
    const { diagnostics } = validateMarkdownSource(md);
    const d = diagnostics.find((x) => x.code === 'unknown-shape');
    expect(d).toBeDefined();
    expect(d!.message).toContain('rectangle');
  });

  it('flags a shape annotation used outside a drawing', () => {
    const md = `## Not a drawing\n\n### A {[rectangle x=0 y=0]}\n`;
    const { diagnostics } = validateMarkdownSource(md);
    expect(diagnostics.some((x) => x.code === 'shape-outside-drawing')).toBe(true);
  });

  it('flags a connector whose from/to does not resolve', () => {
    const md = `## D {[drawing]}\n\n### A {#a} {[rect x=0 y=0]}\n\n### L {[line from=a to=ghost]}\n`;
    const { diagnostics } = validateMarkdownSource(md);
    const d = diagnostics.find((x) => x.code === 'unresolved-connection');
    expect(d).toBeDefined();
    expect(d!.message).toContain('ghost');
  });

  it('flags non-numeric shape geometry', () => {
    const md = `## D {[drawing]}\n\n### A {[rectangle x=abc y=0]}\n`;
    const { diagnostics } = validateMarkdownSource(md);
    expect(diagnostics.some((x) => x.code === 'invalid-attribute' && x.message.includes('x'))).toBe(
      true,
    );
  });
});

describe('container-template suppression', () => {
  it('isContainerTemplate covers diagram and drawing only', () => {
    expect(isContainerTemplate('drawing')).toBe(true);
    expect(isContainerTemplate('diagram')).toBe(true);
    expect(isContainerTemplate('sectionHeader')).toBe(false);
    expect(isContainerTemplate(undefined)).toBe(false);
  });

  it('flattenRenderableBlocks skips a drawing’s child shapes', () => {
    const doc = markdownToDoc(parseMarkdown(ORG_CHART));
    const all = flattenBlocks(doc.blocks);
    const renderable = flattenRenderableBlocks(doc.blocks);
    // Full flatten includes the drawing + its 3 shapes; renderable has only
    // the drawing itself (its shapes are consumed by the drawing's render).
    expect(all.length).toBe(4);
    expect(renderable.length).toBe(1);
    expect(renderable[0].template).toBe('drawing');
  });
});
