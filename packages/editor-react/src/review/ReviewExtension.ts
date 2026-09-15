/**
 * Review marks for the Write view.
 *
 * A sibling of `proofing/ProofingExtension.ts`, and it inherits that file's
 * load-bearing decision: on an ordinary document change the current
 * `DecorationSet` is MAPPED through the transaction rather than rebuilt. A
 * review pass can take seconds, so without mapping every mark would sit on
 * stale text for the whole of it. Every consumer resolves positions from the
 * live decorations, never from the offsets a pass reported.
 *
 * It registers its own plugin key, so review marks and proofing squiggles
 * coexist rather than one replacing the other.
 */

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { reviewUnderlineClass, type ReviewDecorationSpec } from './decorations.js';
import type { ReviewHue } from './types.js';

interface ReviewPluginState {
  decorations: DecorationSet;
}

interface ReviewMeta {
  specs: readonly ReviewDecorationSpec[];
}

const REVIEW_KEY = new PluginKey<ReviewPluginState>('squisq-review');

function buildSet(doc: ProseMirrorNode, specs: readonly ReviewDecorationSpec[]): DecorationSet {
  const max = doc.content.size;
  const decorations: Decoration[] = [];
  for (const spec of specs) {
    if (spec.from >= spec.to || spec.to > max) continue;
    decorations.push(
      Decoration.inline(
        spec.from,
        spec.to,
        {
          class: reviewUnderlineClass(spec.hue),
          'data-review-id': spec.findingId,
          'data-review-source': spec.source,
        },
        { findingId: spec.findingId, source: spec.source, hue: spec.hue },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** Write-view review marks. Registered unconditionally; inert until fed. */
export const ReviewExtension = Extension.create({
  name: 'squisqReview',

  addProseMirrorPlugins() {
    return [
      new Plugin<ReviewPluginState>({
        key: REVIEW_KEY,
        state: {
          init: () => ({ decorations: DecorationSet.empty }),
          apply: (transaction, previous) => {
            const meta = transaction.getMeta(REVIEW_KEY) as ReviewMeta | undefined;
            if (meta) return { decorations: buildSet(transaction.doc, meta.specs) };
            if (transaction.docChanged) {
              return {
                decorations: previous.decorations.map(transaction.mapping, transaction.doc),
              };
            }
            return previous;
          },
        },
        props: {
          decorations: (state) => REVIEW_KEY.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});

/** Replace the Write view's review marks with a fresh pass's results. */
export function updateReviewDecorations(
  editor: Editor,
  specs: readonly ReviewDecorationSpec[],
): void {
  editor.view.dispatch(editor.state.tr.setMeta(REVIEW_KEY, { specs } satisfies ReviewMeta));
}

/** Clear every review mark. */
export function clearReviewDecorations(editor: Editor): void {
  updateReviewDecorations(editor, []);
}

export interface ResolvedReviewDecoration {
  findingId: string;
  source: string;
  hue: ReviewHue;
  from: number;
  to: number;
}

function resolve(hit: Decoration | undefined): ResolvedReviewDecoration | null {
  if (!hit) return null;
  const spec = hit.spec as { findingId: string; source: string; hue: ReviewHue };
  return {
    findingId: spec.findingId,
    source: spec.source,
    hue: spec.hue,
    from: hit.from,
    to: hit.to,
  };
}

/** The review mark at a position, at its current mapped range. */
export function reviewDecorationAt(
  state: EditorState,
  pos: number,
): ResolvedReviewDecoration | null {
  const set = REVIEW_KEY.getState(state)?.decorations;
  return set ? resolve(set.find(pos, pos)[0]) : null;
}

/**
 * The review mark for a finding id, at its current mapped range.
 *
 * This is what makes applying a suggestion safe after the user has typed: the
 * range comes from the live decoration, so the edit lands where the text moved
 * to rather than where it was when the pass ran.
 */
export function reviewDecorationById(
  state: EditorState,
  findingId: string,
): ResolvedReviewDecoration | null {
  const set = REVIEW_KEY.getState(state)?.decorations;
  if (!set) return null;
  return resolve(
    set.find(
      undefined,
      undefined,
      (spec) => (spec as { findingId?: string }).findingId === findingId,
    )[0],
  );
}
