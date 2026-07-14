import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mocks.initialize,
    render: mocks.render,
  },
}));

import { mermaidErrorMessage, renderMermaidDiagram } from '../mermaidRenderer';

describe('Mermaid renderer', () => {
  beforeEach(() => {
    mocks.render.mockReset();
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
