import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { calculateFitScale, type SceneSize } from '../scene/fitScale';
import { SceneViewControls } from '../scene/SceneViewControls';
import {
  mermaidEditableTexts,
  mermaidEditCapabilities,
  type MermaidEditableModel,
  type MermaidSelection,
} from './mermaidModel';
import { mermaidErrorMessage, renderMermaidDiagram } from './mermaidRenderer';
import type { Theme } from '@bendyline/squisq/schemas';

let renderSequence = 0;

export type MermaidNodeCanvasAction = 'rename' | 'shape' | 'duplicate' | 'connect' | 'delete';

export interface MermaidDiagramCanvasProps {
  source: string;
  theme: Theme;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  selection?: MermaidSelection | null;
  renaming?: MermaidSelection | null;
  /** @deprecated Use the discriminated `selection` prop. */
  selectedNodeId?: string | null;
  /** @deprecated Use the discriminated `selection` prop. */
  selectedEdgeId?: string | null;
  /** @deprecated Use the discriminated `selection` prop. */
  selectedTextId?: string | null;
  /** @deprecated Use the discriminated `renaming` prop. */
  renamingNodeId?: string | null;
  /** @deprecated Use the discriminated `renaming` prop. */
  renamingEdgeId?: string | null;
  /** @deprecated Use the discriminated `renaming` prop. */
  renamingTextId?: string | null;
  connectSourceId?: string | null;
  connecting?: boolean;
  onModelChange?: (model: MermaidEditableModel | null) => void;
  onSelect?: (selection: MermaidSelection | null) => void;
  /** @deprecated Use the discriminated `onSelect` callback. */
  onSelectNode?: (id: string | null) => void;
  /** @deprecated Use the discriminated `onSelect` callback. */
  onSelectEdge?: (id: string | null) => void;
  /** @deprecated Use the discriminated `onSelect` callback. */
  onSelectText?: (id: string | null) => void;
  onNodeAction?: (action: MermaidNodeCanvasAction, id: string) => void;
  onEditEdgeLabel?: (id: string) => void;
  onEditText?: (id: string) => void;
  onCommitRename?: (id: string, label: string) => boolean;
  onCommitEdgeLabel?: (id: string, label: string) => boolean;
  onCommitText?: (id: string, label: string) => boolean;
  onCancelRename?: () => void;
  onCancelEdgeLabel?: () => void;
  onCancelText?: () => void;
  onDisconnectEdge?: (id: string) => void;
  onDeleteText?: (id: string) => void;
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

function readSvgViewBox(root: HTMLElement | null): SceneSize | null {
  const raw = root?.querySelector('svg')?.getAttribute('viewBox');
  if (!raw) return null;
  const values = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = values[2];
  const height = values[3];
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

export function MermaidDiagramCanvas({
  source,
  theme,
  maximized = false,
  onToggleMaximize,
  selection,
  renaming,
  selectedNodeId: legacySelectedNodeId = null,
  selectedEdgeId: legacySelectedEdgeId = null,
  selectedTextId: legacySelectedTextId = null,
  renamingNodeId: legacyRenamingNodeId = null,
  renamingEdgeId: legacyRenamingEdgeId = null,
  renamingTextId: legacyRenamingTextId = null,
  connectSourceId = null,
  connecting = false,
  onModelChange,
  onSelect,
  onSelectNode,
  onSelectEdge,
  onSelectText,
  onNodeAction,
  onEditEdgeLabel,
  onEditText,
  onCommitRename,
  onCommitEdgeLabel,
  onCommitText,
  onCancelRename,
  onCancelEdgeLabel,
  onCancelText,
  onDisconnectEdge,
  onDeleteText,
}: MermaidDiagramCanvasProps) {
  const selectedNodeId =
    selection === undefined
      ? legacySelectedNodeId
      : selection?.kind === 'node'
        ? selection.id
        : null;
  const selectedEdgeId =
    selection === undefined
      ? legacySelectedEdgeId
      : selection?.kind === 'edge'
        ? selection.id
        : null;
  const selectedTextId =
    selection === undefined
      ? legacySelectedTextId
      : selection?.kind === 'text'
        ? selection.id
        : null;
  const renamingNodeId =
    renaming === undefined ? legacyRenamingNodeId : renaming?.kind === 'node' ? renaming.id : null;
  const renamingEdgeId =
    renaming === undefined ? legacyRenamingEdgeId : renaming?.kind === 'edge' ? renaming.id : null;
  const renamingTextId =
    renaming === undefined ? legacyRenamingTextId : renaming?.kind === 'text' ? renaming.id : null;
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
  const [viewMode, setViewMode] = useState<'fit' | 'manual'>('fit');
  const [contentSize, setContentSize] = useState<SceneSize | null>(null);
  const [canvasSize, setCanvasSize] = useState<SceneSize | null>(null);
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
    // Mermaid measures HTML labels during rendering. Its temporary host must
    // outlive this editor canvas: switching to Page/Slideshow can unmount the
    // widget while an async render is in flight. The renderer's body host is
    // stable and also avoids measurements beneath the zoomed canvas.
    void renderMermaidDiagram(id, source, undefined, theme)
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
  }, [source, onModelChange, theme]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const measure = () => {
      const rect = scroll.getBoundingClientRect();
      const styles = window.getComputedStyle(scroll);
      const horizontalPadding =
        (Number.parseFloat(styles.paddingLeft) || 0) +
        (Number.parseFloat(styles.paddingRight) || 0);
      const verticalPadding =
        (Number.parseFloat(styles.paddingTop) || 0) +
        (Number.parseFloat(styles.paddingBottom) || 0);
      const next = {
        width: Math.max(0, rect.width - horizontalPadding),
        height: Math.max(0, rect.height - verticalPadding),
      };
      setCanvasSize((current) =>
        current?.width === next.width && current.height === next.height ? current : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setContentSize(readSvgViewBox(svgRootRef.current));
  }, [svg]);

  const fitZoom = contentSize && canvasSize ? calculateFitScale(contentSize, canvasSize) : 1;

  const applyFit = useCallback(() => {
    setViewMode('fit');
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  }, [fitZoom]);

  useLayoutEffect(() => {
    if (viewMode !== 'fit') return;
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  }, [fitZoom, viewMode]);

  const findNodeElement = useCallback(
    (id: string): Element | null => {
      const root = svgRootRef.current;
      const node = model?.nodes.find((candidate) => candidate.id === id);
      if (!root || !node) return null;
      const decorated = [...root.querySelectorAll<Element>('[data-squisq-node-id]')].find(
        (element) => element.getAttribute('data-squisq-node-id') === id,
      );
      if (decorated) return decorated;
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
    return [...root.querySelectorAll<Element>('[data-id], [data-squisq-edge-id]')].filter(
      (element) =>
        element.getAttribute('data-id') === id ||
        element.getAttribute('data-squisq-edge-id') === id,
    );
  }, []);

  const findTextElement = useCallback((id: string): Element | null => {
    const root = svgRootRef.current;
    if (!root) return null;
    return (
      [...root.querySelectorAll<Element>('[data-squisq-text-id]')].find(
        (element) => element.getAttribute('data-squisq-text-id') === id,
      ) ?? null
    );
  }, []);

  const updateSelectionAnchor = useCallback(() => {
    const root = svgRootRef.current;
    const selected = selectedTextId
      ? findTextElement(selectedTextId)
      : selectedNodeId
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
  }, [
    findEdgeElements,
    findNodeElement,
    findTextElement,
    selectedEdgeId,
    selectedNodeId,
    selectedTextId,
  ]);

  useLayoutEffect(() => {
    const node = renamingNodeId
      ? model?.nodes.find((candidate) => candidate.id === renamingNodeId)
      : null;
    const edge = renamingEdgeId
      ? model?.edges.find((candidate) => candidate.id === renamingEdgeId)
      : null;
    const text = renamingTextId
      ? model && mermaidEditableTexts(model).find((candidate) => candidate.id === renamingTextId)
      : null;
    const label = node?.label ?? edge?.label ?? text?.label;
    if (label === undefined) return;
    setRenameValue(label);
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [model, renamingEdgeId, renamingNodeId, renamingTextId]);

  // Decorate Mermaid-owned SVG groups with editor-only hit metadata. The SVG
  // string remains Mermaid output; these attributes are session UI state.
  useLayoutEffect(() => {
    const root = svgRootRef.current;
    if (!root || !model) {
      setSelectionAnchor(null);
      return;
    }
    for (const previous of root.querySelectorAll('[data-squisq-text-id]')) {
      previous.removeAttribute('data-squisq-text-id');
      previous.classList.remove('squisq-mermaid-text-selected');
    }
    for (const previous of root.querySelectorAll('[data-squisq-node-id]')) {
      previous.removeAttribute('data-squisq-node-id');
      previous.classList.remove('squisq-mermaid-node-selected', 'squisq-mermaid-connect-source');
    }
    const decoratedNodes = new Set<Element>();
    const groups = [...root.querySelectorAll<SVGGElement>('g.node')];
    for (const group of groups) {
      const node = model.nodes.find((candidate) =>
        matchesMermaidNodeDomId(group.id, candidate.domId),
      );
      if (!node) continue;
      decoratedNodes.add(group);
      group.dataset.squisqNodeId = node.id;
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', `${node.label}, ${node.shape} Mermaid node`);
      group.classList.toggle('squisq-mermaid-node-selected', node.id === selectedNodeId);
      group.classList.toggle('squisq-mermaid-connect-source', node.id === connectSourceId);
    }
    // Most Mermaid grammars do not expose stable SVG ids. Match their authored
    // labels to rendered text and decorate the smallest useful visual wrapper.
    // This keeps the SVG render official while making tasks, participants,
    // states, timeline events, data points, and similar entities selectable.
    const textElements = [...root.querySelectorAll<Element>('text, foreignObject')];
    const usedText = new Set<Element>();
    for (const item of model.nodes) {
      if (
        [...decoratedNodes].some(
          (element) => element.getAttribute('data-squisq-node-id') === item.id,
        )
      )
        continue;
      const text = textElements.find(
        (candidate) =>
          !usedText.has(candidate) && candidate.textContent?.trim() === item.label.trim(),
      );
      if (!text) continue;
      usedText.add(text);
      const group = text.closest<SVGGElement>('g');
      const target =
        group && group.querySelectorAll('text, foreignObject').length <= 2 ? group : text;
      decoratedNodes.add(target);
      target.setAttribute('data-squisq-node-id', item.id);
      target.setAttribute('role', 'button');
      target.setAttribute('tabindex', '0');
      target.setAttribute('aria-label', `${item.label}, Mermaid ${model.kind} item`);
      target.classList.toggle('squisq-mermaid-node-selected', item.id === selectedNodeId);
      target.classList.toggle('squisq-mermaid-connect-source', item.id === connectSourceId);
    }
    // Text selection is independent from structural selection. Clicking a
    // rendered label selects the authored text; clicking its surrounding shape
    // still selects the node or connection that owns it.
    const usedEditableText = new Set<Element>();
    for (const item of mermaidEditableTexts(model)) {
      const text = textElements.find(
        (candidate) =>
          !usedEditableText.has(candidate) && candidate.textContent?.trim() === item.label.trim(),
      );
      if (!text) continue;
      usedEditableText.add(text);
      text.setAttribute('data-squisq-text-id', item.id);
      text.setAttribute('role', 'button');
      text.setAttribute('tabindex', '0');
      text.setAttribute('aria-label', `${item.label}, editable Mermaid text`);
      text.classList.toggle('squisq-mermaid-text-selected', item.id === selectedTextId);
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
    if (model.kind !== 'flowchart') {
      const relationshipGeometry = [
        ...root.querySelectorAll<SVGGeometryElement>(
          'path[marker-end], path[marker-start], line[marker-end], line[marker-start], polyline[marker-end], polyline[marker-start]',
        ),
      ].filter((element) => !element.closest('defs'));
      relationshipGeometry.slice(0, model.edges.length).forEach((geometry, index) => {
        const item = model.edges[index];
        geometry.setAttribute('data-squisq-edge-id', item.id);
        const hitTarget = geometry.cloneNode(false) as SVGGeometryElement;
        hitTarget.removeAttribute('id');
        hitTarget.removeAttribute('marker-start');
        hitTarget.removeAttribute('marker-mid');
        hitTarget.removeAttribute('marker-end');
        hitTarget.setAttribute('class', 'squisq-mermaid-edge-hit-target');
        hitTarget.setAttribute('data-squisq-edge-id', item.id);
        hitTarget.setAttribute('role', 'button');
        hitTarget.setAttribute('tabindex', '0');
        const sourceLabel =
          model.nodes.find((node) => node.id === item.source)?.label ?? item.source;
        const targetLabel =
          model.nodes.find((node) => node.id === item.target)?.label ?? item.target;
        hitTarget.setAttribute(
          'aria-label',
          `${model.kind} connection from ${sourceLabel} to ${targetLabel}`,
        );
        geometry.after(hitTarget);
      });
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
    selectedTextId,
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
    return target.closest<HTMLElement>('[data-squisq-node-id]')?.dataset.squisqNodeId ?? null;
  };

  const textIdFromTarget = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('[data-squisq-text-id]')?.dataset.squisqTextId ?? null;
  };

  const edgeIdFromTarget = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element) || !model) return null;
    const element = target.closest<Element>('[data-id], [data-squisq-edge-id]');
    const id = element?.getAttribute('data-squisq-edge-id') ?? element?.getAttribute('data-id');
    return id && model.edges.some((edge) => edge.id === id) ? id : null;
  };

  const selectItem = (next: MermaidSelection | null) => {
    if (onSelect) {
      onSelect(next);
      return;
    }
    onSelectNode?.(next?.kind === 'node' ? next.id : null);
    onSelectEdge?.(next?.kind === 'edge' ? next.id : null);
    onSelectText?.(next?.kind === 'text' ? next.id : null);
  };

  const onSvgClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const textId = textIdFromTarget(event.target);
    if (textId) {
      selectItem({ kind: 'text', id: textId });
      return;
    }
    const nodeId = nodeIdFromTarget(event.target);
    if (nodeId) {
      selectItem({ kind: 'node', id: nodeId });
      return;
    }
    const edgeId = edgeIdFromTarget(event.target);
    if (edgeId) {
      selectItem({ kind: 'edge', id: edgeId });
      return;
    }
    selectItem(null);
  };

