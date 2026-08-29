/**
 * Squiggle decorations for the Write view — structurally a sibling of
 * `find/FindHighlightExtension.ts`, with one crucial difference: lint
 * results arrive asynchronously, so on ordinary doc changes the current
 * `DecorationSet` is MAPPED through the transaction instead of being
 * rebuilt. Squiggles track the text while a fresh pass is pending, and
 * every consumer (menu, panel, apply) resolves positions from the live
 * decorations rather than lint-time offsets.
 */

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ProofCategory } from '@bendyline/squisq/proof';

/** One squiggle to draw, in absolute PM positions. */
export interface TiptapProofDecoration {
  findingId: string;
  from: number;
  to: number;
  category: ProofCategory;
}

interface ProofingPluginState {
  decorations: DecorationSet;
}

interface ProofingMeta {
  findings: readonly TiptapProofDecoration[];
}

const PROOFING_KEY = new PluginKey<ProofingPluginState>('squisq-proofing');

function buildSet(doc: ProseMirrorNode, findings: readonly TiptapProofDecoration[]): DecorationSet {
  const max = doc.content.size;
  const decorations: Decoration[] = [];
  for (const finding of findings) {
    if (finding.from >= finding.to || finding.to > max) continue;
    decorations.push(
      Decoration.inline(
        finding.from,
        finding.to,
        {
          class: `squisq-proof-underline squisq-proof-underline--${finding.category}`,
          'data-proof-id': finding.findingId,
        },
        { findingId: finding.findingId, category: finding.category },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** Write-view proofing squiggles. Registered unconditionally; inert until fed. */
export const ProofingExtension = Extension.create({
  name: 'squisqProofing',

  addProseMirrorPlugins() {
    return [
      new Plugin<ProofingPluginState>({
        key: PROOFING_KEY,
        state: {
          init: () => ({ decorations: DecorationSet.empty }),
          apply: (transaction, previous) => {
            const meta = transaction.getMeta(PROOFING_KEY) as ProofingMeta | undefined;
            if (meta) return { decorations: buildSet(transaction.doc, meta.findings) };
            if (transaction.docChanged) {
              return {
                decorations: previous.decorations.map(transaction.mapping, transaction.doc),
              };
            }
            return previous;
          },
        },
        props: {
          decorations: (state) => PROOFING_KEY.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});

/** Replace the Write view's squiggles with a fresh lint pass's results. */
export function updateTiptapProofingDecorations(
  editor: Editor,
  findings: readonly TiptapProofDecoration[],
): void {
  editor.view.dispatch(editor.state.tr.setMeta(PROOFING_KEY, { findings } satisfies ProofingMeta));
}

/** Clear all Write-view squiggles. */
export function clearTiptapProofingDecorations(editor: Editor): void {
  updateTiptapProofingDecorations(editor, []);
}

export interface ResolvedProofDecoration {
  findingId: string;
  category: ProofCategory;
  from: number;
  to: number;
}

/** The squiggle at a PM position, if any (current mapped range). */
export function proofingDecorationAt(
  state: EditorState,
  pos: number,
): ResolvedProofDecoration | null {
  const set = PROOFING_KEY.getState(state)?.decorations;
  if (!set) return null;
  const hit = set.find(pos, pos)[0];
  if (!hit) return null;
  const spec = hit.spec as { findingId: string; category: ProofCategory };
  return { findingId: spec.findingId, category: spec.category, from: hit.from, to: hit.to };
}

/** The squiggle for a finding id, at its current mapped range. */
export function proofingDecorationById(
  state: EditorState,
  findingId: string,
): ResolvedProofDecoration | null {
  const set = PROOFING_KEY.getState(state)?.decorations;
  if (!set) return null;
  const hit = set.find(
    undefined,
    undefined,
    (spec) => (spec as { findingId?: string }).findingId === findingId,
  )[0];
  if (!hit) return null;
  const spec = hit.spec as { findingId: string; category: ProofCategory };
  return { findingId: spec.findingId, category: spec.category, from: hit.from, to: hit.to };
}
