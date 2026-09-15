/**
 * Where a review finding is drawn, in each surface.
 *
 * The two surfaces differ in a way that matters. A review finding's offsets
 * index the markdown **source**, which is exactly what Monaco shows — so the
 * Source view is a direct mapping. The Write view renders a ProseMirror
 * document whose text differs from the source (frontmatter is stripped, prose
 * may be rewrapped, markup is marks rather than characters), and there is no
 * published mapping from a source offset back to a ProseMirror position.
 *
 * So the Write view anchors on the finding's own text instead, and only when
 * that text appears exactly once. Anchoring on an ambiguous match would put a
 * mark on a different paragraph than the one reviewed, which is worse than
 * drawing nothing: the panel still lists the finding, and the host can offer
 * Source view to act on it.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import type { ReviewFinding } from '@bendyline/squisq/review';
import type { ReviewHue } from './types.js';

/** One squiggle to draw in the Write view, in absolute ProseMirror positions. */
export interface ReviewDecorationSpec {
  findingId: string;
  source: string;
  hue: ReviewHue;
  from: number;
  to: number;
}

/** The class pair every review mark carries. */
export function reviewUnderlineClass(hue: ReviewHue): string {
  return `squisq-review-underline squisq-review-underline--${hue}`;
}

/**
 * Locate a finding in a ProseMirror document by its own text.
 *
 * Returns null when the text is absent or appears more than once. Ambiguity is
 * treated as absence deliberately — see the module note.
 */
export function findUniqueTextRange(
  doc: ProseMirrorNode,
  text: string,
): { from: number; to: number } | null {
  if (text.length === 0) return null;
  const matches: Array<{ from: number; to: number }> = [];

  doc.descendants((node, pos) => {
    if (!node.isText || typeof node.text !== 'string') return true;
    let index = node.text.indexOf(text);
    while (index !== -1) {
      matches.push({ from: pos + index, to: pos + index + text.length });
      // Two matches is already ambiguous; counting the rest changes nothing.
      if (matches.length > 1) return false;
      index = node.text.indexOf(text, index + 1);
    }
    return true;
  });

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** Write-view decorations for the findings whose text can be located exactly. */
export function buildWriteViewDecorations(
  doc: ProseMirrorNode,
  findings: readonly ReviewFinding[],
  hueFor: (source: string) => ReviewHue,
): ReviewDecorationSpec[] {
  const specs: ReviewDecorationSpec[] = [];
  for (const finding of findings) {
    const range = findUniqueTextRange(doc, finding.originalText);
    if (!range) continue;
    specs.push({
      findingId: finding.id,
      source: finding.source,
      hue: hueFor(finding.source),
      from: range.from,
      to: range.to,
    });
  }
  return specs;
}

/**
 * Source-view decorations. Offsets map straight through, because the finding
 * and the model index the same string.
 */
export function buildSourceViewDecorations(
  model: MonacoEditorNs.ITextModel,
  findings: readonly ReviewFinding[],
  hueFor: (source: string) => ReviewHue,
): MonacoEditorNs.IModelDeltaDecoration[] {
  const total = model.getValueLength();
  const decorations: MonacoEditorNs.IModelDeltaDecoration[] = [];
  for (const finding of findings) {
    // A provider that reported against a stale document can produce offsets
    // past the end. Skipping beats letting Monaco clamp them onto whatever
    // text now occupies that position.
    if (finding.start >= finding.end || finding.end > total) continue;
    const start = model.getPositionAt(finding.start);
    const end = model.getPositionAt(finding.end);
    decorations.push({
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      options: {
        inlineClassName: reviewUnderlineClass(hueFor(finding.source)),
        hoverMessage: { value: reviewHoverMarkdown(finding) },
        // NeverGrowsWhenTypingAtEdges: typing at a mark's edge belongs to the
        // surrounding text, not to the finding.
        stickiness: 1,
      },
    });
  }
  return decorations;
}

/** The hover card body for one finding. */
export function reviewHoverMarkdown(finding: ReviewFinding): string {
  const lines = [finding.message];
  if (finding.rationale) lines.push('', finding.rationale);
  if (finding.suggestions.length > 0) {
    lines.push('', ...finding.suggestions.map((s) => `- ${s.label ?? suggestionLabel(s.kind)}`));
  }
  return lines.join('\n');
}

function suggestionLabel(kind: string): string {
  if (kind === 'remove') return 'Remove';
  if (kind === 'insertAfter') return 'Insert after';
  if (kind === 'replaceBlock') return 'Rewrite this block';
  return 'Replace';
}
