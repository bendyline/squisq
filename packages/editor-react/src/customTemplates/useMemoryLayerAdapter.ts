/**
 * In-memory variant of LayoutAdapter.
 *
 * `useLayoutAdapter` persists Layer mutations to a heading's
 * `data-block-attrs` Pandoc param. For the template designer, the
 * Layer[] doesn't belong to a heading — it's being authored in a
 * modal and saved to the doc / library as a `CustomTemplateDefinition`
 * only when the user clicks Save. This adapter swaps Tiptap-backed
 * storage for a plain React state holder so the designer can reuse
 * the Scene component verbatim.
 *
 * Returns the same `{ layers, tools, dispatch }` shape as
 * `useLayoutAdapter` so the Scene API surface stays consistent.
 */

import { useCallback, useState } from 'react';
import type { Layer } from '@bendyline/squisq/schemas';
import type { SceneCommand, SceneTool } from '../scene';

export interface MemoryLayerAdapterResult {
  layers: Layer[];
  tools: SceneTool[];
  dispatch: (cmd: SceneCommand) => void;
  /** Replace the entire layer array (e.g. for Load / Reset / template-fork flows). */
  setLayers: (next: Layer[]) => void;
}

export interface MemoryLayerAdapterOptions {
  /** Initial layer array. */
  initial?: Layer[];
  /** Tool set the host should expose. Required — typically Select + token tools. */
  tools: SceneTool[];
}

/**
 * Manage a Layer[] in React state and expose it through the same
 * adapter contract the Scene expects. SceneCommands are interpreted
 * against the in-memory array and applied via `setLayers`.
 */
export function useMemoryLayerAdapter(
  options: MemoryLayerAdapterOptions,
): MemoryLayerAdapterResult {
  const [layers, setLayers] = useState<Layer[]>(() => options.initial ?? []);

  const dispatch = useCallback((cmd: SceneCommand) => {
    setLayers((current) => applyCommand(current, cmd));
  }, []);

  return {
    layers,
    tools: options.tools,
    dispatch,
    setLayers,
  };
}

/**
 * Pure application of a SceneCommand against a Layer[]. Exported so
 * tests can exercise the reducer in isolation.
 */
export function applyCommand(layers: readonly Layer[], cmd: SceneCommand): Layer[] {
  switch (cmd.kind) {
    case 'moveLayer':
      return layers.map((l) =>
        l.id === cmd.id ? ({ ...l, position: { ...l.position, x: cmd.x, y: cmd.y } } as Layer) : l,
      );
    case 'resizeLayer':
      return layers.map((l) =>
        l.id === cmd.id
          ? ({
              ...l,
              position: {
                ...l.position,
                ...(cmd.x !== undefined ? { x: cmd.x } : {}),
                ...(cmd.y !== undefined ? { y: cmd.y } : {}),
                width: cmd.width,
                height: cmd.height,
              },
            } as Layer)
          : l,
      );
    case 'addLayer':
      return [...layers, cmd.layer];
    case 'removeLayer':
      return layers.filter((l) => l.id !== cmd.id);
    case 'setLayerAttr':
      return layers.map((l) => (l.id === cmd.id ? setAttrAtPath(l, cmd.path, cmd.value) : l));
    case 'renameLayer':
      return layers.map((l) => {
        if (l.id !== cmd.id) return l;
        if (l.type !== 'text') return l;
        return { ...l, content: { ...l.content, text: cmd.label } };
      });
    case 'setLayerText':
      return layers.map((l) => {
        if (l.id !== cmd.id || l.type !== 'text') return l;
        const content = { ...l.content, text: cmd.text };
        if (cmd.html && cmd.html.trim()) content.html = cmd.html;
        else delete content.html;
        return { ...l, content };
      });
    case 'addEdge':
    case 'removeEdge':
      // No edge model in memory adapter; ignored.
      return layers.slice();
  }
  const _exhaustive: never = cmd;
  void _exhaustive;
  return layers.slice();
}

/**
 * Set a deeply-nested field on a Layer via a dotted path. Returns a
 * new Layer; the input is not mutated. JSON-clone is safe for Layer
 * since the schema is pure plain data.
 */
function setAttrAtPath(layer: Layer, path: string, value: unknown): Layer {
  const segments = path.split('.');
  const next = JSON.parse(JSON.stringify(layer)) as Layer;
  let target: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    const child = target[key];
    if (typeof child !== 'object' || child === null) return layer;
    target = child as Record<string, unknown>;
  }
  target[segments[segments.length - 1]] = value;
  return next;
}
