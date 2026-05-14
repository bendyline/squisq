/**
 * LayersPanel — list of layers with visibility / lock / reorder / delete
 * controls. Newest layer is rendered last (top of the SVG stack), so the
 * panel shows the array reversed so "top" appears at the top of the list.
 */

import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import type { ImageEditorAction } from './state.js';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  UnlockIcon,
} from './icons.js';

export interface LayersPanelProps {
  doc: ImageEditDoc;
  selectedLayerId: string | null;
  dispatch: (action: ImageEditorAction) => void;
}

export function LayersPanel({ doc, selectedLayerId, dispatch }: LayersPanelProps) {
  // Visual order: top of stack first.
  const ordered = doc.layers.slice().reverse();

  return (
    <div className="squisq-image-editor-layers" data-testid="image-editor-layers">
      <div className="squisq-image-editor-panel-header">Layers</div>
      <ul className="squisq-image-editor-layer-list">
        {ordered.length === 0 && <li className="squisq-image-editor-layer-empty">No layers yet</li>}
        {ordered.map((layer) => {
          const visible = layer.visible !== false;
          const locked = !!layer.locked;
          const stackIndex = doc.layers.findIndex((l) => l.id === layer.id);
          const canMoveUp = stackIndex < doc.layers.length - 1;
          const canMoveDown = stackIndex > 0;
          const isSelected = selectedLayerId === layer.id;

          return (
            <li
              key={layer.id}
              className={[
                'squisq-image-editor-layer-item',
                isSelected ? 'is-selected' : '',
                visible ? '' : 'is-hidden',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                type="button"
                className="squisq-image-editor-layer-toggle"
                onClick={() =>
                  dispatch({
                    type: 'update-layer',
                    layerId: layer.id,
                    patch: { visible: !visible },
                  })
                }
                aria-label={visible ? 'Hide layer' : 'Show layer'}
                title={visible ? 'Hide layer' : 'Show layer'}
              >
                {visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <button
                type="button"
                className="squisq-image-editor-layer-toggle"
                onClick={() =>
                  dispatch({
                    type: 'update-layer',
                    layerId: layer.id,
                    patch: { locked: !locked },
                  })
                }
                aria-label={locked ? 'Unlock layer' : 'Lock layer'}
                title={locked ? 'Unlock layer' : 'Lock layer'}
              >
                {locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <button
                type="button"
                className="squisq-image-editor-layer-name"
                onClick={() => dispatch({ type: 'select', layerId: layer.id })}
              >
                {layer.name ?? defaultLayerName(layer)}
                <span className="squisq-image-editor-layer-kind">{layer.type}</span>
              </button>
              <button
                type="button"
                className="squisq-image-editor-layer-toggle"
                disabled={!canMoveUp}
                onClick={() =>
                  dispatch({ type: 'reorder-layer', layerId: layer.id, toIndex: stackIndex + 1 })
                }
                aria-label="Move layer up"
                title="Move layer up"
              >
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                className="squisq-image-editor-layer-toggle"
                disabled={!canMoveDown}
                onClick={() =>
                  dispatch({ type: 'reorder-layer', layerId: layer.id, toIndex: stackIndex - 1 })
                }
                aria-label="Move layer down"
                title="Move layer down"
              >
                <ChevronDownIcon />
              </button>
              <button
                type="button"
                className="squisq-image-editor-layer-toggle"
                onClick={() => dispatch({ type: 'remove-layer', layerId: layer.id })}
                aria-label="Delete layer"
                title="Delete layer"
              >
                <CloseIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function defaultLayerName(layer: { type: string; content?: unknown }): string {
  if (layer.type === 'text') {
    const c = layer.content as { text?: string } | undefined;
    return c?.text?.split('\n')[0]?.slice(0, 24) || 'Text';
  }
  if (layer.type === 'image') return 'Image';
  if (layer.type === 'shape') {
    const c = layer.content as { shape?: string } | undefined;
    return c?.shape ? c.shape[0]!.toUpperCase() + c.shape.slice(1) : 'Shape';
  }
  return layer.type;
}
