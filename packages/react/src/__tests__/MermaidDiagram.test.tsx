import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
