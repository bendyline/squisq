/**
 * The Source view's interim dictation indicator: injected `after:` text at the
 * caret, through a decorations collection. Injected text is rendered by
 * Monaco but is not part of the model — the document, `onChange` and the undo
 * stack never see it. It follows the caret while shown.
 */

import type { IDisposable, editor as MonacoEditorNs } from 'monaco-editor';
import { DICTATION_INTERIM_CLASS } from './DictationExtension.js';

type MonacoEditor = MonacoEditorNs.IStandaloneCodeEditor;

export interface MonacoDictationInterim {
  /** Show (`label`) or hide (`null`) the indicator. */
  update(label: string | null): void;
  /** Remove the indicator and stop following the caret. */
  dispose(): void;
}

export function createMonacoDictationInterim(editor: MonacoEditor): MonacoDictationInterim {
  const collection = editor.createDecorationsCollection();
  let label: string | null = null;
  let cursorListener: IDisposable | null = null;

  const render = () => {
    const selection = editor.getSelection();
    if (!label || !selection) {
      collection.clear();
      return;
    }
    const lineNumber = selection.endLineNumber;
    const column = selection.endColumn;
    collection.set([
      {
        range: {
          startLineNumber: lineNumber,
          startColumn: column,
          endLineNumber: lineNumber,
          endColumn: column,
        },
        options: {
          showIfCollapsed: true,
          after: {
            content: label,
            inlineClassName: `${DICTATION_INTERIM_CLASS} ${DICTATION_INTERIM_CLASS}--source`,
          },
        },
      },
    ]);
  };

  const safely = (action: () => void) => {
    try {
      action();
    } catch {
      // The editor was disposed under us (a view switch) — nothing to clean.
    }
  };

  return {
    update(next) {
      label = next;
      safely(() => {
        if (label && !cursorListener) cursorListener = editor.onDidChangeCursorSelection(render);
        if (!label && cursorListener) {
          cursorListener.dispose();
          cursorListener = null;
        }
        render();
      });
    },
    dispose() {
      label = null;
      safely(() => {
        cursorListener?.dispose();
        cursorListener = null;
        collection.clear();
      });
    },
  };
}
