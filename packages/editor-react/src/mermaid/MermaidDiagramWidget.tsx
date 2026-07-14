/** Shared diagram chrome around a lossless Mermaid source/render loop. */

import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Icon } from '../Icon';
import { DiagramMaximizedOverlay } from '../diagram/DiagramMaximizedOverlay';
import { SceneBlockToolbar, type SceneBlockAction } from '../scene/SceneBlockToolbar';
import { SceneSideToolbar } from '../scene/SceneSideToolbar';
import { isMermaidSourceVisible, toggleMermaidSource } from './MermaidDiagramExtension';
import { MermaidDiagramCanvas } from './MermaidDiagramCanvas';
import { useMermaidDiagramData } from './mermaidData';

const MIN_DIAGRAM_HEIGHT = 160;
const DEFAULT_DIAGRAM_HEIGHT = 420;

export interface MermaidDiagramWidgetProps {
  editor: Editor;
  blockId: string;
  host?: HTMLElement | null;
}

export function MermaidDiagramWidget({ editor, blockId, host }: MermaidDiagramWidgetProps) {
  const data = useMermaidDiagramData(editor, blockId);
  const [maximized, setMaximized] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const effectiveHeight = dragHeight ?? height;

  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const startY = event.clientY;
      const startHeight =
        inlineRef.current?.getBoundingClientRect().height ??
        effectiveHeight ??
        DEFAULT_DIAGRAM_HEIGHT;
      const heightAt = (clientY: number) =>
        Math.max(MIN_DIAGRAM_HEIGHT, Math.round(startHeight + clientY - startY));
      const previousCursor = document.body.style.cursor;
      const previousSelect = document.body.style.userSelect;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      const onMove = (moveEvent: PointerEvent) => setDragHeight(heightAt(moveEvent.clientY));
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelect;
        setDragHeight(null);
        setHeight(heightAt(upEvent.clientY));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [effectiveHeight],
  );

  if (!data) return null;
  const sourceVisible = isMermaidSourceVisible(editor, blockId);
  const actions: SceneBlockAction[] = [
    {
      id: 'mermaid-source',
      label: 'Source',
      icon: <Icon icon="fa-solid fa-code" />,
      title: sourceVisible ? 'Hide Mermaid source' : 'Edit Mermaid source',
      onClick: () => toggleMermaidSource(editor, blockId),
    },
  ];
  const toolbar = <SceneBlockToolbar actions={actions} />;
  const canvas = (
    <MermaidDiagramCanvas
      source={data.source}
      maximized={maximized}
      onToggleMaximize={() => setMaximized((value) => !value)}
    />
  );

  if (maximized) {
    return (
      <div
        className="squisq-diagram-inline-placeholder"
        style={effectiveHeight != null ? { height: effectiveHeight } : undefined}
      >
        <DiagramMaximizedOverlay host={host ?? null} onClose={() => setMaximized(false)}>
          <div className="squisq-scene-block-max">
            {canvas}
            <div className="squisq-scene-side-toolbar">{toolbar}</div>
          </div>
        </DiagramMaximizedOverlay>
      </div>
    );
  }

  return (
    <div className="squisq-scene-shell squisq-mermaid-shell">
      <SceneSideToolbar>{toolbar}</SceneSideToolbar>
      <div
        className="squisq-diagram-inline"
        ref={inlineRef}
        style={effectiveHeight != null ? { height: effectiveHeight } : undefined}
      >
        {canvas}
        <div
          className="squisq-diagram-resize-handle"
          onPointerDown={onResizeStart}
          onDoubleClick={() => {
            setDragHeight(null);
            setHeight(null);
          }}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize diagram height"
          title="Drag to resize · double-click to reset"
        />
      </div>
    </div>
  );
}

export default MermaidDiagramWidget;
