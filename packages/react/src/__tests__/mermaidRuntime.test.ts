import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: { initialize: mocks.initialize, render: mocks.render },
}));

import { renderMermaidSvg, withMermaidLabelWrapping } from '../mermaid/mermaidRuntime';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A Mermaid HTML label: a max-width div directly inside a foreignObject. */
function label(maxWidth = '200px'): HTMLDivElement {
  const foreignObject = document.createElementNS(SVG_NS, 'foreignObject');
  const div = document.createElement('div');
  div.style.maxWidth = maxWidth;
  foreignObject.appendChild(div);
  document.body.appendChild(foreignObject);
  return div;
}

/** Report `width` for every element, as Chromium does for a clamped label at 133 %. */
function measureEverythingAs(width: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(10, 20, width, 24),
  );
}

describe('withMermaidLabelWrapping', () => {
  beforeEach(() => {
    mocks.render.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('reports a label clamped at its max-width as exactly that width', async () => {
    const div = label();
    measureEverythingAs(199.9953155517578);
    const rect = await withMermaidLabelWrapping(async () => div.getBoundingClientRect());
    expect(rect.width).toBe(200);
    expect([rect.x, rect.y, rect.height]).toEqual([10, 20, 24]);

    measureEverythingAs(200.00001525878906);
    await expect(
      withMermaidLabelWrapping(async () => div.getBoundingClientRect().width),
    ).resolves.toBe(200);
  });

  it('leaves narrower labels and other elements as measured', async () => {
    const narrow = label();
    const page = document.createElement('div');
    page.style.maxWidth = '200px';
    document.body.appendChild(page);
    measureEverythingAs(150);
    await expect(
      withMermaidLabelWrapping(async () => narrow.getBoundingClientRect().width),
    ).resolves.toBe(150);

    measureEverythingAs(199.9953155517578);
    await expect(
      withMermaidLabelWrapping(async () => page.getBoundingClientRect().width),
    ).resolves.toBe(199.9953155517578);
  });

  it('restores measurement after Mermaid finishes or fails', async () => {
    const div = label();
    measureEverythingAs(199.9953155517578);
    await withMermaidLabelWrapping(async () => undefined);
    expect(div.getBoundingClientRect().width).toBe(199.9953155517578);

    await expect(
      withMermaidLabelWrapping(async () => {
        throw new Error('parse error');
      }),
    ).rejects.toThrow('parse error');
    expect(div.getBoundingClientRect().width).toBe(199.9953155517578);
  });

  it('lets Mermaid wrap labels when rendering at a fractional display scale', async () => {
    measureEverythingAs(199.9953155517578);
    // Mermaid's addHtmlSpan switches a label to wrapping only on an exact match.
    mocks.render.mockImplementation(async () => {
      const wraps = label().getBoundingClientRect().width === 200;
      return {
        svg: wraps ? '<svg>wrapped</svg>' : '<svg>one line</svg>',
        diagramType: 'flowchart-v2',
      };
    });
    await expect(renderMermaidSvg('wrap', 'flowchart LR; a --> b')).resolves.toEqual({
      svg: '<svg>wrapped</svg>',
      diagramType: 'flowchart-v2',
    });
  });
});
