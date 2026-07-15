/**
 * Tiptap extension for ordinary explicit-language code fences.
 *
 * The ProseMirror code block remains authoritative. This plugin hides it and
 * mounts a Monaco editor whose edits rewrite only the node's text content, so
 * fence language and source round-trip through Markdown without a parallel model.
 */

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CodeSnippetWidget } from './CodeSnippetWidget';
import { CODE_SNIPPET_FOCUS_INSERTED_META } from './codeSnippetFocus';
import { isCodeSnippetFenceLanguage } from './codeSnippetLanguages';

export interface CodeSnippetBlockEntry {
  /** Synthetic session id, stable while this code block remains in the doc. */
  id: string;
  /** Current ProseMirror position of the `codeBlock`. */
  pos: number;
}

export interface CodeSnippetPluginState {
  entries: CodeSnippetBlockEntry[];
  decorations: DecorationSet;
  seq: number;
  /** One-shot mount target supplied by the transaction that inserted the snippet. */
  focusBlockId: string | null;
}

export interface CodeSnippetExtensionOptions {
  /** When false, leave all ordinary language-tagged fences as code blocks. */
  enabled?: boolean;
}

export const CODE_SNIPPET_KEY = new PluginKey<CodeSnippetPluginState>('squisq-code-snippet');

export function isCodeSnippetNode(node: PMNode): boolean {
  const language = (node.attrs as { language?: unknown }).language;
  return (
    node.type.name === 'codeBlock' &&
    isCodeSnippetFenceLanguage(typeof language === 'string' ? language : null)
  );
}

export function findCodeSnippetBlockPos(editor: Editor, blockId: string): number | null {
  const state = CODE_SNIPPET_KEY.getState(editor.state);
  return state?.entries.find((entry) => entry.id === blockId)?.pos ?? null;
}

interface WidgetRootRef {
  root: Root;
}

function buildDecorations(
  doc: PMNode,
  entries: readonly CodeSnippetBlockEntry[],
  editor: Editor,
  focusBlockId: string | null = null,
): DecorationSet {
  const decorations: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || !isCodeSnippetNode(node)) continue;
    decorations.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, {
        class: 'squisq-code-snippet-fence-hidden',
      }),
    );
    const blockId = entry.id;
    decorations.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        (view) => {
          const container = document.createElement('div');
          container.className = 'squisq-code-snippet-widget-host';
          container.contentEditable = 'false';
          container.addEventListener('mousedown', (event) => event.stopPropagation());
          container.addEventListener('keydown', (event) => event.stopPropagation());
          const root = createRoot(container);
          root.render(
            createElement(CodeSnippetWidget, {
              editor,
              blockId,
              host: view.dom.parentElement ?? view.dom,
              focusOnMount: entry.id === focusBlockId,
            }),
          );
          (
            container as HTMLElement & { __squisqCodeSnippetRoot?: WidgetRootRef }
          ).__squisqCodeSnippetRoot = { root };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqCodeSnippetRoot?: WidgetRootRef })
              .__squisqCodeSnippetRoot;
            if (ref) setTimeout(() => ref.root.unmount(), 0);
          },
          ignoreSelection: true,
          key: `squisq-code-snippet-${entry.id}`,
          side: 1,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

function remapEntries(
  tr: Transaction,
  previous: CodeSnippetPluginState,
  doc: PMNode,
): { entries: CodeSnippetBlockEntry[]; seq: number } {
  const mapped = new Map<number, string>();
  const claimed = new Set<string>();

  for (const entry of previous.entries) {
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (!result.deleted) {
      mapped.set(result.pos, entry.id);
      claimed.add(entry.id);
    }
  }

  // Replacing node content can mark its opening token as replaced even though
  // the same language-tagged code block still occupies the mapped position.
  for (const entry of previous.entries) {
    if (claimed.has(entry.id)) continue;
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (mapped.has(result.pos)) continue;
    if (doc.nodeAt(result.pos)?.type.name === 'codeBlock') {
      mapped.set(result.pos, entry.id);
      claimed.add(entry.id);
    }
  }

  let seq = previous.seq;
  const entries: CodeSnippetBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    if (!isCodeSnippetNode(node)) return false;
    entries.push({ id: mapped.get(pos) ?? `code-snippet-${++seq}`, pos });
    return false;
  });
  return { entries, seq };
}

function applyState(
  tr: Transaction,
  previous: CodeSnippetPluginState,
  editor: Editor,
  doc: PMNode,
): CodeSnippetPluginState {
  if (!tr.docChanged) return previous;
  const { entries, seq } = remapEntries(tr, previous, doc);
  const requestedFocusPos = tr.getMeta(CODE_SNIPPET_FOCUS_INSERTED_META);
  const focusBlockId =
    typeof requestedFocusPos === 'number'
      ? (entries.find((entry) => entry.pos === requestedFocusPos)?.id ?? null)
      : null;
  return {
    entries,
    seq,
    focusBlockId,
    decorations: buildDecorations(doc, entries, editor, focusBlockId),
  };
}

export const CodeSnippetExtension = Extension.create<CodeSnippetExtensionOptions>({
  name: 'squisqCodeSnippet',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    if (this.options.enabled === false) return [];
    const editor = this.editor as Editor;
    return [
      new Plugin<CodeSnippetPluginState>({
        key: CODE_SNIPPET_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries: CodeSnippetBlockEntry[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return;
              if (!isCodeSnippetNode(node)) return false;
              entries.push({ id: `code-snippet-${++seq}`, pos });
              return false;
            });
            return {
              entries,
              seq,
              focusBlockId: null,
              decorations: buildDecorations(state.doc, entries, editor),
            };
          },
          apply: (tr, previous, _oldState, newState) =>
            applyState(tr, previous, editor, newState.doc),
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export default CodeSnippetExtension;
