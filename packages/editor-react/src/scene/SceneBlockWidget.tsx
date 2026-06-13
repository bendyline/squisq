/**
 * SceneBlockWidget — Squisq-Scene-backed canvas mounted under a
 * heading whose `dataTemplate` is `layout` or `drawing`.
 *
 * Owns the maximize toggle and picks the right adapter for the mode.
 * Resolves the heading's position dynamically each render via
 * `headingKey`, so the widget survives attribute-only doc changes
 * without going stale when content above shifts.
 *
 * In `drawing` mode it also hosts the shape palette (gallery of shape
 * kinds) and the properties panel for the current selection — surfaced
 * from the drawing adapter + the Scene's `onSelectionChange`.
 */

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Scene } from './Scene';
import { useLayoutAdapter } from './adapters/LayoutAdapter';
import { useDrawingAdapter } from './adapters/DrawingAdapter';
import { findSceneHeadingPos } from './SceneBlockExtension';
import { shapeIdFromLayerId } from './layers/shapeLayers';
import { ShapePalette } from './ShapePalette';
import { ShapeProperties } from './ShapeProperties';
import { DiagramMaximizedOverlay } from '../diagram/DiagramMaximizedOverlay';

export type SceneBlockMode = 'layout' | 'drawing';

interface SceneBlockWidgetProps {
  editor: Editor;
  headingKey: string;
  fallbackParentPos: number;
  mode: SceneBlockMode;
  /** Host element for portal targeting (used by maximize overlay). */
  host?: HTMLElement | null;
}

// Default viewport for layout/drawing surfaces. Matches Squisq's 16:9
// preview so layouts authored here render correctly when previewed.
const SCENE_VIEWPORT = { width: 1920, height: 1080 };

export function SceneBlockWidget({
  editor,
  headingKey,
  fallbackParentPos,
  mode,
  host,
}: SceneBlockWidgetProps) {
  const [parentPos, setParentPos] = useState<number>(
    () => findSceneHeadingPos(editor, headingKey, mode) ?? fallbackParentPos,
  );
  useEffect(() => {
    const onUpdate = () => {
      const next = findSceneHeadingPos(editor, headingKey, mode);
      if (next != null && next !== parentPos) setParentPos(next);
    };
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor, headingKey, mode, parentPos]);

  const layout = useLayoutAdapter(editor, parentPos);
  const drawing = useDrawingAdapter(editor, parentPos);
  const isDrawing = mode === 'drawing';
  const adapter = isDrawing ? drawing : layout;

  const [maximized, setMaximized] = useState(false);
  const [activeToolId, setActiveToolId] = useState<string>('select');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  const selectedShapeId = isDrawing && selectedLayerId ? shapeIdFromLayerId(selectedLayerId) : null;

  const canvas = (
    <Scene
      viewport={SCENE_VIEWPORT}
      layers={adapter.layers}
      edges={adapter.edges}
      tools={adapter.tools}
      onCommand={adapter.dispatch}
      onSelectionChange={
        isDrawing ? (ids) => setSelectedLayerId(ids.values().next().value ?? null) : undefined
      }
      activeToolId={isDrawing ? activeToolId : undefined}
      onActiveToolIdChange={isDrawing ? setActiveToolId : undefined}
      layerFollows={adapter.layerFollows}
      renderExtras={adapter.renderExtras}
      showMaximize
      maximized={maximized}
      onToggleMaximize={() => setMaximized((m) => !m)}
    />
  );

  const drawingUI = isDrawing ? (
    <>
      <div className="squisq-scene-shapes">
        <button
          type="button"
          className="squisq-scene-shapes-btn"
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen((o) => !o)}
        >
          Shapes ▾
        </button>
        {paletteOpen && (
          <ShapePalette
            onPick={(kind) => {
              drawing.setPendingKind(kind);
              setActiveToolId('draw');
              setPaletteOpen(false);
            }}
            onClose={() => setPaletteOpen(false)}
          />
        )}
      </div>
      <ShapeProperties
        selectedEdge={drawing.selectedEdge}
        selectedShapeId={selectedShapeId}
        onConnectorStyle={drawing.setConnectorStyle}
        onShapeParam={drawing.setShapeParam}
      />
    </>
  ) : null;

  const body = (
    <div className="squisq-scene-stage">
      {drawingUI}
      {canvas}
    </div>
  );

  if (maximized) {
    return (
      <div className="squisq-scene-inline-placeholder">
        <DiagramMaximizedOverlay host={host ?? null} onClose={() => setMaximized(false)}>
          {body}
        </DiagramMaximizedOverlay>
      </div>
    );
  }

  return <div className="squisq-scene-inline">{body}</div>;
}
