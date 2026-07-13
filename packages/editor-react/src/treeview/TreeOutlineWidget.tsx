/**
 * TreeOutlineWidget — the interactive outline editor mounted below a hidden
 * ASCII tree fence. Reads the live tree via `useTreeViewData` and writes
 * every structural edit back as regenerated tree art via `applyTreeCommand`
 * (op → render → verify → single-transaction fence rewrite).
 *
 * Manage-items UX: a toolbar (add file / add folder), inline-editable
 * labels, per-row controls (add child, indent/outdent, move up/down,
 * folder⇄file, delete), and collapse chevrons (widget-local, not
 * persisted). Enter in a label adds a sibling; Backspace on an empty label
 * deletes it.
 */

import { type DragEvent as ReactDragEvent, useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { TreeNode } from '@bendyline/squisq/doc';
import { Icon } from '../Icon';
import { useTreeViewData } from './treeViewData';
import { applyTreeCommand, type TreeCommand } from './treeViewCommands';
import type { TreeDropPosition } from './treeOps';

interface TreeOutlineWidgetProps {
  editor: Editor;
  blockId: string;
  fallbackPos: number;
  host?: HTMLElement | null;
}

interface TreeDropTarget {
  id: string;
  position: TreeDropPosition;
}

const TREE_DRAG_MIME = 'application/x-squisq-tree-node';

function findNode(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}

function nodeContains(node: TreeNode, id: string): boolean {
  return node.id === id || node.children.some((child) => nodeContains(child, id));
}

function canDropNode(nodes: readonly TreeNode[], sourceId: string, targetId: string): boolean {
  const source = findNode(nodes, sourceId);
  return source != null && !nodeContains(source, targetId);
}

function dropPositionForPointer(event: ReactDragEvent<HTMLElement>): TreeDropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.height <= 0) return 'child';
  const ratio = (event.clientY - rect.top) / rect.height;
  if (ratio < 0.3) return 'before';
  if (ratio > 0.7) return 'after';
  return 'child';
}

export function TreeOutlineWidget({ editor, blockId }: TreeOutlineWidgetProps) {
  const view = useTreeViewData(editor, blockId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const activeDragRef = useRef<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);

  const dispatch = useCallback(
    (cmd: TreeCommand) => applyTreeCommand(editor, blockId, cmd),
    [editor, blockId],
  );
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearDragState = useCallback(() => {
    activeDragRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  const handleDragStart = useCallback((event: ReactDragEvent<HTMLElement>, id: string) => {
    event.stopPropagation();
    activeDragRef.current = id;
    setDraggedId(id);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox requires a text payload before it starts a native drag.
    event.dataTransfer.setData(TREE_DRAG_MIME, id);
    event.dataTransfer.setData('text/plain', id);
  }, []);

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetId: string) => {
      const sourceId = activeDragRef.current;
      if (!sourceId) return;
      event.preventDefault();
      event.stopPropagation();

      if (!view || !canDropNode(view.tree.roots, sourceId, targetId)) {
        event.dataTransfer.dropEffect = 'none';
        setDropTarget(null);
        return;
      }

      const position = dropPositionForPointer(event);
      event.dataTransfer.dropEffect = 'move';
      setDropTarget((current) =>
        current?.id === targetId && current.position === position
          ? current
          : { id: targetId, position },
      );
    },
    [view],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetId: string) => {
      const sourceId = activeDragRef.current;
      if (!sourceId) return;
      event.preventDefault();
      event.stopPropagation();
      const position = dropPositionForPointer(event);
      const canMove = view && canDropNode(view.tree.roots, sourceId, targetId);

      clearDragState();
      if (!canMove) return;
      const moved = dispatch({ kind: 'moveItem', id: sourceId, targetId, position });
      if (moved && position === 'child') {
        // Make the result visible when a node is dropped into a collapsed row.
        setCollapsed((current) => {
          if (!current.has(targetId)) return current;
          const next = new Set(current);
          next.delete(targetId);
          return next;
        });
      }
    },
    [clearDragState, dispatch, view],
  );

  if (!view) return null;
  const roots = view.tree.roots;
  const firstRootId = roots[0]?.id;

  return (
    <div className="squisq-tree-outline">
      <div className="squisq-tree-toolbar">
        <button
          type="button"
          className="squisq-tree-btn"
          title="Add file"
          disabled={!firstRootId}
          onClick={() =>
            firstRootId
              ? dispatch({ kind: 'addItem', targetId: firstRootId, position: 'siblingAfter' })
              : undefined
          }
        >
          <Icon icon="fa-solid fa-plus" /> Item
        </button>
        <button
          type="button"
          className="squisq-tree-btn"
          title="Add folder"
          disabled={!firstRootId}
          onClick={() =>
            firstRootId
              ? dispatch({
                  kind: 'addItem',
                  targetId: firstRootId,
                  position: 'siblingAfter',
                  isDir: true,
                })
              : undefined
          }
        >
          <Icon icon="fa-solid fa-folder-plus" /> Folder
        </button>
      </div>

      <ul className="squisq-tree-rows" role="tree">
        {roots.map((node) => (
          <TreeRowView
            key={node.id}
            node={node}
            depth={0}
            collapsed={collapsed}
            draggedId={draggedId}
            dropTarget={dropTarget}
            toggleCollapse={toggleCollapse}
            dispatch={dispatch}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={clearDragState}
          />
        ))}
      </ul>

      {view.warnings.length > 0 ? (
        <div className="squisq-tree-warnings">
          {view.warnings.length} parser note{view.warnings.length === 1 ? '' : 's'}
        </div>
      ) : null}
    </div>
  );
}

