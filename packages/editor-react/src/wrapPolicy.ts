/**
 * Write-view wrap policy — "unwrap in Write view, persist with wrapping".
 *
 * The Tiptap bridge maps each physical source line to its own paragraph, so
 * a hard-wrapped document renders as choppy one-line paragraphs in Write
 * view — and the first edit serializes that chopped structure back into the
 * source. These helpers make the wrap convention transparent instead:
 * detect the document's prevailing wrap state, hand Tiptap the UNWRAPPED
 * body (prose flows naturally), and re-apply the detected convention when
 * serializing back to markdown. The exact same shape as WysiwygEditor's
 * frontmatter strip/reattach dance, applied to wrapping.
 *
 * Pure string logic (no Tiptap, no DOM) so it stays Node-testable.
 */

import {
  detectMarkdownWrapState,
  unwrapMarkdownSource,
  wrapMarkdownSource,
} from '@bendyline/squisq/markdown';
import type { MarkdownWrapState } from '@bendyline/squisq/markdown';

export interface WrapPolicyIngest {
  /** Body to hand to the Write view (unwrapped when the doc is wrapped). */
  displayBody: string;
  /**
   * The detected wrap state to persist with, or null when the document has
   * no confident wrap convention (unwrapped / mixed / no prose) — persist
   * is then a pass-through.
   */
  state: MarkdownWrapState | null;
}

/**
 * Prepare a markdown body (frontmatter already stripped) for Write-view
 * editing. Only a confident `wrapped` detection unwraps; `mixed`,
 * `unwrapped`, and `no-prose` documents pass through untouched, so docs
 * without a convention behave exactly as before.
 */
export function ingestForWrite(body: string): WrapPolicyIngest {
  const state = detectMarkdownWrapState(body);
  if (state.kind !== 'wrapped' || !state.width) {
    return { displayBody: body, state: null };
  }
  // Non-strict: if the unwrap engine declines (structural-equivalence
  // guard), the body passes through unchanged and editing stays literal.
  const displayBody = unwrapMarkdownSource(body);
  return { displayBody, state };
}

/**
 * Re-apply the detected wrap convention to a body serialized from the
 * Write view. Pass-through when there is no wrapped state; on a degraded
 * wrap (safety guard) the unwrapped body is persisted instead — a valid
 * document that merely loses the convention for that save.
 */
export function persistFromWrite(bodyMd: string, state: MarkdownWrapState | null): string {
  if (!state || state.kind !== 'wrapped' || !state.width) return bodyMd;
  return wrapMarkdownSource(bodyMd, { width: state.width });
}
