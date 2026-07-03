/**
 * useBlockNavigator
 *
 * Standalone hook powering the block-at-a-time editing view. Given a
 * `(source, setSource)` pair it slices the markdown into blocks (via
 * `blockRange.ts`), tracks which block is active, and exposes a derived
 * **content channel** (`editorSource` / `setEditorSource`) plus navigation.
 *
 * It depends only on its arguments — no `EditorContext`, no `EditorShell` —
 * so any host (an embedded single-block editor, a chat composer, a review
 * surface) can drive a block-at-a-time UI by calling it directly.
 *
 * When `enabled` is false the channel is an identity passthrough: the editors
 * see and write the full source exactly as before.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  getBlockSlices,
  spliceBlock,
  lineToOffset,
  offsetToLine,
  sliceIndexAtOffset,
  type BlockSlice,
} from './blockRange';

export interface BlockNavigator {
  /** What the bound editor should show: the active slice (block mode) or the full source. */
  editorSource: string;
  /** What the bound editor writes through: splices back into the full source (block mode). */
  setEditorSource: (s: string) => void;
  /** Number of navigable blocks in the current source. */
  blockCount: number;
  /** Index of the active block (clamped into range). */
  activeBlockKey: number;
  /** Jump to a block by index (clamped). */
  goToBlock: (key: number) => void;
  /**
   * Select the block that owns a given 1-based source line — used by the
   * outline, which knows a heading's source line but not its slice index
   * (slice order includes the optional preamble, so it needn't match
   * `flattenBlocks` order).
   */
  goToBlockByLine: (line: number) => void;
  /** 1-based source line where the active block begins (for outline highlight). */
  activeBlockStartLine: number | null;
  /** Move to the previous block (no-op at the start). */
  prevBlock: () => void;
  /** Move to the next block (no-op at the end). */
  nextBlock: () => void;
  /** Insert a new heading-defined block after the active one and move to it. */
  addBlock: () => void;
}

export interface UseBlockNavigatorOptions {
  /**
   * When false (the default), the channel passes through to the full source
   * and navigation is inert. Hosts flip this on to enter block-at-a-time mode.
   */
  enabled?: boolean;
}

/** Heading inserted by {@link BlockNavigator.addBlock}. */
const NEW_BLOCK_MARKDOWN = '## New section\n\n';

export function useBlockNavigator(
  source: string,
  setSource: (s: string) => void,
  opts?: UseBlockNavigatorOptions,
): BlockNavigator {
  const enabled = opts?.enabled ?? false;

  // Slices are derived straight from the live `source`, not from any
  // debounced parse, so they're always consistent with what we splice into.
  const slices = useMemo<BlockSlice[]>(() => getBlockSlices(source), [source]);
  const blockCount = slices.length;

  const [rawKey, setRawKey] = useState(0);
  // Effective key is always in range even when the source shrank under us —
  // the state can lag a re-slice for a render, but derivations never read a
  // stale/out-of-bounds slice.
  const activeBlockKey = blockCount === 0 ? 0 : Math.min(Math.max(rawKey, 0), blockCount - 1);
  const active = slices[activeBlockKey] ?? null;

  const goToBlock = useCallback((key: number) => {
    setRawKey(key);
  }, []);
  const prevBlock = useCallback(() => {
    setRawKey(activeBlockKey - 1);
  }, [activeBlockKey]);
  const nextBlock = useCallback(() => {
    setRawKey(activeBlockKey + 1);
  }, [activeBlockKey]);
  const goToBlockByLine = useCallback(
    (line: number) => {
      const offset = lineToOffset(source, line);
      const idx = sliceIndexAtOffset(slices, offset);
      if (idx >= 0) setRawKey(idx);
    },
    [source, slices],
  );

  const activeBlockStartLine = active ? offsetToLine(source, active.range.startOffset) : null;

  const editorSource = enabled && active ? active.text : source;

  const setEditorSource = useCallback(
    (next: string) => {
      if (!enabled || !active) {
        setSource(next);
        return;
      }
      // Keep a blank line before the following block's heading so the splice
      // can't glue the edited block onto the next one (the editor may emit a
      // slice with no trailing newline).
      const hasFollowing = active.range.endOffset < source.length;
      const normalized = hasFollowing ? next.replace(/\s*$/, '') + '\n\n' : next;
      setSource(spliceBlock(source, active.range, normalized));
    },
    [enabled, active, source, setSource],
  );

  const addBlock = useCallback(() => {
    if (!active) {
      // Empty / heading-less doc — append a heading and select it.
      const base = source.replace(/\s*$/, '');
      setSource((base ? base + '\n\n' : '') + NEW_BLOCK_MARKDOWN);
      setRawKey(blockCount); // becomes the new last slice after re-slice
      return;
    }
    const insertAt = active.range.endOffset;
    const before = source.slice(0, insertAt);
    const after = source.slice(insertAt);
    const lead =
      before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    setSource(before + lead + NEW_BLOCK_MARKDOWN + after);
    // The new block sits immediately after the active one.
    setRawKey(activeBlockKey + 1);
  }, [active, source, setSource, activeBlockKey, blockCount]);

  return {
    editorSource,
    setEditorSource,
    blockCount,
    activeBlockKey,
    goToBlock,
    goToBlockByLine,
    activeBlockStartLine,
    prevBlock,
    nextBlock,
    addBlock,
  };
}
