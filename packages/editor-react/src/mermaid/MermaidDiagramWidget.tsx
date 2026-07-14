/** Shared diagram chrome around a lossless Mermaid source/render/edit loop. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Editor } from '@tiptap/react';
import { Icon } from '../Icon';
import { DiagramMaximizedOverlay } from '../diagram/DiagramMaximizedOverlay';
import { SceneBlockToolbar, type SceneBlockAction } from '../scene/SceneBlockToolbar';
import { SceneSideToolbar } from '../scene/SceneSideToolbar';
import { isMermaidSourceVisible, toggleMermaidSource } from './MermaidDiagramExtension';
import { MermaidDiagramCanvas, type MermaidNodeCanvasAction } from './MermaidDiagramCanvas';
import { MermaidShapePalette } from './MermaidShapePalette';
import { applyMermaidSourceEdit } from './mermaidCommands';
import { useMermaidDiagramData } from './mermaidData';
import type {
  MermaidEditableEdge,
  MermaidEditableModel,
  MermaidEditableNode,
  MermaidFlowchartDirection,
} from './mermaidModel';
import {
  addMermaidNode,
  changeMermaidNodeShape,
  connectMermaidNodes,
  deleteMermaidNode,
  disconnectMermaidEdge,
  duplicateMermaidNode,
  renameMermaidNode,
  setMermaidEdgeLabel,
  setMermaidFlowchartDirection,
  type MermaidSourceEditResult,
} from './mermaidSourceOps';
import type { MermaidFlowchartShapeId } from './mermaidShapes';

const MIN_DIAGRAM_HEIGHT = 160;
const DEFAULT_DIAGRAM_HEIGHT = 420;
const DIRECTION_PICKER_WIDTH = 344;
const DIRECTION_PICKER_MAX_HEIGHT = 360;
const DIRECTION_PICKER_GAP = 6;
const VIEWPORT_GUTTER = 8;

interface DirectionPickerPosition extends CSSProperties {
  position: 'fixed';
  top: number;
  left: number;
  right: 'auto';
  width: number;
  maxHeight: number;
}

export interface MermaidDiagramWidgetProps {
  editor: Editor;
  blockId: string;
  host?: HTMLElement | null;
}

export function MermaidDiagramWidget({ editor, blockId, host }: MermaidDiagramWidgetProps) {
  const data = useMermaidDiagramData(editor, blockId);
  const [model, setModel] = useState<MermaidEditableModel | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renamingEdgeId, setRenamingEdgeId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [openPopover, setOpenPopover] = useState<'shape' | 'direction' | null>(null);
  const [editNotice, setEditNotice] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const effectiveHeight = dragHeight ?? height;

  const onModelChange = useCallback((next: MermaidEditableModel | null) => {
    setModel(next);
    setSelectedNodeId((id) => (id && next?.nodes.some((node) => node.id === id) ? id : null));
    setSelectedEdgeId((id) => (id && next?.edges.some((edge) => edge.id === id) ? id : null));
    setRenamingNodeId((id) => (id && next?.nodes.some((node) => node.id === id) ? id : null));
    setRenamingEdgeId((id) => (id && next?.edges.some((edge) => edge.id === id) ? id : null));
    setConnectSourceId((id) => (id && next?.nodes.some((node) => node.id === id) ? id : null));
  }, []);

  const applyEdit = useCallback(
    (edit: MermaidSourceEditResult): boolean => {
      if (!edit.ok) {
        setEditNotice(edit.reason ?? 'This Mermaid statement can only be changed in Source.');
        return false;
      }
      const applied = applyMermaidSourceEdit(editor, blockId, edit);
      setEditNotice(applied ? '' : 'The Mermaid code block changed before this edit was applied.');
      return applied;
    },
    [blockId, editor],
  );

  const flowchart = model?.kind === 'flowchart' ? model : null;
  const selectedNode = flowchart?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = flowchart?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const beginRename = useCallback((node: MermaidEditableNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setRenamingEdgeId(null);
    setOpenPopover(null);
    setRenamingNodeId(node.id);
  }, []);

  const beginRenameEdge = useCallback((edge: MermaidEditableEdge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
    setRenamingNodeId(null);
    setOpenPopover(null);
    setRenamingEdgeId(edge.id);
  }, []);

  const commitRename = useCallback(
    (nodeId: string, label: string): boolean => {
      const node = flowchart?.nodes.find((candidate) => candidate.id === nodeId);
      if (!data || !node) return false;
      if (label.trim() === node.label) {
        setRenamingNodeId(null);
        return true;
      }
      const applied = applyEdit(renameMermaidNode(data.source, node, label));
      if (applied) setRenamingNodeId(null);
      return applied;
    },
    [applyEdit, data, flowchart],
  );

  const commitEdgeLabel = useCallback(
    (edgeId: string, label: string): boolean => {
      const edge = flowchart?.edges.find((candidate) => candidate.id === edgeId);
      if (!data || !flowchart || !edge) return false;
      if (label.trim() === edge.label.trim()) {
        setRenamingEdgeId(null);
        return true;
      }
      const applied = applyEdit(setMermaidEdgeLabel(data.source, flowchart, edge, label));
      if (applied) setRenamingEdgeId(null);
      return applied;
    },
    [applyEdit, data, flowchart],
  );

  const beginConnect = useCallback((nodeId?: string) => {
    setConnecting(true);
    setConnectSourceId(nodeId ?? null);
    setSelectedEdgeId(null);
    setRenamingEdgeId(null);
    if (nodeId) setSelectedNodeId(nodeId);
    setEditNotice('');
  }, []);

  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      if (!connecting || !nodeId || !flowchart || !data) {
        setSelectedNodeId(nodeId);
        setRenamingNodeId((current) => (current === nodeId ? current : null));
        if (nodeId) setRenamingEdgeId(null);
        return;
      }
      if (!connectSourceId) {
        setConnectSourceId(nodeId);
        setSelectedNodeId(nodeId);
        return;
      }
      const applied = applyEdit(
        connectMermaidNodes(data.source, flowchart, connectSourceId, nodeId),
      );
      if (applied) {
        setConnecting(false);
        setConnectSourceId(null);
        setSelectedNodeId(nodeId);
      }
    },
    [applyEdit, connectSourceId, connecting, data, flowchart],
  );

  const handleNodeAction = useCallback(
    (action: MermaidNodeCanvasAction, nodeId: string) => {
      if (!flowchart || !data) return;
      const node = flowchart.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setRenamingEdgeId(null);
      switch (action) {
        case 'rename':
          beginRename(node);
          break;
        case 'shape':
          setOpenPopover('shape');
          break;
        case 'duplicate': {
          const result = duplicateMermaidNode(data.source, flowchart, node);
          if (applyEdit(result) && result.nodeId) setSelectedNodeId(result.nodeId);
          break;
        }
        case 'connect':
          beginConnect(nodeId);
          break;
        case 'delete':
          if (applyEdit(deleteMermaidNode(data.source, flowchart, nodeId))) {
            setSelectedNodeId(null);
            setConnectSourceId(null);
          }
          break;
      }
    },
    [applyEdit, beginConnect, beginRename, data, flowchart],
  );

  const handleDisconnect = useCallback(
    (edgeId: string) => {
      if (!flowchart || !data) return;
      const edge = flowchart.edges.find((candidate) => candidate.id === edgeId);
      if (!edge) return;
      if (applyEdit(disconnectMermaidEdge(data.source, flowchart, edge))) {
        setSelectedEdgeId(null);
        setRenamingEdgeId(null);
      }
    },
    [applyEdit, data, flowchart],
  );

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

  useEffect(() => {
    if (!editNotice) return;
    const timeout = window.setTimeout(() => setEditNotice(''), 7000);
    return () => window.clearTimeout(timeout);
  }, [editNotice]);

  if (!data) return null;
  const sourceVisible = isMermaidSourceVisible(editor, blockId);
  const structured = flowchart !== null;

  const actions: SceneBlockAction[] = [
    {
      id: 'add-node',
      label: 'Node',
      icon: <Icon icon="fa-solid fa-plus" />,
      title: structured ? 'Add Mermaid node' : 'Structured actions require a flowchart',
      disabled: !structured,
      onClick: () => {
        if (!flowchart) return;
        const result = addMermaidNode(data.source, flowchart);
        if (applyEdit(result) && result.nodeId) setSelectedNodeId(result.nodeId);
      },
    },
    {
      id: 'connect',
      label: 'Connect',
      icon: <Icon icon="fa-solid fa-link" />,
      title: connecting ? 'Cancel connection' : 'Connect two Mermaid nodes',
      disabled: !structured,
      active: connecting,
      onClick: () => {
        if (connecting) {
          setConnecting(false);
          setConnectSourceId(null);
        } else beginConnect(selectedNode?.id);
      },
    },
    {
      id: 'rename-label',
      label: selectedEdge ? 'Label' : 'Rename',
      icon: <Icon icon="fa-solid fa-pen" />,
      title: selectedEdge ? 'Edit connection label' : 'Rename Mermaid node',
      disabled: !selectedNode && !selectedEdge,
      active: renamingNodeId === selectedNode?.id || renamingEdgeId === selectedEdge?.id,
      onClick: () => {
        if (selectedNode) beginRename(selectedNode);
        else if (selectedEdge) beginRenameEdge(selectedEdge);
      },
    },
    {
      id: 'node-shape',
      label: 'Shape',
      icon: <Icon icon="fa-solid fa-shapes" />,
      disabled: !selectedNode,
      active: openPopover === 'shape',
      onClick: () => setOpenPopover((value) => (value === 'shape' ? null : 'shape')),
      popover:
        openPopover === 'shape' && selectedNode ? (
          <MermaidShapePalette
            selected={selectedNode.shape}
            onClose={() => setOpenPopover(null)}
            onPick={(shape: MermaidFlowchartShapeId) => {
              applyEdit(changeMermaidNodeShape(data.source, selectedNode, shape));
              setOpenPopover(null);
            }}
          />
        ) : undefined,
    },
    {
      id: 'duplicate-node',
      label: 'Duplicate',
      icon: <Icon icon="fa-solid fa-copy" />,
      disabled: !selectedNode,
      onClick: () => selectedNode && handleNodeAction('duplicate', selectedNode.id),
    },
    {
      id: 'disconnect-edge',
      label: 'Disconnect',
      icon: <Icon icon="fa-solid fa-link-slash" />,
      disabled: !selectedEdge,
      onClick: () => selectedEdge && handleDisconnect(selectedEdge.id),
    },
    {
      id: 'delete-node',
      label: 'Delete',
      icon: <Icon icon="fa-solid fa-trash" />,
      danger: true,
      disabled: !selectedNode,
      onClick: () => selectedNode && handleNodeAction('delete', selectedNode.id),
    },
    {
      id: 'direction',
      label: 'Direction',
      icon: <Icon icon="fa-solid fa-arrows-up-down-left-right" />,
      disabled: !structured,
      active: openPopover === 'direction',
      onClick: () => setOpenPopover((value) => (value === 'direction' ? null : 'direction')),
      popover:
        openPopover === 'direction' && flowchart ? (
          <MermaidDirectionPicker
            selected={flowchart.direction}
            onClose={() => setOpenPopover(null)}
            onPick={(direction) => {
              applyEdit(setMermaidFlowchartDirection(data.source, direction));
              setOpenPopover(null);
            }}
          />
        ) : undefined,
    },
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
      selectedNodeId={selectedNodeId}
      selectedEdgeId={selectedEdgeId}
      renamingNodeId={renamingNodeId}
      renamingEdgeId={renamingEdgeId}
      connecting={connecting}
      connectSourceId={connectSourceId}
      onModelChange={onModelChange}
      onSelectNode={handleSelectNode}
      onSelectEdge={(id) => {
        setSelectedEdgeId(id);
        if (id) {
          setSelectedNodeId(null);
          setRenamingNodeId(null);
          setRenamingEdgeId((current) => (current === id ? current : null));
        } else {
          setRenamingEdgeId(null);
        }
      }}
      onNodeAction={handleNodeAction}
      onEditEdgeLabel={(id) => {
        const edge = flowchart?.edges.find((candidate) => candidate.id === id);
        if (edge) beginRenameEdge(edge);
      }}
      onCommitRename={commitRename}
      onCommitEdgeLabel={commitEdgeLabel}
      onCancelRename={() => setRenamingNodeId(null)}
      onCancelEdgeLabel={() => setRenamingEdgeId(null)}
      onDisconnectEdge={handleDisconnect}
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
      {editNotice && (
        <div className="squisq-mermaid-edit-notice" role="status">
          {editNotice} Open Source for the full Mermaid syntax.
        </div>
      )}
    </div>
  );
}

function MermaidDirectionPicker({
  selected,
  onPick,
  onClose,
}: {
  selected: MermaidFlowchartDirection;
  onPick: (direction: MermaidFlowchartDirection) => void;
  onClose: () => void;
}) {
  const [position, setPosition] = useState<DirectionPickerPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.squisq-scene-block-toolbar')) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const picker = ref.current;
    const anchor = picker?.parentElement;
    if (!picker || !anchor) return;

    const editorShell = picker.closest('.squisq-editor-shell') as HTMLElement | null;
    const statusBar = editorShell?.querySelector('.squisq-status-bar') as HTMLElement | null;

    const measure = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const shellRect = editorShell?.getBoundingClientRect();
      const statusRect = statusBar?.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const boundaryTop = Math.max(VIEWPORT_GUTTER, (shellRect?.top ?? 0) + VIEWPORT_GUTTER);
      const boundaryBottom =
        Math.min(viewportHeight, statusRect?.top ?? viewportHeight) - VIEWPORT_GUTTER;
      const targetHeight = Math.min(
        DIRECTION_PICKER_MAX_HEIGHT,
        picker.scrollHeight,
        Math.floor(viewportHeight * 0.7),
      );
      const belowTop = anchorRect.bottom + DIRECTION_PICKER_GAP;
      const roomBelow = Math.max(0, boundaryBottom - belowTop);
      const roomAbove = Math.max(0, anchorRect.top - DIRECTION_PICKER_GAP - boundaryTop);
      const opensAbove = roomBelow < targetHeight && roomAbove > roomBelow;
      const availableHeight = opensAbove ? roomAbove : roomBelow;
      const maxHeight = Math.max(0, Math.min(targetHeight, Math.floor(availableHeight)));
      const top = opensAbove
        ? Math.max(boundaryTop, anchorRect.top - DIRECTION_PICKER_GAP - maxHeight)
        : belowTop;
      const width = Math.max(
        0,
        Math.min(DIRECTION_PICKER_WIDTH, viewportWidth - VIEWPORT_GUTTER * 2),
      );
      const opensLeft = Boolean(anchor.closest('.squisq-scene-side-toolbar'));
      const preferredLeft = opensLeft
        ? anchorRect.left - DIRECTION_PICKER_GAP - width
        : anchorRect.left;
      const left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(preferredLeft, viewportWidth - width - VIEWPORT_GUTTER),
      );

      const next: DirectionPickerPosition = {
        position: 'fixed',
        top: Math.round(top),
        left: Math.round(left),
        right: 'auto',
        width: Math.round(width),
        maxHeight,
      };
      setPosition((current) =>
        current &&
        current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(anchor);
    if (editorShell) observer?.observe(editorShell);
    if (statusBar) observer?.observe(statusBar);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);

  const directions: {
    id: Exclude<MermaidFlowchartDirection, 'TD'>;
    label: string;
    detail: string;
  }[] = [
    { id: 'LR', label: 'Horizontal', detail: 'Left to right' },
    { id: 'TB', label: 'Vertical', detail: 'Top to bottom' },
    { id: 'RL', label: 'Horizontal reversed', detail: 'Right to left' },
    { id: 'BT', label: 'Vertical reversed', detail: 'Bottom to top' },
  ];
  return (
    <div
      ref={ref}
      className="squisq-mermaid-direction-picker"
      role="dialog"
      aria-label="Flowchart layout gallery"
      style={position ?? undefined}
    >
      <div className="squisq-mermaid-direction-heading">
        <strong>Flow direction</strong>
        <span>Re-layout this flowchart without changing its content.</span>
      </div>
      {directions.map((direction) => (
        <button
          key={direction.id}
          type="button"
          className="squisq-mermaid-direction-card"
          aria-label={`${direction.label}: ${direction.detail.toLowerCase()}`}
          aria-pressed={selected === direction.id || (selected === 'TD' && direction.id === 'TB')}
          onClick={() => onPick(direction.id)}
        >
          <MermaidDirectionThumbnail direction={direction.id} />
          <span className="squisq-mermaid-direction-copy">
            <strong>{direction.label}</strong>
            <small>{direction.detail}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function MermaidDirectionThumbnail({
  direction,
}: {
  direction: Exclude<MermaidFlowchartDirection, 'TD'>;
}) {
  const horizontal = direction === 'LR' || direction === 'RL';
  const reversed = direction === 'RL' || direction === 'BT';
  const first = horizontal ? { x: reversed ? 79 : 7, y: 21 } : { x: 43, y: reversed ? 39 : 3 };
  const second = horizontal ? { x: reversed ? 7 : 79, y: 21 } : { x: 43, y: reversed ? 3 : 39 };
  const path =
    direction === 'LR'
      ? 'M41 32H75'
      : direction === 'RL'
        ? 'M79 32H45'
        : direction === 'TB'
          ? 'M60 25V35'
          : 'M60 39V29';
  const arrow =
    direction === 'LR'
      ? '75,32 68,28 68,36'
      : direction === 'RL'
        ? '45,32 52,28 52,36'
        : direction === 'TB'
          ? '60,35 56,28 64,28'
          : '60,29 56,36 64,36';

  return (
    <svg viewBox="0 0 120 64" aria-hidden="true">
      <rect x={first.x} y={first.y} width="34" height="22" rx="3" />
      <rect x={second.x} y={second.y} width="34" height="22" rx="3" />
      <path d={path} />
      <polygon points={arrow} />
      <text x={first.x + 17} y={first.y + 14}>
        A
      </text>
      <text x={second.x + 17} y={second.y + 14}>
        B
      </text>
    </svg>
  );
}

export default MermaidDiagramWidget;