function TreeRowView({
  node,
  depth,
  collapsed,
  draggedId,
  dropTarget,
  toggleCollapse,
  dispatch,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  node: TreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  draggedId: string | null;
  dropTarget: TreeDropTarget | null;
  toggleCollapse: (id: string) => void;
  dispatch: (cmd: TreeCommand) => boolean;
  onDragStart: (event: ReactDragEvent<HTMLElement>, id: string) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>, id: string) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>, id: string) => void;
  onDragEnd: () => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isDir = node.isDir || hasChildren;
  const [draft, setDraft] = useState(node.label);
  const dropPosition = dropTarget?.id === node.id ? dropTarget.position : null;
  const itemClassName = [
    'squisq-tree-item',
    draggedId === node.id ? 'squisq-tree-item--dragging' : '',
    dropPosition ? `squisq-tree-item--drop-${dropPosition}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const commit = () => {
    if (draft !== node.label && draft.trim().length > 0) {
      dispatch({ kind: 'renameItem', id: node.id, label: draft });
    }
  };

  return (
    <li className={itemClassName} role="treeitem" style={{ paddingLeft: `${depth * 18}px` }}>
      <div
        className="squisq-tree-row"
        onDragOver={(event) => onDragOver(event, node.id)}
        onDrop={(event) => onDrop(event, node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="squisq-tree-chevron"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={() => toggleCollapse(node.id)}
          >
            <Icon icon={`fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`} />
          </button>
        ) : (
          <span className="squisq-tree-chevron squisq-tree-chevron--empty" />
        )}
        <button
          type="button"
          className="squisq-tree-icon"
          title={isDir ? 'Make a file' : 'Make a folder'}
          onClick={() => dispatch({ kind: 'toggleDir', id: node.id })}
        >
          <Icon icon={`fa-solid ${isDir ? 'fa-folder' : 'fa-file'}`} />
        </button>
        <input
          className="squisq-tree-label"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              dispatch({ kind: 'addItem', targetId: node.id, position: 'siblingAfter' });
            } else if (e.key === 'Backspace' && draft.length === 0) {
              e.preventDefault();
              dispatch({ kind: 'removeItem', id: node.id });
            } else if (e.key === 'Tab') {
              // Structural indent/outdent operate on the committed label's id;
              // commit the draft first so no typing is lost.
              e.preventDefault();
              commit();
              dispatch({ kind: e.shiftKey ? 'outdentItem' : 'indentItem', id: node.id });
            }
          }}
        />
        <span className="squisq-tree-controls">
          <span
            className="squisq-tree-drag-handle"
            draggable
            aria-hidden="true"
            title={`Drag ${node.label} to move`}
            onDragStart={(event) => onDragStart(event, node.id)}
            onDragEnd={onDragEnd}
          >
            <Icon icon="fa-solid fa-grip-vertical" />
          </span>
          <button
            type="button"
            title="Add child"
            onClick={() => dispatch({ kind: 'addItem', targetId: node.id, position: 'child' })}
          >
            <Icon icon="fa-solid fa-plus" />
          </button>
          <button
            type="button"
            title="Outdent"
            onClick={() => dispatch({ kind: 'outdentItem', id: node.id })}
          >
            <Icon icon="fa-solid fa-outdent" />
          </button>
          <button
            type="button"
            title="Indent"
            onClick={() => dispatch({ kind: 'indentItem', id: node.id })}
          >
            <Icon icon="fa-solid fa-indent" />
          </button>
          <button
            type="button"
            title="Move up"
            onClick={() => dispatch({ kind: 'moveItemUp', id: node.id })}
          >
            <Icon icon="fa-solid fa-arrow-up" />
          </button>
          <button
            type="button"
            title="Move down"
            onClick={() => dispatch({ kind: 'moveItemDown', id: node.id })}
          >
            <Icon icon="fa-solid fa-arrow-down" />
          </button>
          <button
            type="button"
            title="Delete"
            className="squisq-tree-delete"
            onClick={() => dispatch({ kind: 'removeItem', id: node.id })}
          >
            <Icon icon="fa-solid fa-trash" />
          </button>
        </span>
      </div>
      {hasChildren && !isCollapsed ? (
        <ul className="squisq-tree-rows" role="group">
          {node.children.map((child) => (
            <TreeRowView
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              draggedId={draggedId}
              dropTarget={dropTarget}
              toggleCollapse={toggleCollapse}
              dispatch={dispatch}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default TreeOutlineWidget;
