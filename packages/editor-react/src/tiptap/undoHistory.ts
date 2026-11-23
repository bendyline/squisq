/**
 * undoHistory
 *
 * Start an editor's undo history over without touching its document.
 *
 * ProseMirror's history has no public "clear". It does adopt whatever
 * `historyState` an undo or redo transaction carries — that is how its own
 * commands install the stacks they computed — so a transaction with no steps
 * that carries the history plugin's freshly initialized state empties both
 * stacks and changes nothing else. The plugin's key is not exported; it is
 * found as the one plugin whose meta `isHistoryTransaction` recognizes.
 *
 * The transaction must carry no steps. Plugins append transactions only after
 * document changes, and an appended transaction with steps would be recorded
 * into the fresh history as part of an "undo".
 */

import { isHistoryTransaction } from '@tiptap/pm/history';
import type { EditorState, Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

function historyPlugin(state: EditorState): Plugin | undefined {
  return state.plugins.find((plugin) => isHistoryTransaction(state.tr.setMeta(plugin, true)));
}

/**
 * Empty the undo and redo stacks of the editor behind `view`. Returns false
 * when the editor has no undo history to reset.
 */
export function resetUndoHistory(view: EditorView): boolean {
  const plugin = historyPlugin(view.state);
  const field = plugin?.spec.state;
  if (!plugin || !field) return false;
  const historyState: unknown = field.init({}, view.state);
  view.dispatch(
    view.state.tr
      .setMeta(plugin, { redo: false, historyState })
      .setMeta('addToHistory', false)
      .setMeta('preventUpdate', true),
  );
  return true;
}
