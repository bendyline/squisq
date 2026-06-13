/**
 * LayoutAdapter — edit a block's free-form Layer[] override.
 *
 * The adapter reads the layer array stored alongside a heading and
 * provides a SceneCommand dispatcher that writes mutations back to
 * markdown via `blockLayers.ts`. The Scene component renders the layers
 * via `RenderLayer` (the same SSR components used by previews) so the
 * editor and the final block render produce identical pixels.
 *
 * Default toolset: Select only. The DrawingAdapter exposes the same
 * read/write surface but pre-bundles the shape/path/text tools for
 * authoring new layers.
 */

import type { Editor } from '@tiptap/react';
import type { ReactNode } from 'react';
import type { Layer } from '@bendyline/squisq/schemas';
import { useEffect, useState } from 'react';
import type { SceneCommand, SceneEdge } from '../commands/SceneCommand';
import type { SceneTool, SceneToolContext } from '../tools/SceneTool';
import { SelectTool } from '../tools/SelectTool';
import { readLayersFromHeading, updateLayer, writeLayersToHeading } from './blockLayers';

export interface LayoutAdapterResult {
  /** Layers to pass to `<Scene layers={...} />`. */
  layers: Layer[];
  /** Tool set the host should expose. */
  tools: SceneTool[];
  /** Command dispatch for `<Scene onCommand={...} />`. */
  dispatch: (cmd: SceneCommand) => void;
  // ── Connector-capable adapters (drawing) set these; layout omits them ──
  /** Connector edges to pass to `<Scene edges={...} />`. */
  edges?: SceneEdge[];
  /** `<Scene layerFollows={...} />` — a label layer follows its shape. */
  layerFollows?: (layerId: string) => string | null;
  /** `<Scene renderExtras={...} />` — draws the connector pass behind layers. */
  renderExtras?: (ctx: SceneToolContext) => ReactNode;
}

export interface LayoutAdapterOptions {
  /** Override the tool set (defaults to `[SelectTool]`). */
  tools?: SceneTool[];
}

/**
 * Build a LayoutAdapter for the heading at `headingPos`. Subscribes to
 * the editor's transactions so the returned `layers` array reflects the
 * latest persisted state.
 */
export function useLayoutAdapter(
  editor: Editor,
  headingPos: number,
  options: LayoutAdapterOptions = {},
): LayoutAdapterResult {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  // Re-read on every transaction. The read is cheap (one node lookup +
  // a JSON parse) so we don't bother memoizing.
  const node = editor.state.doc.nodeAt(headingPos);
  const layers: Layer[] = node ? readLayersFromHeading(node) : [];

  const dispatch = (cmd: SceneCommand) => {
    switch (cmd.kind) {
      case 'moveLayer':
        updateLayer(editor, headingPos, cmd.id, (current) => {
          if (!current) return null;
          return {
            ...current,
            position: { ...current.position, x: cmd.x, y: cmd.y },
          };
        });
        return;
      case 'resizeLayer':
        updateLayer(editor, headingPos, cmd.id, (current) => {
          if (!current) return null;
          return {
            ...current,
            position: { ...current.position, width: cmd.width, height: cmd.height },
          };
        });
        return;
      case 'addLayer':
        updateLayer(editor, headingPos, cmd.layer.id, () => cmd.layer);
        return;
      case 'removeLayer':
        updateLayer(editor, headingPos, cmd.id, () => null);
        return;
      case 'setLayerAttr':
        updateLayer(editor, headingPos, cmd.id, (current) => {
          if (!current) return null;
          return setAttrAtPath(current, cmd.path, cmd.value);
        });
        return;
      case 'renameLayer':
        updateLayer(editor, headingPos, cmd.id, (current) => {
          if (!current || current.type !== 'text') return current ?? null;
          return { ...current, content: { ...current.content, text: cmd.label } };
        });
        return;
      case 'addEdge':
      case 'removeEdge':
        // Layouts don't model edges.
        return;
    }
    const _exhaustive: never = cmd;
    void _exhaustive;
  };

  return {
    layers,
    tools: options.tools ?? [SelectTool],
    dispatch,
  };
  // Read `version` so eslint sees it as a dep and the linter is happy;
  // it's already the trigger for re-execution because state changes
  // cause the hook to re-run.
  void version;
}

/** Re-export the file-level helpers for callers that need them. */
export { readLayersFromHeading, writeLayersToHeading };

/**
 * Set a value at a dotted path within a Layer object, returning a new
 * Layer with the change applied. Used by `setLayerAttr`. Conservative —
 * silently no-ops when the path doesn't resolve to a settable property.
 */
function setAttrAtPath(layer: Layer, path: string, value: unknown): Layer {
  const segments = path.split('.');
  // We can't structurally clone in TS without losing the discriminated
  // union; round-trip through JSON for a deep copy. Layer types are
  // plain data (no functions or classes) so this is safe.
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
