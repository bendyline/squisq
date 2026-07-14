/** Browser-only, lazy Mermaid renderer shared by all complex-diagram widgets. */

import type { RenderResult } from 'mermaid';
import type {
  MermaidEditableEdge,
  MermaidEditableModel,
  MermaidEditableNode,
  MermaidFlowchartDirection,
} from './mermaidModel';
import { normalizeMermaidFlowchartShape } from './mermaidShapes';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

interface MermaidQueueHost {
  __squisqMermaidWorkQueue?: Promise<void>;
}

function enqueueMermaidWork<T>(run: () => Promise<T>): Promise<T> {
  // Mermaid shares mutable diagram databases across imports. The React
  // rendition package uses this same global queue so an editor widget cannot
  // inspect while Page or Slideshow is rendering (or vice versa).
  const host = globalThis as typeof globalThis & MermaidQueueHost;
  const previous = host.__squisqMermaidWorkQueue ?? Promise.resolve();
  const result = previous.then(run, run);
  host.__squisqMermaidWorkQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

interface FlowVertexLike {
  id?: unknown;
  domId?: unknown;
  text?: unknown;
  type?: unknown;
  classes?: unknown;
}

interface FlowEdgeLike {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  text?: unknown;
  type?: unknown;
  stroke?: unknown;
  isUserDefinedId?: unknown;
}

interface FlowDbLike {
  getVertices?: () => Map<string, FlowVertexLike>;
  getEdges?: () => FlowEdgeLike[];
  getDirection?: () => string | undefined;
}

export interface MermaidRenderResult extends Pick<RenderResult, 'svg' | 'diagramType'> {
  /** Present for flowchart/graph sources that Mermaid exposes as editable nodes and edges. */
  model?: MermaidEditableModel;
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
): Promise<MermaidRenderResult> {
  const run = async (): Promise<MermaidRenderResult> => {
    const mermaid = await loadMermaid();
    const model = await inspectMermaidSourceWith(mermaid, source);
    const { svg, diagramType } = await mermaid.render(id, source, container);
    return model ? { svg, diagramType, model } : { svg, diagramType };
  };
  // `getDiagramFromText` and `render` share Mermaid diagram databases. Keep
  // each inspect+render pair together when several widgets mount at once.
  return enqueueMermaidWork(run);
}

/** Inspect the subset Mermaid exposes as structured flowchart nodes/edges. */
export function inspectMermaidSource(source: string): Promise<MermaidEditableModel | null> {
  return enqueueMermaidWork(async () => inspectMermaidSourceWith(await loadMermaid(), source));
}

async function inspectMermaidSourceWith(
  mermaid: typeof import('mermaid').default,
  source: string,
): Promise<MermaidEditableModel | null> {
  const getDiagramFromText = mermaid.mermaidAPI?.getDiagramFromText;
  if (typeof getDiagramFromText !== 'function') return null;
  try {
    const diagram = await getDiagramFromText(source);
    if (diagram.type !== 'flowchart' && diagram.type !== 'flowchart-v2') return null;
    const db = diagram.db as FlowDbLike;
    if (typeof db.getVertices !== 'function' || typeof db.getEdges !== 'function') return null;

    const nodes: MermaidEditableNode[] = [];
    for (const [fallbackId, vertex] of db.getVertices()) {
      const nodeId = typeof vertex.id === 'string' ? vertex.id : fallbackId;
      if (!nodeId) continue;
      nodes.push({
        id: nodeId,
        domId: typeof vertex.domId === 'string' ? vertex.domId : nodeId,
        label: typeof vertex.text === 'string' ? vertex.text : nodeId,
        shape: normalizeMermaidFlowchartShape(
          typeof vertex.type === 'string' ? vertex.type : undefined,
        ),
        classes: Array.isArray(vertex.classes)
          ? vertex.classes.filter((value): value is string => typeof value === 'string')
          : [],
      });
    }

    const edges: MermaidEditableEdge[] = db
      .getEdges()
      .map((edge, index) => ({
        id: typeof edge.id === 'string' ? edge.id : `edge-${index}`,
        source: typeof edge.start === 'string' ? edge.start : '',
        target: typeof edge.end === 'string' ? edge.end : '',
        label: typeof edge.text === 'string' ? edge.text : '',
        ...(typeof edge.type === 'string' ? { type: edge.type } : {}),
        ...(typeof edge.stroke === 'string' ? { stroke: edge.stroke } : {}),
        ...(typeof edge.isUserDefinedId === 'boolean'
          ? { userDefinedId: edge.isUserDefinedId }
          : {}),
      }))
      .filter((edge) => edge.source && edge.target);

    const rawDirection = db.getDirection?.();
    const direction: MermaidFlowchartDirection =
      rawDirection === 'TB' ||
      rawDirection === 'TD' ||
      rawDirection === 'BT' ||
      rawDirection === 'RL' ||
      rawDirection === 'LR'
        ? rawDirection
        : 'TB';
    return { kind: 'flowchart', direction, nodes, edges };
  } catch {
    // Rendering still owns the user-facing syntax error. Inspection is an
    // optional enhancement and must never prevent full Mermaid rendering.
    return null;
  }
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
