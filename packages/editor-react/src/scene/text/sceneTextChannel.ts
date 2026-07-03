/**
 * sceneTextChannel — a module singleton that bridges the canvas's inline
 * text editor (which renders in a **detached React root** created by the
 * Diagram/SceneBlock ProseMirror extensions, outside `<EditorProvider>`)
 * to the provider, so the top formatting toolbar can target it.
 *
 * The active textbox's `SceneTextOverlay` publishes its Tiptap editor here
 * on focus and clears it on blur/unmount; `EditorProvider` subscribes and
 * mirrors the handle into `activeSceneText`. Singleton because only one
 * canvas textbox can be focused at a time.
 */

import type { Editor as TiptapEditor } from '@tiptap/core';
import type { SceneTextLevel } from './sceneTextConfig';

export interface SceneTextHandle {
  editor: TiptapEditor;
  level: SceneTextLevel;
}

type Listener = (handle: SceneTextHandle | null) => void;

let current: SceneTextHandle | null = null;
const listeners = new Set<Listener>();

export const sceneTextChannel = {
  /** Publish (or clear with `null`) the focused canvas textbox editor. */
  set(handle: SceneTextHandle | null): void {
    current = handle;
    for (const listener of listeners) listener(handle);
  },
  get(): SceneTextHandle | null {
    return current;
  },
  /** Subscribe to handle changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
