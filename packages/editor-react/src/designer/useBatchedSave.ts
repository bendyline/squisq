/**
 * Items accepted during an AI run, saved in batches: each save rewrites the
 * document and is an undo step, so suggestions are not saved one by one.
 * A batch is saved when it reaches `size` items or `ms` after its first,
 * whichever comes first, and whatever is left is saved when the run ends or
 * the designer goes away.
 */
import { useEffect, useRef, useState } from 'react';

/** Batches of this many, or after this long, whichever is first. */
export const DESIGNER_BATCH_SIZE = 10;
export const DESIGNER_BATCH_MS = 5000;

export interface BatchedSave<T> {
  /** Accepted but not yet saved, for showing them before the save. */
  pending: T[];
  /** Accept one item; it is saved with its batch. */
  add: (item: T) => void;
  /** Save whatever is pending now. */
  flush: () => void;
  /** Forget what is pending without saving it. */
  clear: () => void;
}

export function useBatchedSave<T>(
  save: (items: T[]) => void,
  size = DESIGNER_BATCH_SIZE,
  ms = DESIGNER_BATCH_MS,
): BatchedSave<T> {
  const [pending, setPending] = useState<T[]>([]);
  const pendingRef = useRef<T[]>([]);
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRef = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const items = pendingRef.current;
    if (!items.length) return;
    pendingRef.current = [];
    saveRef.current(items);
    setPending([]);
  });

  // Leaving the designer saves what was accepted.
  useEffect(() => () => flushRef.current(), []);

  return {
    pending,
    add: (item) => {
      pendingRef.current = [...pendingRef.current, item];
      setPending(pendingRef.current);
      if (pendingRef.current.length >= size) flushRef.current();
      else if (!timer.current)
        timer.current = setTimeout(() => {
          timer.current = null;
          flushRef.current();
        }, ms);
    },
    flush: () => flushRef.current(),
    clear: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pendingRef.current = [];
      setPending([]);
    },
  };
}
