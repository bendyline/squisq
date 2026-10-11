import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  findProseMirrorMatches,
  nextFindIndexAfter,
  normalizeFindIndex,
  type FindOptions,
  type FindTextMatch,
} from './findModel';

interface FindHighlightState {
  query: string;
  options: FindOptions;
  selectedIndex: number;
  decorations: DecorationSet;
}

interface FindHighlightMeta {
  query: string;
  options: FindOptions;
  selectedIndex: number;
}

const FIND_HIGHLIGHT_KEY = new PluginKey<FindHighlightState>('squisq-find-highlight');

function buildState(
  doc: Parameters<typeof findProseMirrorMatches>[0],
  query: string,
  options: FindOptions,
  selectedIndex: number,
): FindHighlightState {
  const matches = findProseMirrorMatches(doc, query, options);
  const selected = normalizeFindIndex(selectedIndex, matches.length);
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class:
        index === selected ? 'squisq-find-match squisq-find-match--selected' : 'squisq-find-match',
    }),
  );
  return {
    query,
    options,
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
          init: (_, state) => buildState(state.doc, '', {}, 0),
          apply: (transaction, previous, _oldState, newState) => {
            const meta = transaction.getMeta(FIND_HIGHLIGHT_KEY) as FindHighlightMeta | undefined;
            if (!meta && !transaction.docChanged) return previous;
            return buildState(
              newState.doc,
              meta?.query ?? previous.query,
              meta?.options ?? previous.options,
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

/**
 * Update WYSIWYG highlights and return the current number of matches. With
 * `select`, the editor selection moves to the selected match so closing Find
 * leaves the caret on it; callers pass it only when the user navigated, never
 * for a document edit, so typing with Find open does not move the caret.
 */
export function updateTiptapFindHighlights(
  editor: Editor,
  query: string,
  selectedIndex: number,
  options: FindOptions = {},
  { select = false }: { readonly select?: boolean } = {},
): number {
  const matches = findProseMirrorMatches(editor.state.doc, query, options);
  const selected = normalizeFindIndex(selectedIndex, matches.length);
  let transaction = editor.state.tr.setMeta(FIND_HIGHLIGHT_KEY, {
    query,
    options,
    selectedIndex: selected,
  } satisfies FindHighlightMeta);
  const match = select ? matches[selected] : undefined;
  if (match) {
    transaction = transaction.setSelection(
      TextSelection.create(transaction.doc, match.from, match.to),
    );
  }
  editor.view.dispatch(transaction);
  return matches.length;
}

/**
 * Replace the selected match. Returns the index to select next — the first
 * match after the inserted text, so a replacement that contains the query is
 * not matched again in place — or null when there was nothing to replace.
 */
export function replaceTiptapFindMatch(
  editor: Editor,
  query: string,
  selectedIndex: number,
  replacement: string,
  options: FindOptions = {},
): number | null {
  const matches = findProseMirrorMatches(editor.state.doc, query, options);
  const match: FindTextMatch | undefined =
    matches[normalizeFindIndex(selectedIndex, matches.length)];
  if (!match) return null;
  const transaction = editor.state.tr.insertText(replacement, match.from, match.to);
  editor.view.dispatch(transaction);
  const after = match.from + replacement.length;
  return nextFindIndexAfter(findProseMirrorMatches(editor.state.doc, query, options), after);
}

/** Replace every match in one transaction (one undo step). Returns the count. */
export function replaceAllTiptapFindMatches(
  editor: Editor,
  query: string,
  replacement: string,
  options: FindOptions = {},
): number {
  const matches = findProseMirrorMatches(editor.state.doc, query, options);
  if (matches.length === 0) return 0;
  const transaction = editor.state.tr;
  // Last to first, so earlier positions stay valid as the document changes.
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    transaction.insertText(replacement, matches[index]!.from, matches[index]!.to);
  }
  editor.view.dispatch(transaction);
  return matches.length;
}
