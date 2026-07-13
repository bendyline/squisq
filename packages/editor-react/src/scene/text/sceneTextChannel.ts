/**
 * sceneTextChannel — an editor-owned channel that bridges the canvas's inline
 * text editor (which renders in a **detached React root** created by the
 * Diagram/SceneBlock ProseMirror extensions, outside `<EditorProvider>`)
 * to the provider, so the top formatting toolbar can target it.
 *
 * The active textbox's `SceneTextOverlay` publishes its Tiptap editor here
 * on focus and clears it on blur/unmount; `EditorProvider` subscribes and
 * mirrors the handle into `activeSceneText`. Each EditorProvider creates its
 * own channel, preventing focus in one editor from mutating another editor.
 */

import type { Editor as TiptapEditor } from '@tiptap/core';
import type { SceneTextLevel } from './sceneTextConfig';

export interface SceneTextHandle {
  editor: TiptapEditor;
  level: SceneTextLevel;
}

type Listener = (handle: SceneTextHandle | null) => void;

export interface SceneTextChannel {
  set(handle: SceneTextHandle | null): void;
  get(): SceneTextHandle | null;
  subscribe(listener: Listener): () => void;
}

/** Create a channel owned by one EditorProvider; no cross-editor singleton. */
export function createSceneTextChannel(): SceneTextChannel {
  let current: SceneTextHandle | null = null;
  const listeners = new Set<Listener>();
  return {
    set(handle) {
      current = handle;
      for (const listener of listeners) listener(handle);
    },
    get() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
