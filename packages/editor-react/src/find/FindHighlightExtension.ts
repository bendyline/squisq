import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findProseMirrorMatches, normalizeFindIndex } from './findModel';

interface FindHighlightState {
  query: string;
  selectedIndex: number;
  decorations: DecorationSet;
}

interface FindHighlightMeta {
  query: string;
  selectedIndex: number;
}

const FIND_HIGHLIGHT_KEY = new PluginKey<FindHighlightState>('squisq-find-highlight');

function buildState(
  doc: Parameters<typeof findProseMirrorMatches>[0],
  query: string,
  selectedIndex: number,
): FindHighlightState {
  const matches = findProseMirrorMatches(doc, query);
  const selected = normalizeFindIndex(selectedIndex, matches.length);
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class:
        index === selected ? 'squisq-find-match squisq-find-match--selected' : 'squisq-find-match',
    }),
  );
  return {
    query,
    selectedIndex: selected,
    decorations: DecorationSet.create(doc, decorations),
  };
}

/** ProseMirror decorations used by the shell's host-triggered Find mode. */
export const FindHighlightExtension = Extension.create({
  name: 'squisqFindHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindHighlightState>({
        key: FIND_HIGHLIGHT_KEY,
        state: {
          init: (_, state) => buildState(state.doc, '', 0),
          apply: (transaction, previous, _oldState, newState) => {
            const meta = transaction.getMeta(FIND_HIGHLIGHT_KEY) as FindHighlightMeta | undefined;
            if (!meta && !transaction.docChanged) return previous;
            return buildState(
              newState.doc,
              meta?.query ?? previous.query,
              meta?.selectedIndex ?? previous.selectedIndex,
            );
          },
        },
        props: {
          decorations: (state) => FIND_HIGHLIGHT_KEY.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});

/** Update WYSIWYG highlights and return the current number of matches. */
export function updateTiptapFindHighlights(
  editor: Editor,
  query: string,
  selectedIndex: number,
): number {
  const matches = findProseMirrorMatches(editor.state.doc, query);
  editor.view.dispatch(
    editor.state.tr.setMeta(FIND_HIGHLIGHT_KEY, {
      query,
      selectedIndex: normalizeFindIndex(selectedIndex, matches.length),
    } satisfies FindHighlightMeta),
  );
  return matches.length;
}
