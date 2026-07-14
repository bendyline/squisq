/**
 * Tiptap extension for `mermaid` code fences.
 *
 * The code block always remains the document source of truth. The extension
 * only hides/shows that block and mounts a rendered Mermaid canvas after it;
 * it never replaces the fence with an editor-only node or a reduced graph
 * model. That keeps every Mermaid diagram type and directive round-trippable.
 */

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MermaidDiagramWidget } from './MermaidDiagramWidget';

export interface MermaidDiagramBlockEntry {
  /** Synthetic session id, stable while this code block remains in the doc. */
  id: string;
  /** Current ProseMirror position of the `codeBlock`. */
  pos: number;
}

export interface MermaidDiagramPluginState {
  entries: MermaidDiagramBlockEntry[];
  decorations: DecorationSet;
  sourceVisible: ReadonlySet<string>;
  seq: number;
}

export interface MermaidDiagramExtensionOptions {
  /** When false, leave Mermaid fences as ordinary code blocks. */
  enabled?: boolean;
}

export const MERMAID_DIAGRAM_KEY = new PluginKey<MermaidDiagramPluginState>(
  'squisq-mermaid-diagram',
);

function fenceLanguage(node: PMNode): string {
  const language = (node.attrs as { language?: unknown }).language;
  return typeof language === 'string' ? language.trim().toLowerCase() : '';
}

/** Mermaid is an explicit mode: only a `mermaid` language tag claims it. */
export function isMermaidDiagramNode(node: PMNode): boolean {
  return node.type.name === 'codeBlock' && fenceLanguage(node) === 'mermaid';
}

export function findMermaidDiagramBlockPos(editor: Editor, blockId: string): number | null {
  const state = MERMAID_DIAGRAM_KEY.getState(editor.state);
  return state?.entries.find((entry) => entry.id === blockId)?.pos ?? null;
}

export function isMermaidSourceVisible(editor: Editor, blockId: string): boolean {
  return MERMAID_DIAGRAM_KEY.getState(editor.state)?.sourceVisible.has(blockId) ?? false;
}

/** Toggle the editable code block without changing any document bytes. */
export function toggleMermaidSource(editor: Editor, blockId: string): void {
  editor.view.dispatch(editor.state.tr.setMeta(MERMAID_DIAGRAM_KEY, { toggleSource: blockId }));
}

interface WidgetRootRef {
  root: Root;
}

function buildDecorations(
  doc: PMNode,
  entries: readonly MermaidDiagramBlockEntry[],
  sourceVisible: ReadonlySet<string>,
  editor: Editor,
): DecorationSet {
  const decorations: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || !isMermaidDiagramNode(node)) continue;
    decorations.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, {
        class: sourceVisible.has(entry.id)
          ? 'squisq-mermaid-fence-source'
          : 'squisq-mermaid-fence-hidden',
      }),
    );
    const blockId = entry.id;
    decorations.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        (view) => {
          const container = document.createElement('div');
          container.className = 'squisq-mermaid-diagram-widget-host';
          container.contentEditable = 'false';
          container.addEventListener('mousedown', (event) => event.stopPropagation());
          container.addEventListener('keydown', (event) => event.stopPropagation());
          const root = createRoot(container);
          root.render(
            createElement(MermaidDiagramWidget, {
              editor,
              blockId,
              host: view.dom.parentElement ?? view.dom,
            }),
          );
          (container as HTMLElement & { __squisqMermaidRoot?: WidgetRootRef }).__squisqMermaidRoot =
            { root };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqMermaidRoot?: WidgetRootRef })
              .__squisqMermaidRoot;
            if (ref) setTimeout(() => ref.root.unmount(), 0);
          },
          ignoreSelection: true,
          key: `squisq-mermaid-${entry.id}`,
          side: 1,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

function remapEntries(
  tr: Transaction,
  previous: MermaidDiagramPluginState,
  doc: PMNode,
): { entries: MermaidDiagramBlockEntry[]; seq: number } {
  const mapped = new Map<number, string>();
  const claimed = new Set<string>();

  for (const entry of previous.entries) {
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (!result.deleted) {
      mapped.set(result.pos, entry.id);
      claimed.add(entry.id);
    }
  }

  // Attribute and content edits can mark the opening token as replaced even
  // when the same code block remains at the mapped position.
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
  const entries: MermaidDiagramBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    if (!isMermaidDiagramNode(node)) return false;
    entries.push({ id: mapped.get(pos) ?? `mermaid-${++seq}`, pos });
    return false;
  });
  return { entries, seq };
}

function applyState(
  tr: Transaction,
  previous: MermaidDiagramPluginState,
  editor: Editor,
  doc: PMNode,
): MermaidDiagramPluginState {
  const meta = tr.getMeta(MERMAID_DIAGRAM_KEY) as { toggleSource?: string } | undefined;
  let sourceVisible = previous.sourceVisible;
  if (meta?.toggleSource) {
    const next = new Set(sourceVisible);
    if (next.has(meta.toggleSource)) next.delete(meta.toggleSource);
    else next.add(meta.toggleSource);
    sourceVisible = next;
  }

  if (!tr.docChanged) {
    if (!meta?.toggleSource) return previous;
    return {
      ...previous,
      sourceVisible,
      decorations: buildDecorations(doc, previous.entries, sourceVisible, editor),
    };
  }

  const { entries, seq } = remapEntries(tr, previous, doc);
  const liveIds = new Set(entries.map((entry) => entry.id));
  const prunedSourceVisible = new Set([...sourceVisible].filter((id) => liveIds.has(id)));
  return {
    entries,
    seq,
    sourceVisible: prunedSourceVisible,
    decorations: buildDecorations(doc, entries, prunedSourceVisible, editor),
  };
}

export const MermaidDiagramExtension = Extension.create<MermaidDiagramExtensionOptions>({
  name: 'squisqMermaidDiagram',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    if (this.options.enabled === false) return [];
    const editor = this.editor as Editor;
    return [
      new Plugin<MermaidDiagramPluginState>({
        key: MERMAID_DIAGRAM_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries: MermaidDiagramBlockEntry[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return;
              if (!isMermaidDiagramNode(node)) return false;
              entries.push({ id: `mermaid-${++seq}`, pos });
              return false;
            });
            const sourceVisible = new Set<string>();
            return {
              entries,
              seq,
              sourceVisible,
              decorations: buildDecorations(state.doc, entries, sourceVisible, editor),
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

export default MermaidDiagramExtension;
