import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '@bendyline/squisq/schemas';
import { MermaidDiagram } from '../mermaid/MermaidDiagram';

const { renderMermaidSvg } = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(),
}));

vi.mock('../mermaid/mermaidRuntime.js', () => ({
  mermaidRenderErrorMessage: (error: unknown) => String(error),
  renderMermaidSvg,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('MermaidDiagram', () => {
  beforeEach(() => {
    renderMermaidSvg.mockReset();
  });

  it('hides the previous SVG while rendering updated source', async () => {
    renderMermaidSvg.mockResolvedValueOnce({
      svg: '<svg><text>First diagram</text></svg>',
      diagramType: 'flowchart-v2',
    });
    const nextRender = deferred<{ svg: string; diagramType: string }>();
    renderMermaidSvg.mockReturnValueOnce(nextRender.promise);

    const { container, rerender } = render(<MermaidDiagram source="flowchart LR; a --> b" />);
    await waitFor(() => {
      expect(container.querySelector('.squisq-mermaid-render-svg')?.textContent).toBe(
        'First diagram',
      );
    });

    rerender(<MermaidDiagram source="flowchart LR; c --> d" />);
    await waitFor(() => {
      expect(renderMermaidSvg).toHaveBeenCalledTimes(2);
      expect(container.querySelector('.squisq-mermaid-render-status')).not.toBeNull();
    });
    expect(container.querySelector('.squisq-mermaid-render-svg')).toBeNull();

    await act(async () => {
      nextRender.resolve({
        svg: '<svg><text>Second diagram</text></svg>',
        diagramType: 'flowchart-v2',
      });
    });
    expect(container.querySelector('.squisq-mermaid-render-svg')?.textContent).toBe(
      'Second diagram',
    );
  });

  it('re-renders unchanged source when the active theme changes', async () => {
    renderMermaidSvg.mockResolvedValue({
      svg: '<svg><text>Themed diagram</text></svg>',
      diagramType: 'flowchart-v2',
    });
    const source = 'flowchart LR; a --> b';
    const { rerender } = render(<MermaidDiagram source={source} theme={THEMES.standard} />);
    await waitFor(() => expect(renderMermaidSvg).toHaveBeenCalledTimes(1));

    rerender(<MermaidDiagram source={source} theme={THEMES.magazine} />);
    await waitFor(() => expect(renderMermaidSvg).toHaveBeenCalledTimes(2));
    expect(renderMermaidSvg).toHaveBeenLastCalledWith(
      expect.any(String),
      source,
      undefined,
      THEMES.magazine,
    );
  });
});