  const onSvgDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const textId = textIdFromTarget(event.target);
    if (textId) {
      onEditText?.(textId);
      return;
    }
    const nodeId = nodeIdFromTarget(event.target);
    if (nodeId) {
      if (model && mermaidEditCapabilities(model).renameNode) {
        onNodeAction?.('rename', nodeId);
      }
      return;
    }
    const edgeId = edgeIdFromTarget(event.target);
    if (edgeId) onEditEdgeLabel?.(edgeId);
  };

  const onSvgKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const textId = textIdFromTarget(event.target);
    const nodeId = nodeIdFromTarget(event.target);
    const edgeId = edgeIdFromTarget(event.target);
    if (textId && (event.key === 'Enter' || event.key === ' ')) {
      selectItem({ kind: 'text', id: textId });
      event.preventDefault();
    } else if (textId && event.key === 'F2') {
      selectItem({ kind: 'text', id: textId });
      onEditText?.(textId);
      event.preventDefault();
    } else if (textId && (event.key === 'Delete' || event.key === 'Backspace')) {
      const text = model && mermaidEditableTexts(model).find((item) => item.id === textId);
      if (text?.deletable) onDeleteText?.(textId);
      event.preventDefault();
    } else if (nodeId && (event.key === 'Enter' || event.key === ' ')) {
      selectItem({ kind: 'node', id: nodeId });
      event.preventDefault();
    } else if (nodeId && (event.key === 'Delete' || event.key === 'Backspace')) {
      if (model && mermaidEditCapabilities(model).deleteNode) {
        onNodeAction?.('delete', nodeId);
      }
      event.preventDefault();
    } else if (edgeId && (event.key === 'Enter' || event.key === ' ')) {
      selectItem({ kind: 'edge', id: edgeId });
      event.preventDefault();
    } else if (edgeId && event.key === 'F2') {
      selectItem({ kind: 'edge', id: edgeId });
      onEditEdgeLabel?.(edgeId);
      event.preventDefault();
    } else if (edgeId && (event.key === 'Delete' || event.key === 'Backspace')) {
      onDisconnectEdge?.(edgeId);
      event.preventDefault();
    } else if (event.key === 'Escape') {
      selectItem(null);
    }
  };

  const adjustZoom = (delta: number) => {
    setViewMode('manual');
    setZoom((value) => Math.min(3, Math.max(0.02, Math.round((value + delta) * 100) / 100)));
  };

  const onPanMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2 || excludesCanvasPan(event.target, event.currentTarget)) return;
    setViewMode('manual');
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
  const editingText = renamingTextId !== null && renamingTextId === selectedTextId;
  const editCapabilities = model ? mermaidEditCapabilities(model) : null;
  const selectedText =
    model && selectedTextId
      ? (mermaidEditableTexts(model).find((text) => text.id === selectedTextId) ?? null)
      : null;

  const commitInlineLabel = () => {
    const committed = editingNodeLabel
      ? (onCommitRename?.(renamingNodeId, renameValue) ?? true)
      : editingEdgeLabel
        ? (onCommitEdgeLabel?.(renamingEdgeId, renameValue) ?? true)
        : editingText
          ? (onCommitText?.(renamingTextId, renameValue) ?? true)
          : true;
    if (!committed) {
      window.requestAnimationFrame(() => renameInputRef.current?.focus());
    }
  };

  return (
    <div
      className="squisq-mermaid-canvas"
      aria-label={`${diagramType} diagram editor`}
      style={{ background: theme.colors.backgroundLight, color: theme.colors.text }}
    >
      <SceneViewControls
        scale={zoom}
        fit={viewMode === 'fit'}
        onZoomOut={() => adjustZoom(-0.2)}
        onZoomIn={() => adjustZoom(0.2)}
        onFit={applyFit}
      />
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
              width: contentSize ? `${contentSize.width * zoom}px` : `${zoom * 100}%`,
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
            {selectionAnchor && (editingNodeLabel || editingEdgeLabel || editingText) && (
              <form
                className="squisq-mermaid-inline-rename"
                aria-label={
                  editingNodeLabel
                    ? 'Edit Mermaid node label'
                    : editingEdgeLabel
                      ? 'Edit Mermaid connection label'
                      : 'Edit Mermaid text'
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
                  required={editingNodeLabel || editingText}
                  spellCheck
                  aria-label={
                    editingNodeLabel
                      ? 'Mermaid node label'
                      : editingEdgeLabel
                        ? 'Mermaid connection label'
                        : 'Mermaid text'
                  }
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
                    else if (editingEdgeLabel) onCancelEdgeLabel?.();
                    else onCancelText?.();
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
                {editCapabilities?.renameNode && (
                  <CanvasAction
                    icon="fa-solid fa-pen"
                    label="Rename node"
                    onClick={() => onNodeAction?.('rename', selectedNodeId)}
                  />
                )}
                {editCapabilities?.shape && (
                  <CanvasAction
                    icon="fa-solid fa-shapes"
                    label="Change shape"
                    onClick={() => onNodeAction?.('shape', selectedNodeId)}
                  />
                )}
                {editCapabilities?.duplicateNode && (
                  <CanvasAction
                    icon="fa-solid fa-copy"
                    label="Duplicate node"
                    onClick={() => onNodeAction?.('duplicate', selectedNodeId)}
                  />
                )}
                {editCapabilities?.connect && (
                  <CanvasAction
                    icon="fa-solid fa-link"
                    label="Connect node"
                    onClick={() => onNodeAction?.('connect', selectedNodeId)}
                  />
                )}
                {editCapabilities?.deleteNode && (
                  <CanvasAction
                    icon="fa-solid fa-trash"
                    label="Delete node"
                    danger
                    onClick={() => onNodeAction?.('delete', selectedNodeId)}
                  />
                )}
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
                {editCapabilities?.edgeLabel && (
                  <CanvasAction
                    icon="fa-solid fa-pen"
                    label="Edit connection label"
                    onClick={() => onEditEdgeLabel?.(selectedEdgeId)}
                  />
                )}
                {editCapabilities?.disconnect && (
                  <CanvasAction
                    icon="fa-solid fa-link-slash"
                    label="Disconnect nodes"
                    danger
                    onClick={() => onDisconnectEdge?.(selectedEdgeId)}
                  />
                )}
              </div>
            )}
            {selectionAnchor && selectedTextId && renamingTextId !== selectedTextId && (
              <div
                className="squisq-mermaid-selection-actions"
                role="toolbar"
                aria-label="Selected Mermaid text actions"
                data-placement={selectionAnchor.placement}
                style={{ left: selectionAnchor.left, top: selectionAnchor.top }}
                onClick={(event) => event.stopPropagation()}
              >
                <CanvasAction
                  icon="fa-solid fa-pen"
                  label="Edit text"
                  onClick={() => onEditText?.(selectedTextId)}
                />
                {selectedText?.deletable && (
                  <CanvasAction
                    icon="fa-solid fa-trash"
                    label={
                      selectedText.target === 'node'
                        ? 'Delete node'
                        : selectedText.target === 'edge'
                          ? 'Remove label'
                          : 'Delete text'
                    }
                    danger
                    onClick={() => onDeleteText?.(selectedTextId)}
                  />
                )}
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
