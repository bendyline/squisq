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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { Layer } from '@bendyline/squisq/schemas';
import { Scene } from './Scene';
import { useLayoutAdapter } from './adapters/LayoutAdapter';
import { useDrawingAdapter, type ConnectorStyleInput } from './adapters/DrawingAdapter';
import type { SceneCommand, SceneEdge } from './commands/SceneCommand';
import { findSceneHeadingPos } from './SceneBlockExtension';
import { shapeIdFromLayerId } from './layers/shapeLayers';
import { ShapePalette } from './ShapePalette';
import { ScenePropsBar } from './ScenePropsBar';
import { SceneBlockToolbar, type SceneBlockAction, type SceneAlignment } from './SceneBlockToolbar';
import { SceneSideToolbar } from './SceneSideToolbar';
import type { SceneTextEditConfig } from './text/sceneTextConfig';
import { markdownToTiptap } from '../tiptapBridge';
import { Icon } from '../Icon';
import { DiagramMaximizedOverlay } from '../diagram/DiagramMaximizedOverlay';
import type { SceneTextChannel } from './text/sceneTextChannel';

export type SceneBlockMode = 'layout' | 'drawing';

interface SceneBlockWidgetProps {
  editor: Editor;
  headingKey: string;
  fallbackParentPos: number;
  mode: SceneBlockMode;
  /** Host element for portal targeting (used by maximize overlay). */
  host?: HTMLElement | null;
  textChannel?: SceneTextChannel;
}

// Default viewport for layout/drawing surfaces. Matches Squisq's 16:9
// preview so layouts authored here render correctly when previewed.
const SCENE_VIEWPORT = { width: 1920, height: 1080 };

// Connector style vocabularies for the inline properties (drawing edges).
const MARKERS = ['none', 'arrow', 'open', 'diamond', 'circle', 'square'];
const ROUTINGS = ['straight', 'orthogonal', 'curved'];
const LINE_STYLES = ['solid', 'dashed', 'dotted'];
const lineStyleOf = (dasharray: string | undefined): string =>
  dasharray === '8 6' ? 'dashed' : dasharray === '2 6' ? 'dotted' : 'solid';

