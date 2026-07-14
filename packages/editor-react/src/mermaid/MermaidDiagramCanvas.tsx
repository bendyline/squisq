import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { MermaidEditableModel } from './mermaidModel';
import { mermaidErrorMessage, renderMermaidDiagram } from './mermaidRenderer';

let renderSequence = 0;

export type MermaidNodeCanvasAction = 'rename' | 'shape' | 'duplicate' | 'connect' | 'delete';

export interface MermaidDiagramCanvasProps {
  source: string;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  renamingNodeId?: string | null;
  renamingEdgeId?: string | null;
  connectSourceId?: string | null;
  connecting?: boolean;
  onModelChange?: (model: MermaidEditableModel | null) => void;
  onSelectNode?: (id: string | null) => void;
  onSelectEdge?: (id: string | null) => void;
  onNodeAction?: (action: MermaidNodeCanvasAction, id: string) => void;
  onEditEdgeLabel?: (id: string) => void;
  onCommitRename?: (id: string, label: string) => boolean;
  onCommitEdgeLabel?: (id: string, label: string) => boolean;
  onCancelRename?: () => void;
  onCancelEdgeLabel?: () => void;
  onDisconnectEdge?: (id: string) => void;
}

interface SelectionAnchor {
  left: number;
  top: number;
  placement: 'above' | 'below';
  editorLeft: number;
  editorTop: number;
  editorWidth: number;
}

interface PanOffset {
  x: number;
  y: number;
}

interface PanDragState {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

function excludesCanvasPan(target: EventTarget | null, viewport: Element): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'button, input, textarea, select, a, [contenteditable="true"]',
  );
  // The whole Tiptap document is contenteditable, so only exclude an
  // interactive element that is actually inside this diagram viewport.
  return Boolean(interactive && viewport.contains(interactive));
}

function matchesMermaidNodeDomId(elementId: string, modelDomId: string): boolean {
  return elementId === modelDomId || elementId.endsWith(`-${modelDomId}`);
}

