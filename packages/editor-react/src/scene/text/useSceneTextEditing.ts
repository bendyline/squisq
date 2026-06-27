/**
 * useSceneTextEditing — Scene-level state for "which layer is being text
 * edited". The Scene wires `begin` into the tool context (`beginTextEdit`)
 * so SelectTool's double-click can open the editor, and renders
 * `<SceneTextOverlay>` while `editingId` is set.
 */

import { useCallback, useRef, useState } from 'react';
import type { SceneTextEditConfig } from './sceneTextConfig';

export interface SceneTextEditing {
  /** The editable layer id currently being edited, or null. */
  editingId: string | null;
  /** Open the editor for the layer the pointer hit (resolved via config). */
  begin: (hitLayerId: string) => void;
  /** Close the editor (after commit/cancel). */
  close: () => void;
  /** Ref mirror of whether an edit is active — for non-React event handlers. */
  activeRef: React.MutableRefObject<boolean>;
}

export function useSceneTextEditing(config?: SceneTextEditConfig): SceneTextEditing {
  const [editingId, setEditingId] = useState<string | null>(null);
  const activeRef = useRef(false);
  activeRef.current = editingId != null;

  const begin = useCallback(
    (hitLayerId: string) => {
      if (!config) return;
      const id = config.resolveEditableId(hitLayerId);
      if (id) setEditingId(id);
    },
    [config],
  );

  const close = useCallback(() => setEditingId(null), []);

  return { editingId, begin, close, activeRef };
}
