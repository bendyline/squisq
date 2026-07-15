/**
 * TreeViewExtension — Tiptap/ProseMirror plugin that turns code blocks
 * containing ASCII file-tree / outline art into interactive outline editors.
 *
 * Structurally identical to AsciiDiagramExtension (position registry, stable
 * synthetic ids, hysteresis, self-rewrite-survival via the decoration key);
 * only the detect/parse gates and class names differ. The fence text stays
 * the source of truth — every edit re-renders the tree art.
 *
 * Mutual exclusion with the diagram extension: a fence with ≥2 closed boxes
 * is a diagram, never a tree (checked in both gates), so at most one
 * extension claims any given fence.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import {
  detectTree,
  isEligibleTreeFenceLang,
  isExplicitTreeLang,
  parseAsciiDiagram,
  parseTree,
  type Tree,
} from '@bendyline/squisq/doc';
import { TreeOutlineWidget } from './TreeOutlineWidget';
import { containFenceWidgetEvents } from '../fenceWidgets/fenceWidgetHost';
import { mapFenceEntries, type FenceBlockEntry } from '../fenceWidgets/fenceRegistry';

export type TreeBlockEntry = FenceBlockEntry;

export interface TreeViewPluginState {
  entries: TreeBlockEntry[];
  decorations: DecorationSet;
  seq: number;
}

export const TREEVIEW_KEY = new PluginKey<TreeViewPluginState>('squisq-treeview');

const detectCache = new WeakMap<PMNode, Tree | null>();
const parseCache = new WeakMap<PMNode, Tree | null>();

function fenceLangOf(node: PMNode): string | null {
  const lang = (node.attrs as { language?: string | null }).language;
  return typeof lang === 'string' ? lang : null;
}

function countTreeNodes(nodes: readonly Tree['roots'][number][]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countTreeNodes(node.children);
  return n;
}

/** Full-detection gate for NEW blocks: lang allowlist + tree thresholds. */
export function getTreeForNode(node: PMNode): Tree | null {
  if (node.type.name !== 'codeBlock') return null;
  const cached = detectCache.get(node);
  if (cached !== undefined) return cached;
  let result: Tree | null = null;
  const lang = fenceLangOf(node);
  if (isEligibleTreeFenceLang(lang)) {
    const detection = detectTree(node.textContent, { explicit: isExplicitTreeLang(lang) });
    if (detection.isTree && detection.tree) {
      result = detection.tree;
      parseCache.set(node, result);
    }
  }
  detectCache.set(node, result);
  return result;
}

/** Relaxed gate for ALREADY-REGISTERED blocks: any parse with ≥1 node and no boxes. */
export function parseTreeForNode(node: PMNode): Tree | null {
  if (node.type.name !== 'codeBlock') return null;
  const cached = parseCache.get(node);
  if (cached !== undefined) return cached;
  let result: Tree | null = null;
  if (isEligibleTreeFenceLang(fenceLangOf(node))) {
    const text = node.textContent;
    // Box-diagram fences belong to the diagram extension, never here.
    if (parseAsciiDiagram(text).nodes.length < 2) {
      const parsed = parseTree(text);
      if (countTreeNodes(parsed.roots) > 0) result = parsed;
    }
  }
  parseCache.set(node, result);
  return result;
}

export function findTreeBlockPos(editor: Editor, blockId: string): number | null {
  return TREEVIEW_KEY.getState(editor.state)?.entries.find((e) => e.id === blockId)?.pos ?? null;
}

interface WidgetRootRef {
  root: Root;
}

function buildDecorations(doc: PMNode, entries: TreeBlockEntry[], editor: Editor): DecorationSet {
  const decos: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || node.type.name !== 'codeBlock') continue;
    decos.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, { class: 'squisq-tree-fence-hidden' }),
    );
    const blockId = entry.id;
    const fallbackPos = entry.pos;
    decos.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        (view) => {
          const container = document.createElement('div');
          container.className = 'squisq-tree-widget-host';
          container.contentEditable = 'false';
          // The outline mounts real `<input>` rename fields inside a
          // decoration; contain their whole edit/composition/clipboard stream
          // so ProseMirror cannot replay it at the document selection.
          containFenceWidgetEvents(container);
          const root = createRoot(container);
          root.render(
            createElement(TreeOutlineWidget, {
              editor,
              blockId,
              fallbackPos,
              host: view.dom.parentElement ?? view.dom,
            }),
          );
          (container as HTMLElement & { __squisqTreeRoot?: WidgetRootRef }).__squisqTreeRoot = {
            root,
          };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqTreeRoot?: WidgetRootRef })
              .__squisqTreeRoot;
            if (ref) setTimeout(() => ref.root.unmount(), 0);
          },
          side: 1,
          ignoreSelection: true,
          key: `squisq-tree-${entry.id}`,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

function applyState(
  tr: Transaction,
  prev: TreeViewPluginState,
  editor: Editor,
  doc: PMNode,
): TreeViewPluginState {
  if (!tr.docChanged) return prev;

  const mapped = mapFenceEntries(tr, prev.entries, doc);

  let seq = prev.seq;
  const entries: TreeBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    const knownId = mapped.get(pos);
    const tree = knownId ? parseTreeForNode(node) : getTreeForNode(node);
    if (!tree) return false;
    entries.push({ id: knownId ?? `tree-${++seq}`, pos });
    return false;
  });

  return { entries, seq, decorations: buildDecorations(doc, entries, editor) };
}

export interface TreeViewExtensionOptions {
  /** When false, the extension is inert (no widgets, no decorations). */
  enabled?: boolean;
}

export const TreeViewExtension = Extension.create<TreeViewExtensionOptions>({
  name: 'squisqTreeView',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    if (this.options.enabled === false) return [];

    return [
      new Plugin<TreeViewPluginState>({
        key: TREEVIEW_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries: TreeBlockEntry[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return;
              if (!getTreeForNode(node)) return false;
              entries.push({ id: `tree-${++seq}`, pos });
              return false;
            });
            return {
              entries,
              seq,
              decorations: buildDecorations(state.doc, entries, editor),
            };
          },
          apply: (tr, prev, _oldState, newState) => applyState(tr, prev, editor, newState.doc),
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

export default TreeViewExtension;
