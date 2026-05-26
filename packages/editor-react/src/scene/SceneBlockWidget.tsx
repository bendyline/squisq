/**
 * SceneBlockWidget — Squisq-Scene-backed canvas mounted under a
 * heading whose `dataTemplate` is `layout` or `drawing`.
 *
 * Owns the maximize toggle and picks the right adapter for the mode.
 * Resolves the heading's position dynamically each render via
 * `headingKey`, so the widget survives attribute-only doc changes
 * without going stale when content above shifts.
 */

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Scene } from './Scene';
import { useLayoutAdapter } from './adapters/LayoutAdapter';
import { useDrawingAdapter } from './adapters/DrawingAdapter';
import { findSceneHeadingPos } from './SceneBlockExtension';
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
  const adapter = mode === 'drawing' ? drawing : layout;
  const [maximized, setMaximized] = useState(false);

  const canvas = (
    <Scene
      viewport={SCENE_VIEWPORT}
      layers={adapter.layers}
      tools={adapter.tools}
      onCommand={adapter.dispatch}
      showMaximize
      maximized={maximized}
      onToggleMaximize={() => setMaximized((m) => !m)}
    />
  );

  if (maximized) {
    return (
      <div className="squisq-scene-inline-placeholder">
        <DiagramMaximizedOverlay host={host ?? null} onClose={() => setMaximized(false)}>
          {canvas}
        </DiagramMaximizedOverlay>
      </div>
    );
  }

  return <div className="squisq-scene-inline">{canvas}</div>;
}
