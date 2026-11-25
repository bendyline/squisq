/**
 * UndoRedoButtons
 *
 * Undo and Redo for the Write view, in its Write, Blocks and Timeline
 * layouts. ProseMirror's history records steps, not named actions, so there
 * is no list of edits to offer — just the two buttons, each disabled while
 * its stack is empty. On a touch screen there is no ⌘Z, so these are the
 * only way back there; they lead the controls and never fold into ···.
 *
 * Like the formatting buttons they act on the editor that has the text: a
 * canvas textbox (a diagram label) while one is being edited, otherwise the
 * document.
 *
 * Its own module because Toolbar.tsx is at its line budget; it reads what it
 * needs from the editor context, as DictationButton does.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import { useEditorContext } from '../EditorContext';
import { Icon } from '../Icon';
import { platformShortcut } from '../platformShortcuts';
import { replacesWriteSurface } from '../writeModes';

const CAN_UNDO = 1;
const CAN_REDO = 2;

/** What the editor's history allows right now, as a stable number. */
function historyFlags(editor: Editor | null): number {
  if (!editor || editor.isDestroyed || !editor.isEditable) return 0;
  const { state } = editor;
  return (undoDepth(state) > 0 ? CAN_UNDO : 0) | (redoDepth(state) > 0 ? CAN_REDO : 0);
}

function useHistoryFlags(editor: Editor | null): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!editor) return () => undefined;
      // Every history change is a transaction; `setEditable` emits `update`.
      editor.on('transaction', notify);
      editor.on('update', notify);
      return () => {
        editor.off('transaction', notify);
        editor.off('update', notify);
      };
    },
    [editor],
  );
  const snapshot = useCallback(() => historyFlags(editor), [editor]);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

export function UndoRedoButtons() {
  const { activeView, layoutMode, findMode, editorMode, tiptapEditor, activeSceneText } =
    useEditorContext();
  const editor = activeSceneText?.editor ?? tiptapEditor;
  const flags = useHistoryFlags(editor);

  // Write layouts only: Summarize hides the editor, Find replaces the row.
  const shown =
    editor !== null &&
    activeView === 'wysiwyg' &&
    !replacesWriteSurface(layoutMode) &&
    editorMode === 'markdown' &&
    !findMode;
  if (!shown) return null;

  const step = (redo: boolean) => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const chain = editor.chain().focus();
    (redo ? chain.redo() : chain.undo()).run();
  };
  const undoLabel = `Undo (${platformShortcut('Z')})`;
  const redoLabel = `Redo (${platformShortcut('Shift+Z')})`;

  return (
    <div className="squisq-toolbar-group squisq-toolbar-history" role="group" aria-label="History">
      <button
        type="button"
        className="squisq-toolbar-button"
        data-toolbar-item="undo"
        data-tooltip={undoLabel}
        aria-label="Undo"
        disabled={(flags & CAN_UNDO) === 0}
        onClick={() => step(false)}
      >
        <Icon icon="fa-solid fa-arrow-rotate-left" />
      </button>
      <button
        type="button"
        className="squisq-toolbar-button"
        data-toolbar-item="redo"
        data-tooltip={redoLabel}
        aria-label="Redo"
        disabled={(flags & CAN_REDO) === 0}
        onClick={() => step(true)}
      >
        <Icon icon="fa-solid fa-arrow-rotate-right" />
      </button>
      <div className="squisq-toolbar-separator" />
    </div>
  );
}