export function SceneBlockWidget({
  editor,
  headingKey,
  fallbackParentPos,
  mode,
  host,
  textChannel,
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

  // Inline text editing config. Refs keep `getHtml`/`commit` reading the
  // live layers/dispatch while the config object stays stable (so the
  // open editor isn't re-seeded mid-edit). Layout stores rich HTML; drawing
  // stores inline markdown in the shape's heading text.
  const layersRef = useRef(adapter.layers);
  layersRef.current = adapter.layers;
  const dispatchRef = useRef(adapter.dispatch);
  dispatchRef.current = adapter.dispatch;
  const textConfig = useMemo<SceneTextEditConfig>(
    () => ({
      channel: textChannel,
      resolveEditableId: (id) => {
        const l = layersRef.current.find((x) => x.id === id);
        return l && l.type === 'text' ? id : null;
      },
      getHtml: (id) => {
        const l = layersRef.current.find((x) => x.id === id);
        if (!l || l.type !== 'text') return '';
        if (!isDrawing && l.content.html?.trim()) return l.content.html;
        return markdownToTiptap(l.content.text ?? '');
      },
      commit: (id, { html, text }) => {
        if (isDrawing) {
          // Drawing labels persist as plain heading text for now (rich
          // marks on shape labels are a follow-up — the rendering
          // foundation is in place via `content.html`). Store plain text so
          // nothing leaks literal markdown into the label.
          dispatchRef.current({ kind: 'renameLayer', id, label: text });
        } else {
          dispatchRef.current({ kind: 'setLayerText', id, text, html });
        }
      },
      // Layout textboxes use `block` (marks + lists, no headings) because their
      // content is stored as the child sub-block's markdown body.
      level: isDrawing ? 'inline' : 'block',
    }),
    [isDrawing, textChannel],
  );

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
      onSelectionChange={(ids) => setSelectedLayerId(ids.values().next().value ?? null)}
      activeToolId={activeToolId}
      onActiveToolIdChange={setActiveToolId}
      layerFollows={adapter.layerFollows}
      renderExtras={adapter.renderExtras}
      showMaximize
      maximized={maximized}
      onToggleMaximize={() => setMaximized((m) => !m)}
      showToolbar={false}
      textEditing={textConfig}
    />
  );

  // ── Shared toolbar (above the canvas) ──────────────────
  // Drawing creates shapes via its mode tools (Shape/Pen/Text/Connect);
  // layout has only Select, so it gets explicit Add buttons. Both share
  // a Delete action keyed off the current selection.
  const canDelete = isDrawing ? !!selectedLayerId || !!drawing.selectedEdgeId : !!selectedLayerId;
  const deleteSelected = () => {
    if (selectedLayerId) {
      adapter.dispatch({ kind: 'removeLayer', id: selectedLayerId });
      setSelectedLayerId(null);
      return;
    }
    if (isDrawing && drawing.selectedEdge) {
      adapter.dispatch({
        kind: 'removeEdge',
        source: drawing.selectedEdge.source,
        target: drawing.selectedEdge.target,
      });
    }
  };
  const freshLayerId = (prefix: string) => {
    const used = new Set(adapter.layers.map((l) => l.id));
    let i = 1;
    while (used.has(`${prefix}-${i}`)) i++;
    return `${prefix}-${i}`;
  };
  const addLayoutLayer = (layer: Layer) => adapter.dispatch({ kind: 'addLayer', layer });

  const deleteAction: SceneBlockAction = {
    id: 'delete',
    label: 'Delete',
    icon: <Icon icon="fa-solid fa-trash" />,
    title: 'Delete selected',
    danger: true,
    disabled: !canDelete,
    onClick: deleteSelected,
  };
  const actions: SceneBlockAction[] = isDrawing
    ? [deleteAction]
    : [
        {
          id: 'add-text',
          label: 'Text',
          icon: <Icon icon="fa-solid fa-font" />,
          title: 'Add text',
          onClick: () =>
            addLayoutLayer({
              type: 'text',
              id: freshLayerId('text'),
              content: {
                text: 'Text',
                style: {
                  fontSize: 48,
                  color: '#1e293b',
                  textAlign: 'center',
                  verticalAlign: 'middle',
                },
              },
              position: { x: 660, y: 440, width: 600, height: 200 },
            }),
        },
        {
          id: 'add-box',
          label: 'Box',
          icon: <Icon icon="fa-solid fa-square" />,
          title: 'Add box',
          onClick: () =>
            addLayoutLayer({
              type: 'shape',
              id: freshLayerId('box'),
              content: {
                shape: 'rect',
                fill: '#e0e7ff',
                stroke: '#6366f1',
                strokeWidth: 2,
                borderRadius: 8,
              },
              position: { x: 760, y: 390, width: 400, height: 300 },
            }),
        },
        deleteAction,
      ];

  // Text-alignment controls — shown when a layout textbox is selected. They
  // set the layer's whole-box `style.textAlign` / `style.verticalAlign`
  // (the LayoutAdapter persists arbitrary `content.*` paths; drawing/diagram
  // labels don't yet, so this is layout-only for now).
  const selectedLayer = selectedLayerId
    ? adapter.layers.find((l) => l.id === selectedLayerId)
    : undefined;
  const alignment: SceneAlignment | undefined =
    mode === 'layout' && selectedLayer?.type === 'text'
      ? {
          textAlign: selectedLayer.content.style.textAlign ?? 'left',
          verticalAlign: selectedLayer.content.style.verticalAlign ?? 'top',
          onTextAlign: (v) =>
            adapter.dispatch({
              kind: 'setLayerAttr',
              id: selectedLayer.id,
              path: 'content.style.textAlign',
              value: v,
            }),
          onVerticalAlign: (v) =>
            adapter.dispatch({
              kind: 'setLayerAttr',
              id: selectedLayer.id,
              path: 'content.style.verticalAlign',
              value: v,
            }),
        }
      : undefined;

  // Per-selection style controls, rendered inline in the contextual toolbar
  // (Fill/Stroke for shapes & boxes, Color for text, marker/line/routing for
  // a drawing connector). Replaces the old floating properties panel.
  const propsBar = buildPropsBar({
    isDrawing,
    selectedLayer,
    selectedShapeId,
    selectedEdge: isDrawing ? drawing.selectedEdge : null,
    setShapeParam: drawing.setShapeParam,
    setConnectorStyle: drawing.setConnectorStyle,
    dispatch: adapter.dispatch,
  });

  const toolbar = (
    <SceneBlockToolbar
      tools={adapter.tools}
      activeToolId={activeToolId}
      // Clicking the Shape tool opens its palette (dropping down from the
      // button); other tools just activate.
      onSelectTool={(id) => {
        setActiveToolId(id);
        if (id === 'draw') setPaletteOpen(true);
      }}
      actions={actions}
      alignment={alignment}
      properties={propsBar}
      toolPopover={
        isDrawing && paletteOpen
          ? {
              toolId: 'draw',
              content: (
                <ShapePalette
                  onPick={(kind) => {
                    drawing.setPendingKind(kind);
                    setActiveToolId('draw');
                    setPaletteOpen(false);
                  }}
                  onClose={() => setPaletteOpen(false)}
                />
              ),
            }
          : undefined
      }
    />
  );

  const body = <div className="squisq-scene-stage">{canvas}</div>;

  if (maximized) {
    return (
      <div className="squisq-scene-inline-placeholder">
        <DiagramMaximizedOverlay host={host ?? null} onClose={() => setMaximized(false)}>
          {/* Maximized has a full screen for a static right column — no collapse. */}
          <div className="squisq-scene-block-max">
            {body}
            <div className="squisq-scene-side-toolbar">{toolbar}</div>
          </div>
        </DiagramMaximizedOverlay>
      </div>
    );
  }

  return (
    <div className="squisq-scene-shell">
      {/* Before the canvas so the narrow-width fallback bar sits above it; the
        wide-width gutter column is absolute and unaffected by DOM order. */}
      <SceneSideToolbar>{toolbar}</SceneSideToolbar>
      <div className="squisq-scene-inline">{body}</div>
    </div>
  );
}