export function MermaidDiagramCanvas({
  source,
  maximized = false,
  onToggleMaximize,
  selectedNodeId = null,
  selectedEdgeId = null,
  renamingNodeId = null,
  renamingEdgeId = null,
  connectSourceId = null,
  connecting = false,
  onModelChange,
  onSelectNode,
  onSelectEdge,
  onNodeAction,
  onEditEdgeLabel,
  onCommitRename,
  onCommitEdgeLabel,
  onCancelRename,
  onCancelEdgeLabel,
  onDisconnectEdge,
}: MermaidDiagramCanvasProps) {
  const renderContainerRef = useRef<HTMLDivElement>(null);
  const svgRootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const panDragRef = useRef<PanDragState | null>(null);
  const renameHintId = useId();
  const [svg, setSvg] = useState('');
  const [model, setModel] = useState<MermaidEditableModel | null>(null);
  const [diagramType, setDiagramType] = useState('mermaid');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    if (!panning) return;

    const finish = () => {
      panDragRef.current = null;
      setPanning(false);
    };
    const move = (event: MouseEvent) => {
      const drag = panDragRef.current;
      if (!drag) return;
      if ((event.buttons & 2) === 0) {
        finish();
        return;
      }
      setPan({
        x: Math.round(drag.originX + event.clientX - drag.startX),
        y: Math.round(drag.originY + event.clientY - drag.startY),
      });
      event.preventDefault();
    };

    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', finish, true);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', finish, true);
      window.removeEventListener('blur', finish);
    };
  }, [panning]);

  useEffect(() => {
    let current = true;
    const id = `squisq-mermaid-svg-${++renderSequence}`;
    setRendering(true);
    setError('');
    void renderMermaidDiagram(id, source, renderContainerRef.current ?? undefined)
      .then((result) => {
        if (!current) return;
        const nextModel = result.model ?? null;
        setSvg(result.svg);
        setModel(nextModel);
        onModelChange?.(nextModel);
        setDiagramType(result.diagramType);
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setSvg('');
        setModel(null);
        onModelChange?.(null);
        setError(mermaidErrorMessage(caught));
      })
      .finally(() => {
        if (current) setRendering(false);
      });
    return () => {
      current = false;
    };
  }, [source, onModelChange]);

  const findNodeElement = useCallback(
    (id: string): SVGGElement | null => {
      const root = svgRootRef.current;
      const node = model?.nodes.find((candidate) => candidate.id === id);
      if (!root || !node) return null;
      return (
        [...root.querySelectorAll<SVGGElement>('g.node')].find((element) =>
          matchesMermaidNodeDomId(element.id, node.domId),
        ) ?? null
      );
    },
    [model],
  );

  const findEdgeElements = useCallback((id: string): Element[] => {
    const root = svgRootRef.current;
    if (!root) return [];
    return [...root.querySelectorAll<Element>('[data-id]')].filter(
      (element) => element.getAttribute('data-id') === id,
    );
  }, []);

  const updateSelectionAnchor = useCallback(() => {
    const root = svgRootRef.current;
    const selected = selectedNodeId
      ? findNodeElement(selectedNodeId)
      : selectedEdgeId
        ? findEdgeElements(selectedEdgeId)[0]
        : null;
    if (!root || !selected) {
      setSelectionAnchor(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    const selectedTop = selectedRect.top - rootRect.top;
    const placement = selectedTop < 52 ? 'below' : 'above';
    setSelectionAnchor({
      // Five 28 px actions plus chrome are about 156 px wide. Keeping the
      // anchor away from either edge prevents the palette being clipped when
      // Mermaid lays a node against the scroll viewport boundary.
      left: Math.min(
        Math.max(selectedRect.left - rootRect.left + selectedRect.width / 2, 82),
        Math.max(rootRect.width - 82, 82),
      ),
      top: placement === 'above' ? selectedTop : selectedRect.bottom - rootRect.top,
      placement,
      editorLeft: selectedRect.left - rootRect.left + selectedRect.width / 2,
      editorTop: selectedTop + selectedRect.height / 2,
      editorWidth: Math.min(420, Math.max(140, selectedRect.width - 20)),
    });
  }, [findEdgeElements, findNodeElement, selectedEdgeId, selectedNodeId]);

  useLayoutEffect(() => {
    const node = renamingNodeId
      ? model?.nodes.find((candidate) => candidate.id === renamingNodeId)
      : null;
    const edge = renamingEdgeId
      ? model?.edges.find((candidate) => candidate.id === renamingEdgeId)
      : null;
    const label = node?.label ?? edge?.label;
    if (label === undefined) return;
    setRenameValue(label);
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [model, renamingEdgeId, renamingNodeId]);

  // Decorate Mermaid-owned SVG groups with editor-only hit metadata. The SVG
  // string remains Mermaid output; these attributes are session UI state.
  useLayoutEffect(() => {
    const root = svgRootRef.current;
    if (!root || !model) {
      setSelectionAnchor(null);
      return;
    }
    const groups = [...root.querySelectorAll<SVGGElement>('g.node')];
    for (const group of groups) {
      const node = model.nodes.find((candidate) =>
        matchesMermaidNodeDomId(group.id, candidate.domId),
      );
      if (!node) continue;
      group.dataset.squisqNodeId = node.id;
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', `${node.label}, ${node.shape} Mermaid node`);
      group.classList.toggle('squisq-mermaid-node-selected', node.id === selectedNodeId);
      group.classList.toggle('squisq-mermaid-connect-source', node.id === connectSourceId);
    }
    for (const previous of root.querySelectorAll('.squisq-mermaid-edge-hit-target')) {
      previous.remove();
    }
    // Mermaid's visible relationship paths are usually only 1–2px wide.
    // Duplicate their geometry as an editor-only transparent stroke so edge
    // selection is practical with a mouse or pen without changing the render.
    for (const path of root.querySelectorAll<SVGPathElement>('path.flowchart-link')) {
      const hitTarget = path.cloneNode(false) as SVGPathElement;
      const edge = model.edges.find((candidate) => candidate.id === path.dataset.id);
      hitTarget.removeAttribute('id');
      hitTarget.removeAttribute('marker-start');
      hitTarget.removeAttribute('marker-mid');
      hitTarget.removeAttribute('marker-end');
      hitTarget.setAttribute('class', 'squisq-mermaid-edge-hit-target');
      if (edge) {
        const sourceLabel =
          model.nodes.find((node) => node.id === edge.source)?.label ?? edge.source;
        const targetLabel =
          model.nodes.find((node) => node.id === edge.target)?.label ?? edge.target;
        hitTarget.setAttribute('role', 'button');
        hitTarget.setAttribute('tabindex', '0');
        hitTarget.setAttribute(
          'aria-label',
          `Connection from ${sourceLabel} to ${targetLabel}${edge.label ? `: ${edge.label}` : ''}`,
        );
      } else {
        hitTarget.setAttribute('aria-hidden', 'true');
      }
      path.after(hitTarget);
    }
    for (const element of root.querySelectorAll('.squisq-mermaid-edge-selected')) {
      element.classList.remove('squisq-mermaid-edge-selected');
    }
    if (selectedEdgeId) {
      for (const element of findEdgeElements(selectedEdgeId)) {
        element.classList.add('squisq-mermaid-edge-selected');
      }
    }
    updateSelectionAnchor();
  }, [
    connectSourceId,
    findEdgeElements,
    model,
    selectedEdgeId,
    selectedNodeId,
    svg,
    updateSelectionAnchor,
    zoom,
  ]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const update = () => updateSelectionAnchor();
    scroll.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scroll.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [updateSelectionAnchor]);

  const nodeIdFromTarget = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<SVGGElement>('g.node')?.dataset.squisqNodeId ?? null;
  };

  const edgeIdFromTarget = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element) || !model) return null;
    const element = target.closest<Element>('[data-id]');
    const id = element?.getAttribute('data-id');
    return id && model.edges.some((edge) => edge.id === id) ? id : null;
  };

  const onSvgClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const nodeId = nodeIdFromTarget(event.target);
    if (nodeId) {
      onSelectEdge?.(null);
      onSelectNode?.(nodeId);
      return;
    }
    const edgeId = edgeIdFromTarget(event.target);
    if (edgeId) {
      onSelectNode?.(null);
      onSelectEdge?.(edgeId);
      return;
    }
    onSelectNode?.(null);
    onSelectEdge?.(null);
  };

  const onSvgDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const nodeId = nodeIdFromTarget(event.target);
    if (nodeId) {
      onNodeAction?.('rename', nodeId);
      return;
    }
    const edgeId = edgeIdFromTarget(event.target);
    if (edgeId) onEditEdgeLabel?.(edgeId);
  };

  const onSvgKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const nodeId = nodeIdFromTarget(event.target);
    const edgeId = edgeIdFromTarget(event.target);
    if (nodeId && (event.key === 'Enter' || event.key === ' ')) {
      onSelectNode?.(nodeId);
      event.preventDefault();
    } else if (nodeId && (event.key === 'Delete' || event.key === 'Backspace')) {
      onNodeAction?.('delete', nodeId);
      event.preventDefault();
    } else if (edgeId && (event.key === 'Enter' || event.key === ' ')) {
      onSelectNode?.(null);
      onSelectEdge?.(edgeId);
      event.preventDefault();
    } else if (edgeId && event.key === 'F2') {
      onSelectNode?.(null);
      onSelectEdge?.(edgeId);
      onEditEdgeLabel?.(edgeId);
      event.preventDefault();
    } else if (edgeId && (event.key === 'Delete' || event.key === 'Backspace')) {
      onDisconnectEdge?.(edgeId);
      event.preventDefault();
    } else if (event.key === 'Escape') {
      onSelectNode?.(null);
      onSelectEdge?.(null);
    }
  };

  const adjustZoom = (delta: number) => {
    setZoom((value) => Math.min(3, Math.max(0.4, Math.round((value + delta) * 10) / 10)));
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onPanMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2 || excludesCanvasPan(event.target, event.currentTarget)) return;
    panDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    setPanning(true);
    event.preventDefault();
  };

  const editingNodeLabel = renamingNodeId !== null && renamingNodeId === selectedNodeId;
  const editingEdgeLabel = renamingEdgeId !== null && renamingEdgeId === selectedEdgeId;

  const commitInlineLabel = () => {
    const committed = editingNodeLabel
      ? (onCommitRename?.(renamingNodeId, renameValue) ?? true)
      : editingEdgeLabel
        ? (onCommitEdgeLabel?.(renamingEdgeId, renameValue) ?? true)
        : true;
    if (!committed) {
      window.requestAnimationFrame(() => renameInputRef.current?.focus());
    }
  };

  return (
    <div className="squisq-mermaid-canvas" aria-label={`${diagramType} diagram editor`}>
      <div
        ref={renderContainerRef}
        className="squisq-mermaid-render-container"
        aria-hidden="true"
      />
      <div className="squisq-mermaid-canvas-controls" role="toolbar" aria-label="Diagram view">
        <button
          type="button"
          onClick={() => adjustZoom(-0.2)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Icon icon="fa-solid fa-minus" />
        </button>
        <button type="button" onClick={resetView} title="Fit diagram" aria-label="Fit diagram">
          <span>{Math.round(zoom * 100)}%</span>
        </button>
        <button type="button" onClick={() => adjustZoom(0.2)} title="Zoom in" aria-label="Zoom in">
          <Icon icon="fa-solid fa-plus" />
        </button>
      </div>
      {connecting && (
        <div className="squisq-mermaid-connect-hint">
          {connectSourceId ? 'Choose a target node' : 'Choose a source node'}
        </div>
      )}
      {onToggleMaximize && (
        <button
          type="button"
          className="squisq-diagram-maximize-btn"
          onClick={onToggleMaximize}
          aria-label={maximized ? 'Restore diagram' : 'Maximize diagram'}
          title={maximized ? 'Restore diagram' : 'Maximize diagram'}
        >
          <Icon icon={maximized ? 'fa-solid fa-compress' : 'fa-solid fa-expand'} />
        </button>
      )}
      <div
        ref={scrollRef}
        className="squisq-mermaid-canvas-scroll"
        data-panning={panning || undefined}
        title="Right-drag to pan · Ctrl/⌘ + wheel to zoom"
        onMouseDown={onPanMouseDown}
        onContextMenu={(event) => {
          if (!excludesCanvasPan(event.target, event.currentTarget)) event.preventDefault();
        }}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          adjustZoom(event.deltaY > 0 ? -0.1 : 0.1);
        }}
      >
        {rendering && <div className="squisq-mermaid-status">Rendering Mermaid diagram…</div>}
        {!rendering && error && (
          <div className="squisq-mermaid-error" role="alert">
            <strong>Mermaid could not render this source.</strong>
            <pre>{error}</pre>
            <span>Open Source to edit the code block without losing it.</span>
          </div>
        )}
        {!error && svg && (
          <div
            ref={svgRootRef}
            className="squisq-mermaid-svg"
            style={{
              width: `${zoom * 100}%`,
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            }}
            onClick={onSvgClick}
            onDoubleClick={onSvgDoubleClick}
            onKeyDown={onSvgKeyDown}
          >
            <div
              // Mermaid's strict security level sanitizes authored markup.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            {selectionAnchor && (editingNodeLabel || editingEdgeLabel) && (
              <form
                className="squisq-mermaid-inline-rename"
                aria-label={
                  editingNodeLabel ? 'Edit Mermaid node label' : 'Edit Mermaid connection label'
                }
                contentEditable={false}
                style={{
                  left: selectionAnchor.editorLeft,
                  top: selectionAnchor.editorTop,
                  width: selectionAnchor.editorWidth,
                }}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  commitInlineLabel();
                }}
              >
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  required={editingNodeLabel}
                  spellCheck
                  aria-label={editingNodeLabel ? 'Mermaid node label' : 'Mermaid connection label'}
                  aria-describedby={renameHintId}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBeforeInput={(event) => event.stopPropagation()}
                  onInput={(event) => {
                    event.stopPropagation();
                    setRenameValue(event.currentTarget.value);
                  }}
                  onKeyUp={(event) => event.stopPropagation()}
                  onPaste={(event) => event.stopPropagation()}
                  onBlur={commitInlineLabel}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitInlineLabel();
                      return;
                    }
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    if (editingNodeLabel) onCancelRename?.();
                    else onCancelEdgeLabel?.();
                  }}
                />
                <span id={renameHintId} aria-hidden="true">
                  {editingEdgeLabel
                    ? 'Enter to save · leave blank to remove · Esc to cancel'
                    : 'Enter to save · Esc to cancel'}
                </span>
              </form>
            )}
            {selectionAnchor && selectedNodeId && renamingNodeId !== selectedNodeId && (
              <div
                className="squisq-mermaid-selection-actions"
                role="toolbar"
                aria-label="Selected Mermaid node actions"
                data-placement={selectionAnchor.placement}
                style={{ left: selectionAnchor.left, top: selectionAnchor.top }}
                onClick={(event) => event.stopPropagation()}
              >
                <CanvasAction
                  icon="fa-solid fa-pen"
                  label="Rename node"
                  onClick={() => onNodeAction?.('rename', selectedNodeId)}
                />
                <CanvasAction
                  icon="fa-solid fa-shapes"
                  label="Change shape"
                  onClick={() => onNodeAction?.('shape', selectedNodeId)}
                />
                <CanvasAction
                  icon="fa-solid fa-copy"
                  label="Duplicate node"
                  onClick={() => onNodeAction?.('duplicate', selectedNodeId)}
                />
                <CanvasAction
                  icon="fa-solid fa-link"
                  label="Connect node"
                  onClick={() => onNodeAction?.('connect', selectedNodeId)}
                />
                <CanvasAction
                  icon="fa-solid fa-trash"
                  label="Delete node"
                  danger
                  onClick={() => onNodeAction?.('delete', selectedNodeId)}
                />
              </div>
            )}
            {selectionAnchor && selectedEdgeId && renamingEdgeId !== selectedEdgeId && (
              <div
                className="squisq-mermaid-selection-actions"
                role="toolbar"
                aria-label="Selected Mermaid connection actions"
                data-placement={selectionAnchor.placement}
                style={{ left: selectionAnchor.left, top: selectionAnchor.top }}
                onClick={(event) => event.stopPropagation()}
              >
                <CanvasAction
                  icon="fa-solid fa-pen"
                  label="Edit connection label"
                  onClick={() => onEditEdgeLabel?.(selectedEdgeId)}
                />
                <CanvasAction
                  icon="fa-solid fa-link-slash"
                  label="Disconnect nodes"
                  danger
                  onClick={() => onDisconnectEdge?.(selectedEdgeId)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CanvasAction({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-danger={danger || undefined}
      onClick={onClick}
    >
      <Icon icon={icon} />
    </button>
  );
}

export default MermaidDiagramCanvas;
