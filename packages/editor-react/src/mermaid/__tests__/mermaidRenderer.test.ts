import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '@bendyline/squisq/schemas';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
  parse: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mocks.initialize,
    render: mocks.render,
    parse: mocks.parse,
  },
}));

import {
  mermaidErrorMessage,
  renderMermaidDiagram,
  validateMermaidSource,
} from '../mermaidRenderer';

describe('Mermaid renderer', () => {
  beforeEach(() => {
    mocks.initialize.mockClear();
    mocks.render.mockReset();
  });

  it('configures Mermaid from the active Squisq theme for every render', async () => {
    mocks.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 200 100"></svg>',
      diagramType: 'timeline',
    });

    await renderMermaidDiagram(
      'diagram-themed',
      'timeline\n  Q1 : Research',
      undefined,
      THEMES.magazine,
    );

    expect(mocks.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        theme: 'base',
        themeVariables: expect.objectContaining({
          background: THEMES.magazine.colors.background,
          primaryColor: THEMES.magazine.colors.primary,
          secondaryColor: THEMES.magazine.colors.secondary,
          cScale0: THEMES.magazine.colors.primary,
          cScale1: THEMES.magazine.colors.secondary,
        }),
      }),
    );
  });

  it('uses Mermaid output without narrowing the authored syntax', async () => {
    const source = 'sequenceDiagram\n  Alice->>Bob: Hello';
    mocks.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 200 100"></svg>',
      diagramType: 'sequence',
      bindFunctions: vi.fn(),
    });
    const container = document.createElement('div');
    await expect(renderMermaidDiagram('diagram-1', source, container)).resolves.toEqual({
      svg: '<svg viewBox="0 0 200 100"></svg>',
      diagramType: 'sequence',
    });
    expect(mocks.render).toHaveBeenCalledWith('diagram-1', source, container);
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        startOnLoad: false,
        suppressErrorRendering: true,
      }),
    );
  });

  it('keeps parser errors concise for the inline error panel', () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    expect(mermaidErrorMessage(new Error(lines.join('\n'))).split('\n')).toHaveLength(8);
    expect(mermaidErrorMessage(new Error(''))).toBe('Unknown Mermaid rendering error.');
  });
});

describe('validateMermaidSource', () => {
  beforeEach(() => {
    mocks.parse.mockReset();
  });

  it('reports the diagram type for source Mermaid can read', async () => {
    mocks.parse.mockResolvedValue({ diagramType: 'flowchart-v2', config: {} });
    await expect(validateMermaidSource('flowchart LR\n  a --> b')).resolves.toEqual({
      ok: true,
      diagramType: 'flowchart-v2',
    });
  });

  it("returns Mermaid's own error, trimmed, for source it cannot read", async () => {
    mocks.parse.mockRejectedValue(new Error('Parse error on line 2:\n...a -->\n\nExpecting NODE'));
    const result = await validateMermaidSource('flowchart LR\n  a -->');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toBe(
      'Parse error on line 2:\n...a -->\nExpecting NODE',
    );
  });

  it('never renders or measures anything', async () => {
    mocks.parse.mockResolvedValue({ diagramType: 'pie', config: {} });
    mocks.render.mockClear();
    await validateMermaidSource('pie\n  "A" : 1');
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
