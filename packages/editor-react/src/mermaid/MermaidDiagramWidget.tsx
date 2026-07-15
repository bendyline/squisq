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
  MermaidDiagramProperty,
  MermaidEditableEdge,
  MermaidEditableModel,
  MermaidEditableNode,
  MermaidFlowchartDirection,
} from './mermaidModel';
import { mermaidDiagramProperties, mermaidEditCapabilities } from './mermaidModel';
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
import {
  addAdapterNode,
  connectAdapterNodes,
  deleteAdapterNode,
  disconnectAdapterEdge,
  duplicateAdapterNode,
  renameAdapterNode,
  setAdapterEdgeLabel,
  setAdapterProperty,
} from './mermaidSourceAdapters';
import type { MermaidFlowchartShapeId } from './mermaidShapes';

const MIN_DIAGRAM_HEIGHT = 160;
const DEFAULT_DIAGRAM_HEIGHT = 420;
const DIRECTION_PICKER_WIDTH = 344;
const DIRECTION_PICKER_MAX_HEIGHT = 360;
const PROPERTIES_PICKER_WIDTH = 320;
const PROPERTIES_PICKER_MAX_HEIGHT = 520;
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
  const [openPopover, setOpenPopover] = useState<'shape' | 'direction' | 'properties' | null>(null);
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

  const selectedNode = model?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = model?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const editCapabilities = model ? mermaidEditCapabilities(model) : null;
  const diagramProperties = model ? mermaidDiagramProperties(model) : [];

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
      const node = model?.nodes.find((candidate) => candidate.id === nodeId);
      if (!data || !node) return false;
      if (label.trim() === node.label) {
        setRenamingNodeId(null);
        return true;
      }
      const applied = applyEdit(
        model?.kind === 'flowchart'
          ? renameMermaidNode(data.source, node, label)
          : model
            ? renameAdapterNode(data.source, model, node, label)
            : { ok: false, source: data.source },
      );
      if (applied) setRenamingNodeId(null);
      return applied;
    },
    [applyEdit, data, model],
  );

  const commitEdgeLabel = useCallback(
    (edgeId: string, label: string): boolean => {
      const edge = model?.edges.find((candidate) => candidate.id === edgeId);
      if (!data || !model || !edge) return false;
      if (label.trim() === edge.label.trim()) {
        setRenamingEdgeId(null);
        return true;
      }
      const applied = applyEdit(
        model.kind === 'flowchart'
          ? setMermaidEdgeLabel(data.source, model, edge, label)
          : setAdapterEdgeLabel(data.source, model, edge, label),
      );
      if (applied) setRenamingEdgeId(null);
      return applied;
    },
    [applyEdit, data, model],
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
      if (!connecting || !nodeId || !model || !data) {
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
        model.kind === 'flowchart'
          ? connectMermaidNodes(data.source, model, connectSourceId, nodeId)
          : connectAdapterNodes(data.source, model, connectSourceId, nodeId),
      );
      if (applied) {
        setConnecting(false);
        setConnectSourceId(null);
        setSelectedNodeId(nodeId);
      }
    },
    [applyEdit, connectSourceId, connecting, data, model],
  );

  const handleNodeAction = useCallback(
    (action: MermaidNodeCanvasAction, nodeId: string) => {
      if (!model || !data) return;
      const node = model.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setRenamingEdgeId(null);
      switch (action) {
        case 'rename':
          beginRename(node);
          break;
        case 'shape':
          if (editCapabilities?.shape) setOpenPopover('shape');
          break;
        case 'duplicate': {
          const result =
            model.kind === 'flowchart'
              ? duplicateMermaidNode(data.source, model, node)
              : duplicateAdapterNode(data.source, model, node);
          if (applyEdit(result) && result.nodeId) setSelectedNodeId(result.nodeId);
          break;
        }
        case 'connect':
          if (editCapabilities?.connect) beginConnect(nodeId);
          break;
        case 'delete':
          if (
            applyEdit(
              model.kind === 'flowchart'
                ? deleteMermaidNode(data.source, model, nodeId)
                : deleteAdapterNode(data.source, model, node),
            )
          ) {
            setSelectedNodeId(null);
            setConnectSourceId(null);
          }
          break;
      }
    },
    [applyEdit, beginConnect, beginRename, data, editCapabilities, model],
  );

  const handleDisconnect = useCallback(
    (edgeId: string) => {
      if (!model || !data) return;
      const edge = model.edges.find((candidate) => candidate.id === edgeId);
      if (!edge) return;
      if (
        applyEdit(
          model.kind === 'flowchart'
            ? disconnectMermaidEdge(data.source, model, edge)
            : disconnectAdapterEdge(data.source, model, edge),
        )
      ) {
        setSelectedEdgeId(null);
        setRenamingEdgeId(null);
      }
    },
    [applyEdit, data, model],
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
  const structured = model !== null;
  const nodeNoun = model && model.kind !== 'flowchart' ? model.nodeNoun : 'Node';
  const hasNonDirectionProperties = diagramProperties.some(
    (property) => property.id !== 'direction',
  );

  const actions: SceneBlockAction[] = [
    {
      id: 'add-node',
      label: nodeNoun,
      icon: <Icon icon="fa-solid fa-plus" />,
      title: editCapabilities?.addNode
        ? `Add Mermaid ${nodeNoun.toLowerCase()}`
        : 'This Mermaid grammar cannot represent an isolated node',
      disabled: !editCapabilities?.addNode,
      onClick: () => {
        if (!model) return;
        const result =
          model.kind === 'flowchart'
            ? addMermaidNode(data.source, model)
            : addAdapterNode(data.source, model);
        if (applyEdit(result) && result.nodeId) setSelectedNodeId(result.nodeId);
      },
    },
    {
      id: 'connect',
      label: 'Connect',
      icon: <Icon icon="fa-solid fa-link" />,
      title: connecting
        ? 'Cancel connection'
        : editCapabilities?.connect
          ? `Connect two Mermaid ${nodeNoun.toLowerCase()}s`
          : (editCapabilities?.connectionHint ??
            'This Mermaid grammar has no explicit connections'),
      disabled: !editCapabilities?.connect,
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
      disabled:
        (!selectedNode || !editCapabilities?.renameNode) &&
        (!selectedEdge || !editCapabilities?.edgeLabel),
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
      title: editCapabilities?.shape
        ? 'Change Mermaid node shape'
        : 'Shapes are defined by this diagram grammar',
      disabled: !selectedNode || !editCapabilities?.shape,
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
      disabled: !selectedNode || !editCapabilities?.duplicateNode,
      onClick: () => selectedNode && handleNodeAction('duplicate', selectedNode.id),
    },
    {
      id: 'disconnect-edge',
      label: 'Disconnect',
      icon: <Icon icon="fa-solid fa-link-slash" />,
      disabled: !selectedEdge || !editCapabilities?.disconnect,
      onClick: () => selectedEdge && handleDisconnect(selectedEdge.id),
    },
    {
      id: 'delete-node',
      label: 'Delete',
      icon: <Icon icon="fa-solid fa-trash" />,
      danger: true,
      disabled: !selectedNode || !editCapabilities?.deleteNode,
      onClick: () => selectedNode && handleNodeAction('delete', selectedNode.id),
    },
    {
      id: 'direction',
      label: 'Direction',
      icon: <Icon icon="fa-solid fa-arrows-up-down-left-right" />,
      disabled: !editCapabilities?.direction,
      active: openPopover === 'direction',
      onClick: () => setOpenPopover((value) => (value === 'direction' ? null : 'direction')),
      popover:
        openPopover === 'direction' && model?.direction ? (
          <MermaidDirectionPicker
            selected={model.direction}
            onClose={() => setOpenPopover(null)}
            onPick={(direction) => {
              applyEdit(
                model.kind === 'flowchart'
                  ? setMermaidFlowchartDirection(data.source, direction)
                  : setAdapterProperty(data.source, model, 'direction', direction),
              );
              setOpenPopover(null);
            }}
          />
        ) : undefined,
    },
    {
      id: 'diagram-properties',
      label: 'Properties',
      icon: <Icon icon="fa-solid fa-sliders" />,
      title: 'Edit Mermaid diagram properties',
      disabled: !structured || !hasNonDirectionProperties,
      active: openPopover === 'properties',
      onClick: () => setOpenPopover((value) => (value === 'properties' ? null : 'properties')),
      popover:
        openPopover === 'properties' && model && hasNonDirectionProperties ? (
          <MermaidPropertiesPalette
            properties={diagramProperties.filter((property) => property.id !== 'direction')}
            onClose={() => setOpenPopover(null)}
            onApply={(values) => {
              let nextSource = data.source;
              for (const [propertyId, value] of Object.entries(values)) {
                if (model.kind === 'flowchart') continue;
                const next = setAdapterProperty(nextSource, model, propertyId, value);
                if (next.ok) nextSource = next.source;
              }
              applyEdit({
                ok: nextSource !== data.source,
                source: nextSource,
                reason: 'The diagram properties are unchanged.',
              });
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
        const edge = model?.edges.find((candidate) => candidate.id === id);
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

function useDismissibleMermaidPopover(
  ref: { readonly current: Element | null },
  onClose: () => void,
) {
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
  }, [onClose, ref]);
}

function useClampedMermaidPopoverPosition(
  ref: { readonly current: HTMLElement | null },
  preferredWidth: number,
  preferredMaxHeight: number,
): DirectionPickerPosition | null {
  const [position, setPosition] = useState<DirectionPickerPosition | null>(null);
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
        preferredMaxHeight,
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
      const width = Math.max(0, Math.min(preferredWidth, viewportWidth - VIEWPORT_GUTTER * 2));
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
  }, [preferredMaxHeight, preferredWidth, ref]);
  return position;
}

function MermaidPropertiesPalette({
  properties,
  onApply,
  onClose,
}: {
  properties: readonly MermaidDiagramProperty[];
  onApply: (values: Readonly<Record<string, string | boolean>>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(properties.map((property) => [property.id, property.value])),
  );
  const ref = useRef<HTMLFormElement>(null);
  useDismissibleMermaidPopover(ref, onClose);
  const position = useClampedMermaidPopoverPosition(
    ref,
    PROPERTIES_PICKER_WIDTH,
    PROPERTIES_PICKER_MAX_HEIGHT,
  );

  return (
    <form
      ref={ref}
      className="squisq-mermaid-properties"
      role="dialog"
      aria-label="Mermaid diagram properties"
      style={position ?? { visibility: 'hidden' }}
      onSubmit={(event) => {
        event.preventDefault();
        onApply(values);
      }}
    >
      <div className="squisq-mermaid-properties-header">
        <strong>Diagram properties</strong>
        <button type="button" onClick={onClose} aria-label="Close diagram properties">
          <Icon icon="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="squisq-mermaid-properties-fields">
        {properties.map((property) => (
          <label key={property.id}>
            {property.type === 'boolean' ? (
              <span className="squisq-mermaid-property-toggle">
                <input
                  type="checkbox"
                  checked={values[property.id] === true}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [property.id]: event.currentTarget.checked,
                    }))
                  }
                />
                <span>{property.label}</span>
              </span>
            ) : (
              <>
                <span>{property.label}</span>
                {property.type === 'select' ? (
                  <select
                    value={String(values[property.id] ?? '')}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [property.id]: event.currentTarget.value,
                      }))
                    }
                  >
                    {property.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={String(values[property.id] ?? '')}
                    placeholder={property.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [property.id]: event.currentTarget.value,
                      }))
                    }
                  />
                )}
              </>
            )}
          </label>
        ))}
      </div>
      <div className="squisq-mermaid-properties-footer">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" data-primary="true">
          Apply
        </button>
      </div>
    </form>
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
  const ref = useRef<HTMLDivElement>(null);
  useDismissibleMermaidPopover(ref, onClose);
  const position = useClampedMermaidPopoverPosition(
    ref,
    DIRECTION_PICKER_WIDTH,
    DIRECTION_PICKER_MAX_HEIGHT,
  );

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
      style={position ?? { visibility: 'hidden' }}
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
