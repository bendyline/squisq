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

import { useCallback, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { TreeNode } from '@bendyline/squisq/doc';
import { Icon } from '../Icon';
import { useTreeViewData } from './treeViewData';
import { applyTreeCommand, type TreeCommand } from './treeViewCommands';

interface TreeOutlineWidgetProps {
  editor: Editor;
  blockId: string;
  fallbackPos: number;
  host?: HTMLElement | null;
}

export function TreeOutlineWidget({ editor, blockId }: TreeOutlineWidgetProps) {
  const view = useTreeViewData(editor, blockId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

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
            toggleCollapse={toggleCollapse}
            dispatch={dispatch}
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
  toggleCollapse,
  dispatch,
}: {
  node: TreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  toggleCollapse: (id: string) => void;
  dispatch: (cmd: TreeCommand) => boolean;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isDir = node.isDir || hasChildren;
  const [draft, setDraft] = useState(node.label);

  const commit = () => {
    if (draft !== node.label && draft.trim().length > 0) {
      dispatch({ kind: 'renameItem', id: node.id, label: draft });
    }
  };

  return (
    <li role="treeitem" style={{ paddingLeft: `${depth * 18}px` }}>
      <div className="squisq-tree-row">
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
              toggleCollapse={toggleCollapse}
              dispatch={dispatch}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default TreeOutlineWidget;
