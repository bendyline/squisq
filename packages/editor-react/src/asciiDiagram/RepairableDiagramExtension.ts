/**
 * RepairableDiagramExtension — mounts an inline "Repair as diagram" button on
 * code fences that hold BROKEN box-and-line art.
 *
 * The three states of a box-drawing fence partition cleanly:
 *  - a clean diagram        → AsciiDiagramExtension mounts the canvas;
 *  - a file tree / outline  → TreeViewExtension mounts the outline;
 *  - broken box art         → neither claims it (it renders as a faithful
 *                             code block), and THIS extension offers a button
 *                             to reconstruct it via `repairAsciiDiagram`.
 *
 * Unlike the diagram/tree extensions it does NOT hide the fence or mount a
 * persistent interactive widget — the code stays visible and editable, and a
 * single click rewrites the fence to clean `diagram`-tagged art (which the
 * AsciiDiagramExtension then turns into a canvas). So the position registry
 * only needs to survive until the click; it mirrors the other extensions'
 * mapping so the button always resolves the right fence.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { isEligibleAsciiFenceLang, isRepairableDiagram } from '@bendyline/squisq/doc';
import { mapFenceEntries, type FenceBlockEntry } from '../fenceWidgets/fenceRegistry';

export type RepairableBlockEntry = FenceBlockEntry;

export interface RepairablePluginState {
  entries: RepairableBlockEntry[];
  decorations: DecorationSet;
  seq: number;
}

export const REPAIRABLE_KEY = new PluginKey<RepairablePluginState>('squisq-repairable-diagram');

const cache = new WeakMap<PMNode, boolean>();

function fenceLangOf(node: PMNode): string | null {
  const lang = (node.attrs as { language?: string | null }).language;
  return typeof lang === 'string' ? lang : null;
}

/** True when a codeBlock holds broken box art worth offering to repair. */
export function isRepairableFence(node: PMNode): boolean {
  if (node.type.name !== 'codeBlock') return false;
  const cached = cache.get(node);
  if (cached !== undefined) return cached;
  const result =
    isEligibleAsciiFenceLang(fenceLangOf(node)) && isRepairableDiagram(node.textContent);
  cache.set(node, result);
  return result;
}

/** Resolve a registered block's current doc position (null when gone). */
export function findRepairableBlockPos(editor: Editor, blockId: string): number | null {
  return REPAIRABLE_KEY.getState(editor.state)?.entries.find((e) => e.id === blockId)?.pos ?? null;
}

/** Handler the mounted button invokes; wired by the host via extension options. */
export interface RepairableDiagramExtensionOptions {
  enabled?: boolean;
  /** Invoked when a repair button is clicked, with the block's synthetic id. */
  onRepair?: (editor: Editor, blockId: string) => void;
}

function buildDecorations(
  doc: PMNode,
  entries: RepairableBlockEntry[],
  editor: Editor,
  onRepair?: (editor: Editor, blockId: string) => void,
): DecorationSet {
  const decos: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || node.type.name !== 'codeBlock') continue;
    const blockId = entry.id;
    decos.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        () => {
          const host = document.createElement('div');
          host.className = 'squisq-repair-banner';
          host.contentEditable = 'false';
          const label = document.createElement('span');
          label.className = 'squisq-repair-banner-text';
          label.textContent = 'This looks like a diagram that didn’t render cleanly.';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'squisq-repair-banner-btn';
          btn.textContent = '⟳ Repair as diagram';
          const stop = (e: Event) => e.stopPropagation();
          host.addEventListener('mousedown', stop);
          btn.addEventListener('mousedown', stop);
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onRepair?.(editor, blockId);
          });
          host.appendChild(label);
          host.appendChild(btn);
          return host;
        },
        { side: 1, ignoreSelection: true, key: `squisq-repair-${entry.id}` },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

function applyState(
  tr: Transaction,
  prev: RepairablePluginState,
  editor: Editor,
  doc: PMNode,
  onRepair?: (editor: Editor, blockId: string) => void,
): RepairablePluginState {
  if (!tr.docChanged) return prev;

  const mapped = mapFenceEntries(tr, prev.entries, doc);

  let seq = prev.seq;
  const entries: RepairableBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    if (!isRepairableFence(node)) return false;
    entries.push({ id: mapped.get(pos) ?? `repair-${++seq}`, pos });
    return false;
  });

  return { entries, seq, decorations: buildDecorations(doc, entries, editor, onRepair) };
}

export const RepairableDiagramExtension = Extension.create<RepairableDiagramExtensionOptions>({
  name: 'squisqRepairableDiagram',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    if (this.options.enabled === false) return [];
    const onRepair = this.options.onRepair;

    return [
      new Plugin<RepairablePluginState>({
        key: REPAIRABLE_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries: RepairableBlockEntry[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return;
              if (!isRepairableFence(node)) return false;
              entries.push({ id: `repair-${++seq}`, pos });
              return false;
            });
            return {
              entries,
              seq,
              decorations: buildDecorations(state.doc, entries, editor, onRepair),
            };
          },
          apply: (tr, prev, _old, newState) => applyState(tr, prev, editor, newState.doc, onRepair),
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

export default RepairableDiagramExtension;
