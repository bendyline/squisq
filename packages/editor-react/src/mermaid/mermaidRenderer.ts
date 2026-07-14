/** Browser-only, lazy Mermaid renderer shared by all complex-diagram widgets. */

import type { RenderResult } from 'mermaid';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

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
        // A transient chunk-load failure should not poison every diagram for
        // the rest of the editor session.
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

/**
 * Render through Mermaid's public API so all diagram types supported by the
 * pinned Mermaid release share the same path. The caller owns insertion of
 * the returned SVG; interactive `bindFunctions` are intentionally not run in
 * the editor, preventing authored links/callbacks from hijacking editing.
 */
export async function renderMermaidDiagram(
  id: string,
  source: string,
  container?: Element,
): Promise<Pick<RenderResult, 'svg' | 'diagramType'>> {
  const mermaid = await loadMermaid();
  const { svg, diagramType } = await mermaid.render(id, source, container);
  return { svg, diagramType };
}

export function mermaidErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');
  return message || 'Unknown Mermaid rendering error.';
}
