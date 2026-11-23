/**
 * Keyboard handling on the editor shell root: the Ctrl/Cmd+Shift+1/2/3 view
 * shortcuts, and keeping a handled heading chord from reaching the host.
 */

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { EditorMode, EditorView } from './EditorContext';
import type { EditorHostMode } from './editorHostMode';
import { viewChoices } from './toolbar/viewChoices';

type ShellKeyHandler = (event: ReactKeyboardEvent<HTMLDivElement>) => void;

/** Handlers to spread onto the shell root. */
export interface ShellKeyboardHandlers {
  onKeyDownCapture: ShellKeyHandler;
  onKeyDown: ShellKeyHandler;
}

export interface ShellKeyboardOptions {
  editorMode: EditorMode;
  hostMode: EditorHostMode;
  showPlayTab: boolean;
  showViewTabs: boolean;
  setActiveView: (view: EditorView) => void;
}

export function useShellKeyboardShortcuts({
  editorMode,
  hostMode,
  showPlayTab,
  showViewTabs,
  setActiveView,
}: ShellKeyboardOptions): ShellKeyboardHandlers {
  // Capture view shortcuts before the editing surface sees them: Tiptap's
  // keymap can fall back from a shifted digit to its unshifted heading key.
  const onKeyDownCapture = useCallback<ShellKeyHandler>(
    (e) => {
      if ((!e.ctrlKey && !e.metaKey) || !e.shiftKey || e.altKey) return;
      // Shift changes event.key to !/@/# on common layouts; the digit's
      // physical code keeps Ctrl/Cmd+Shift+1/2/3 usable across layouts.
      const key = /^Digit[1-3]$/.test(e.code) ? e.code.slice(-1) : e.key;
      const view = key === '1' ? 'wysiwyg' : key === '2' ? 'raw' : key === '3' ? 'preview' : null;
      if (!view) return;
      // The shortcuts reach the views the View menu offers, and nothing where
      // it offers none (hidden view button, a chat composer, code mode).
      const views = viewChoices({ editorMode, hostMode, showPlayTab, showViewTabs });
      if (view === 'preview' ? !views.useViews : !views.editViews) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveView(view);
    },
    [editorMode, hostMode, setActiveView, showPlayTab, showViewTabs],
  );

  // Tiptap prevents the default for a handled heading chord. Keep that
  // event inside the editor so hosts such as VS Code cannot also use it
  // to switch editor groups after applying the heading.
  const onKeyDown = useCallback<ShellKeyHandler>((e) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      /^[1-6]$/.test(e.key) &&
      e.defaultPrevented
    ) {
      e.stopPropagation();
    }
  }, []);

  return { onKeyDownCapture, onKeyDown };
}
