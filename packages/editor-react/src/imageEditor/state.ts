/**
 * Pure state + reducer for the `<ImageEditor>` component.
 *
 * Kept React-free so it's easy to unit-test in isolation. The actual
 * React hook that wires this to a {@link ContentContainer} (and the
 * version manager) lives in `useImageEditor.ts`.
 */

import type { ImageEditDoc, ImageEditLayer } from '@bendyline/squisq/schemas';
import {
  addLayer,
  removeLayer,
  reorderLayer,
  setCanvas,
  updateLayer,
  touch,
} from '@bendyline/squisq/imageEdit';

/**
 * Layer payload accepted by the `add-layer` action — the `id` field is
 * optional and will be assigned by the underlying `addLayer` helper if
 * the caller doesn't supply one.
 */
export type ImageEditLayerInput = ImageEditLayer | (Omit<ImageEditLayer, 'id'> & { id?: string });

/** The currently active interaction tool. */
export type ImageEditorTool = 'select' | 'text' | 'shape' | 'image' | 'crop';

/** A pixel-space rectangle in canvas coordinates. */
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEditorState {
  /** The persisted document. */
  doc: ImageEditDoc;
  /** Selected layer id, or `null` when nothing is selected. */
  selectedLayerId: string | null;
  /** Active tool. */
  tool: ImageEditorTool;
  /**
   * Dirty flag — true when the in-memory doc has unsaved changes
   * relative to the last `markClean()` call. The hook uses this to
   * debounce writes back to `state.json`.
   */
  dirty: boolean;
}

export type ImageEditorAction =
  | { type: 'load'; doc: ImageEditDoc }
  | { type: 'mark-clean' }
  | { type: 'set-tool'; tool: ImageEditorTool }
  | { type: 'select'; layerId: string | null }
  | { type: 'set-canvas'; canvas: ImageEditDoc['canvas'] }
  | { type: 'add-layer'; layer: ImageEditLayerInput; select?: boolean }
  | { type: 'remove-layer'; layerId: string }
  | { type: 'update-layer'; layerId: string; patch: Partial<ImageEditLayer> }
  | { type: 'reorder-layer'; layerId: string; toIndex: number }
  | { type: 'crop'; rect: CanvasRect };

/** Build the initial state from a freshly-loaded doc. */
export function initialImageEditorState(doc: ImageEditDoc): ImageEditorState {
  return {
    doc,
    selectedLayerId: null,
    tool: 'select',
    dirty: false,
  };
}

export function imageEditorReducer(
  state: ImageEditorState,
  action: ImageEditorAction,
): ImageEditorState {
  switch (action.type) {
    case 'load':
      return { doc: action.doc, selectedLayerId: null, tool: 'select', dirty: false };

    case 'mark-clean':
      return state.dirty ? { ...state, dirty: false } : state;

    case 'set-tool':
      return state.tool === action.tool ? state : { ...state, tool: action.tool };

    case 'select':
      return state.selectedLayerId === action.layerId
        ? state
        : { ...state, selectedLayerId: action.layerId };

    case 'set-canvas': {
      const next = setCanvas(state.doc, action.canvas);
      return next === state.doc ? state : { ...state, doc: next, dirty: true };
    }

    case 'add-layer': {
      // `addLayer` from core assigns an id when missing; cast through
      // `ImageEditLayer` for the existing helper signature.
      const next = addLayer(state.doc, action.layer as ImageEditLayer);
      // Pick up the assigned id (last layer)
      const newId = next.layers[next.layers.length - 1]!.id;
      return {
        ...state,
        doc: next,
        dirty: true,
        selectedLayerId: action.select === false ? state.selectedLayerId : newId,
      };
    }

    case 'remove-layer': {
      const next = removeLayer(state.doc, action.layerId);
      if (next === state.doc) return state;
      return {
        ...state,
        doc: next,
        dirty: true,
        selectedLayerId: state.selectedLayerId === action.layerId ? null : state.selectedLayerId,
      };
    }

    case 'update-layer': {
      const next = updateLayer(state.doc, action.layerId, action.patch);
      return next === state.doc ? state : { ...state, doc: next, dirty: true };
    }

    case 'reorder-layer': {
      const next = reorderLayer(state.doc, action.layerId, action.toIndex);
      return next === state.doc ? state : { ...state, doc: next, dirty: true };
    }

    case 'crop': {
      const { rect } = action;
      const newCanvas = {
        ...state.doc.canvas,
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      // Translate every layer by (-rect.x, -rect.y). Only handles numeric
      // positions; percentage strings are left alone (rare for image-edit
      // layers, which the editor produces with numeric coords).
      const translated: ImageEditLayer[] = state.doc.layers.map((layer) => {
        const { position } = layer;
        const x = typeof position.x === 'number' ? position.x - rect.x : position.x;
        const y = typeof position.y === 'number' ? position.y - rect.y : position.y;
        return { ...layer, position: { ...position, x, y } } as ImageEditLayer;
      });
      const next = touch({ ...state.doc, canvas: newCanvas, layers: translated });
      return { ...state, doc: next, dirty: true };
    }
  }
}
