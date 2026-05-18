import { describe, it, expect } from 'vitest';
import type { ImageEditDoc, ImageEditLayer } from '@bendyline/squisq/schemas';
import { createEmptyImageEditDoc } from '@bendyline/squisq/imageEdit';
import {
  imageEditorReducer,
  initialImageEditorState,
  type ImageEditorState,
  type ImageEditorAction,
} from '../imageEditor/state.js';

function bootstrap(): ImageEditorState {
  const doc = createEmptyImageEditDoc(400, 300);
  // touch sets updatedAt — clear it for stable comparisons
  return initialImageEditorState(doc);
}

function dispatchAll(state: ImageEditorState, actions: ImageEditorAction[]): ImageEditorState {
  return actions.reduce((s, a) => imageEditorReducer(s, a), state);
}

describe('imageEditorReducer', () => {
  it('initial state is clean and selects no layer', () => {
    const s = bootstrap();
    expect(s.dirty).toBe(false);
    expect(s.selectedLayerId).toBe(null);
    expect(s.tool).toBe('select');
    expect(s.doc.canvas.width).toBe(400);
  });

  it('add-layer assigns an id, marks dirty, and selects by default', () => {
    const s0 = bootstrap();
    const s1 = imageEditorReducer(s0, {
      type: 'add-layer',
      layer: {
        type: 'shape',
        position: { x: 0, y: 0, width: 50, height: 50 },
        content: { shape: 'rect', fill: '#fff' },
      },
    });
    expect(s1.dirty).toBe(true);
    expect(s1.doc.layers).toHaveLength(1);
    const added = s1.doc.layers[0]!;
    expect(added.id).toMatch(/^layer-/);
    expect(s1.selectedLayerId).toBe(added.id);
  });

  it('add-layer with select:false leaves selection untouched', () => {
    const s = imageEditorReducer(bootstrap(), {
      type: 'add-layer',
      select: false,
      layer: {
        type: 'shape',
        position: { x: 0, y: 0, width: 1, height: 1 },
        content: { shape: 'rect' },
      },
    });
    expect(s.selectedLayerId).toBe(null);
  });

  it('remove-layer drops the layer and clears selection if it was selected', () => {
    const s1 = imageEditorReducer(bootstrap(), {
      type: 'add-layer',
      layer: {
        type: 'shape',
        position: { x: 0, y: 0, width: 1, height: 1 },
        content: { shape: 'rect' },
      },
    });
    const id = s1.doc.layers[0]!.id;
    const s2 = imageEditorReducer(s1, { type: 'remove-layer', layerId: id });
    expect(s2.doc.layers).toHaveLength(0);
    expect(s2.selectedLayerId).toBe(null);
  });

  it('update-layer applies a shallow patch', () => {
    const s1 = imageEditorReducer(bootstrap(), {
      type: 'add-layer',
      layer: {
        type: 'shape',
        position: { x: 10, y: 10, width: 20, height: 20 },
        content: { shape: 'rect' },
      },
    });
    const id = s1.doc.layers[0]!.id;
    const s2 = imageEditorReducer(s1, {
      type: 'update-layer',
      layerId: id,
      patch: { name: 'Box', opacity: 0.5 },
    });
    const layer = s2.doc.layers[0]!;
    expect(layer.name).toBe('Box');
    expect(layer.opacity).toBe(0.5);
    // Untouched fields are preserved.
    expect(layer.position).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('reorder-layer moves a layer to the requested index', () => {
    let s = bootstrap();
    s = dispatchAll(s, [
      { type: 'add-layer', layer: shape('a') },
      { type: 'add-layer', layer: shape('b') },
      { type: 'add-layer', layer: shape('c') },
    ]);
    const ids = s.doc.layers.map((l) => l.id);
    // Move the first layer to the top of the stack.
    const s2 = imageEditorReducer(s, { type: 'reorder-layer', layerId: ids[0]!, toIndex: 2 });
    expect(s2.doc.layers.map((l) => l.id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it('crop translates layer positions into the new origin and resizes the canvas', () => {
    let s = bootstrap();
    s = imageEditorReducer(s, {
      type: 'add-layer',
      layer: {
        type: 'shape',
        position: { x: 100, y: 80, width: 50, height: 50 },
        content: { shape: 'rect' },
      },
    });
    const s2 = imageEditorReducer(s, {
      type: 'crop',
      rect: { x: 50, y: 50, width: 200, height: 150 },
    });
    expect(s2.doc.canvas.width).toBe(200);
    expect(s2.doc.canvas.height).toBe(150);
    const layer = s2.doc.layers[0]!;
    expect(layer.position.x).toBe(50);
    expect(layer.position.y).toBe(30);
  });

  it('mark-clean clears the dirty flag without touching the doc', () => {
    let s = bootstrap();
    s = imageEditorReducer(s, { type: 'set-canvas', canvas: { width: 1, height: 1 } });
    expect(s.dirty).toBe(true);
    const docRef = s.doc;
    s = imageEditorReducer(s, { type: 'mark-clean' });
    expect(s.dirty).toBe(false);
    expect(s.doc).toBe(docRef);
  });

  it('select / set-tool do not mark the doc dirty', () => {
    const s0 = imageEditorReducer(bootstrap(), {
      type: 'add-layer',
      layer: shape('x'),
    });
    const s1 = imageEditorReducer(
      { ...s0, dirty: false },
      {
        type: 'select',
        layerId: s0.doc.layers[0]!.id,
      },
    );
    expect(s1.dirty).toBe(false);
    const s2 = imageEditorReducer(s1, { type: 'set-tool', tool: 'crop' });
    expect(s2.dirty).toBe(false);
    expect(s2.tool).toBe('crop');
  });
});

function shape(name: string): ImageEditLayer {
  return {
    id: '', // assigned by reducer
    type: 'shape',
    name,
    position: { x: 0, y: 0, width: 10, height: 10 },
    content: { shape: 'rect' },
  } as ImageEditLayer;
}

// Make the test module type-check without unused import warnings.
export type _Unused = ImageEditDoc;
