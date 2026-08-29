/**
 * Write-view text extraction for proofing — a generalization of the
 * Find feature's textblock walk (`find/findModel.ts`).
 *
 * Walks the ProseMirror document collecting one plain-text run per
 * textblock, with a span table mapping run offsets back to absolute PM
 * positions. `codeBlock` subtrees are skipped entirely, which covers
 * every fence-backed family (code snippets, ASCII diagrams/trees/
 * timelines, mermaid) in one rule. Inline atoms (icons, mentions,
 * media) become NUL (`\u0000`) — verified inert to the proofing
 * engine; unlike a space it can never fake a word boundary or draw a
 * whitespace-formatting lint. Hard breaks become `\n`, which keeps
 * sentences apart while still letting the engine see across the break.
 *
 * Heading `{[template]}` annotations never appear here — they live in
 * node attributes, not text (`TemplateAnnotation.ts`).
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

interface RunSpan {
  /** Offset range within the run's text. */
  from: number;
  to: number;
  /** Absolute PM position of the span's first character. */
  docFrom: number;
}

export interface TextblockRun {
  /** Plain text of one textblock (atoms → NUL, hardBreak → `\n`). */
  text: string;
  /** Text-offset → PM-position mapping, in ascending order. */
  spans: RunSpan[];
}

/** Collect prose textblock runs, skipping code blocks. */
export function collectTextblockRuns(doc: ProseMirrorNode): TextblockRun[] {
  const runs: TextblockRun[] = [];

  doc.descendants((node, pos) => {
    // One rule covers every fence family: they are all `codeBlock`
    // nodes under the hood (snippet/diagram/tree/timeline/mermaid).
    if (node.type.name === 'codeBlock') return false;
    if (!node.isTextblock) return true;

    const spans: RunSpan[] = [];
    let text = '';
    node.descendants((child, offset) => {
      if (child.isText && child.text) {
        const from = text.length;
        text += child.text;
        spans.push({ from, to: text.length, docFrom: pos + 1 + offset });
      } else if (child.isInline) {
        text += child.type.name === 'hardBreak' ? '\n' : '\u0000';
      }
      return true;
    });

    runs.push({ text, spans });
    return false;
  });

  return runs;
}

/**
 * Resolve a `[start, end)` offset range within one run to absolute PM
 * positions. Returns `null` when either endpoint lands outside a text
 * span (e.g. on an atom placeholder or hard break).
 */
export function resolveRunOffsets(
  run: TextblockRun,
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (end <= start) return null;
  const startSpan = run.spans.find((span) => start >= span.from && start < span.to);
  const endOffset = end - 1;
  const endSpan = run.spans.find((span) => endOffset >= span.from && endOffset < span.to);
  if (!startSpan || !endSpan) return null;
  return {
    from: startSpan.docFrom + (start - startSpan.from),
    to: endSpan.docFrom + (end - endSpan.from),
  };
}
