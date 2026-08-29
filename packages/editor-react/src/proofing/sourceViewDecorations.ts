/**
 * Squiggle decorations for the Source (Monaco) view.
 *
 * The controller owns one `IEditorDecorationsCollection` per Monaco
 * instance (the `RawEditor` icon-glyph pattern) and replaces its
 * contents on every lint pass; Monaco shifts the ranges automatically
 * as the user types, so — like the Write view — click/apply resolution
 * always reads the collection's CURRENT ranges, never lint-time
 * offsets. Decorations are set in findings order, so index i in the
 * collection is finding i.
 */

import type { editor as MonacoEditorNs, IPosition } from 'monaco-editor';
import type { ProofFinding } from '@bendyline/squisq/proof';
import { proofHoverMarkdown } from './findingText';

/** Decoration options for one finding (shared by build + rebuild paths). */
export function proofDecorationOptions(
  finding: ProofFinding,
): MonacoEditorNs.IModelDecorationOptions {
  return {
    inlineClassName: `squisq-proof-underline squisq-proof-underline--${finding.category}`,
    // Monaco's own hover card is the Source view's tooltip — it shows
    // the same category / message / suggestions the Write view's
    // `ProofingTooltip` does.
    hoverMessage: { value: proofHoverMarkdown(finding) },
    // NeverGrowsWhenTypingAtEdges (1) — typing at a squiggle's edge
    // belongs to the surrounding text, not the finding.
    stickiness: 1,
  };
}

/**
 * Build delta decorations for a lint pass. Offsets in `findings` must
 * index the exact string `model.getValue()` returned for the pass.
 */
export function buildMonacoProofDecorations(
  model: MonacoEditorNs.ITextModel,
  findings: readonly ProofFinding[],
): MonacoEditorNs.IModelDeltaDecoration[] {
  return findings.map((finding) => {
    const start = model.getPositionAt(finding.start);
    const end = model.getPositionAt(finding.end);
    return {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      options: proofDecorationOptions(finding),
    };
  });
}

/**
 * Index of the finding whose current decoration range contains
 * `position`, or `null`. Decorations are index-aligned with the
 * findings list passed to {@link buildMonacoProofDecorations}.
 */
export function findingIndexAtPosition(
  collection: MonacoEditorNs.IEditorDecorationsCollection,
  count: number,
  position: IPosition,
): number | null {
  for (let index = 0; index < count; index += 1) {
    const range = collection.getRange(index);
    if (!range) continue;
    const afterStart =
      position.lineNumber > range.startLineNumber ||
      (position.lineNumber === range.startLineNumber && position.column >= range.startColumn);
    const beforeEnd =
      position.lineNumber < range.endLineNumber ||
      (position.lineNumber === range.endLineNumber && position.column <= range.endColumn);
    if (afterStart && beforeEnd) return index;
  }
  return null;
}
