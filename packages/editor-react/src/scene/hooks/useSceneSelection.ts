/**
 * useSceneSelection — selected layer ids + selection-modification API.
 *
 * v1 supports single and shift-additive selection. Marquee/box selection
 * is driven by SelectTool — it calls `setSelection` with the ids that
 * intersect the marquee rect.
 */

import { useCallback, useState } from 'react';

export interface UseSceneSelectionResult {
  /** Stable set of selected ids — referentially stable between renders unless changed. */
  selection: ReadonlySet<string>;
  /** Replace the selection. */
  setSelection: (ids: Iterable<string>) => void;
  /** Add `id` to the selection (or replace it when `additive=false`). */
  select: (id: string, additive?: boolean) => void;
  /** Toggle `id` in/out of the selection. */
  toggle: (id: string) => void;
  /** Clear all selection. */
  clear: () => void;
  /** Convenience: is this id currently selected? */
  isSelected: (id: string) => boolean;
}

export function useSceneSelection(initial: Iterable<string> = []): UseSceneSelectionResult {
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(() => new Set(initial));

  const setSelection = useCallback((ids: Iterable<string>) => {
    setSelectionState(new Set(ids));
  }, []);

  const select = useCallback((id: string, additive = false) => {
    setSelectionState((prev) => {
      if (additive) {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      }
      if (prev.size === 1 && prev.has(id)) return prev;
      return new Set([id]);
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectionState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectionState((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const isSelected = useCallback((id: string) => selection.has(id), [selection]);

  return { selection, setSelection, select, toggle, clear, isSelected };
}
