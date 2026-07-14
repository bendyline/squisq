/** Browser-only, lazy official Mermaid renderer shared by page and slide views. */

import type { RenderResult } from 'mermaid';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

interface MermaidQueueHost {
  __squisqMermaidWorkQueue?: Promise<void>;
}

async function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          deterministicIds: false,
          logLevel: 'error',
        });
        return mermaid;
      })
      .catch((error: unknown) => {
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  // Mermaid's diagram databases are shared by every consumer of the loaded
  // module. Keep editor inspection/rendering and read-only rendition work in
  // one browser-wide queue even though they live in separate packages.
  const host = globalThis as typeof globalThis & MermaidQueueHost;
  const previous = host.__squisqMermaidWorkQueue ?? Promise.resolve();
  const result = previous.then(run, run);
  host.__squisqMermaidWorkQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Render one source through Mermaid's public API. */
export function renderMermaidSvg(
  id: string,
  source: string,
  container?: Element,
): Promise<Pick<RenderResult, 'svg' | 'diagramType'>> {
  return enqueue(async () => {
    const mermaid = await loadMermaid();
    const { svg, diagramType } = await mermaid.render(id, source, container);
    return { svg, diagramType };
  });
}

export function mermaidRenderErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    raw
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(0, 6)
      .join('\n') || 'Unknown Mermaid rendering error.'
  );
}
