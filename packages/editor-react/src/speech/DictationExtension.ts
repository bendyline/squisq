/**
 * The Write view's interim dictation indicator.
 *
 * While dictation is listening or transcribing, a small widget sits at the
 * caret — exactly where the next phrase will land — so the author can see that
 * speech is being heard without the document changing. It is a ProseMirror
 * WIDGET decoration, never content: it does not touch the document, fire
 * `onChange`, or enter undo history, and `getHTML()` never sees it.
 *
 * Modelled on `review/ReviewExtension.ts`: registered unconditionally with its
 * own plugin key and inert until fed through `setMeta`. Unlike review marks the
 * widget is not mapped through edits — it is rebuilt from the live selection on
 * every state, so it follows the caret wherever the user moves it.
 */

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface DictationInterimState {
  label: string | null;
}

const DICTATION_KEY = new PluginKey<DictationInterimState>('squisq-dictation-interim');

/** Class on the Write-view widget (and, with a modifier, the Source-view text). */
export const DICTATION_INTERIM_CLASS = 'squisq-dictation-interim';

function interimElement(doc: Document, label: string): HTMLElement {
  const span = doc.createElement('span');
  span.className = DICTATION_INTERIM_CLASS;
  span.setAttribute('contenteditable', 'false');
  // The toolbar button owns the live-region announcements; this is visual.
  span.setAttribute('aria-hidden', 'true');
  span.dataset.squisqDictation = 'interim';
  span.textContent = label;
  return span;
}

/** Write-view interim dictation widget. Registered unconditionally; inert until fed. */
export const DictationExtension = Extension.create({
  name: 'squisqDictation',

  addProseMirrorPlugins() {
    return [
      new Plugin<DictationInterimState>({
        key: DICTATION_KEY,
        state: {
          init: () => ({ label: null }),
          apply: (transaction, previous) =>
            (transaction.getMeta(DICTATION_KEY) as DictationInterimState | undefined) ?? previous,
        },
        props: {
          decorations: (state) => {
            const label = DICTATION_KEY.getState(state)?.label;
            if (!label) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                state.selection.to,
                (view) => interimElement(view.dom.ownerDocument, label),
                {
                  // Same key ⇒ ProseMirror reuses the DOM node as the caret moves.
                  key: `squisq-dictation:${label}`,
                  // Drawn after the caret, so typed or dictated text lands before it.
                  side: 1,
                  ignoreSelection: true,
                },
              ),
            ]);
          },
        },
      }),
    ];
  },
});

/** The interim label currently shown in a Write-view state, or null. */
export function dictationInterimLabel(state: EditorState): string | null {
  return DICTATION_KEY.getState(state)?.label ?? null;
}

/**
 * Show (`label`) or hide (`null`) the interim widget. A no-op on a destroyed
 * editor, on one without the extension, or when nothing would change — so
 * callers can push the current label freely.
 */
export function setDictationInterim(editor: Editor, label: string | null): void {
  if (editor.isDestroyed || !editor.state) return;
  const current = DICTATION_KEY.getState(editor.state);
  if (!current || current.label === label) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(DICTATION_KEY, { label } satisfies DictationInterimState)
      .setMeta('addToHistory', false),
  );
}