/**
 * Build the inline per-selection style controls for the contextual toolbar.
 * - A drawing connector → marker / line / routing dropdowns.
 * - A text layer → a single Color swatch (drawing text color is the shape's
 *   `stroke`; layout text color is `content.style.color`).
 * - A shape / box / path → Fill + Stroke swatches.
 * Returns null when the selection has nothing styleable.
 */
function buildPropsBar(args: {
  isDrawing: boolean;
  selectedLayer: Layer | undefined;
  selectedShapeId: string | null;
  selectedEdge: SceneEdge | null;
  setShapeParam: (id: string, key: string, value: string) => void;
  setConnectorStyle: (id: string, style: ConnectorStyleInput) => void;
  dispatch: (cmd: SceneCommand) => void;
}): ReactNode {
  const {
    isDrawing,
    selectedLayer,
    selectedShapeId,
    selectedEdge,
    setShapeParam,
    setConnectorStyle,
    dispatch,
  } = args;

  if (isDrawing && selectedEdge) {
    const e = selectedEdge;
    const set = (style: ConnectorStyleInput) => setConnectorStyle(e.id, style);
    return (
      <ScenePropsBar
        selects={[
          {
            label: 'End',
            value: e.endMarker ?? 'arrow',
            options: MARKERS,
            onChange: (v) => set({ endStyle: v }),
          },
          {
            label: 'Start',
            value: e.startMarker ?? 'none',
            options: MARKERS,
            onChange: (v) => set({ startStyle: v }),
          },
          {
            label: 'Line',
            value: lineStyleOf(e.dasharray),
            options: LINE_STYLES,
            onChange: (v) => set({ lineStyle: v }),
          },
          {
            label: 'Routing',
            value: e.routing ?? 'straight',
            options: ROUTINGS,
            onChange: (v) => set({ routing: v }),
          },
        ]}
      />
    );
  }

  if (!selectedLayer) return null;

  // Drawing maps a shape's params via its heading id; layout writes layer
  // attribute paths through the adapter's dispatch.
  const setColor = (param: string, path: string) => (v: string) => {
    if (isDrawing && selectedShapeId) setShapeParam(selectedShapeId, param, v);
    else dispatch({ kind: 'setLayerAttr', id: selectedLayer.id, path, value: v });
  };

  if (selectedLayer.type === 'text') {
    // Drawing stores a text shape's color in its `stroke` param.
    return (
      <ScenePropsBar
        colors={[
          {
            label: 'Color',
            value: selectedLayer.content.style.color,
            onChange: setColor('stroke', 'content.style.color'),
          },
        ]}
      />
    );
  }

  if (selectedLayer.type === 'shape' || selectedLayer.type === 'path') {
    return (
      <ScenePropsBar
        colors={[
          {
            label: 'Fill',
            value: selectedLayer.content.fill,
            allowNone: true,
            onChange: setColor('fill', 'content.fill'),
          },
          {
            label: 'Stroke',
            value: selectedLayer.content.stroke,
            onChange: setColor('stroke', 'content.stroke'),
          },
        ]}
      />
    );
  }

  return null;
}
