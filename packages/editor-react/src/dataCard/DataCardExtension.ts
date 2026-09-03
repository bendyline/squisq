/**
 * DataCardExtension — the Write-view "rectangle" for data sidecar files.
 *
 * A paragraph whose entire content is one link to a relative data file
 * (`[q3.csv](report_files/data/q3.csv)` — the graceful-degradation body link
 * under a `{[dataTable src=…]}` heading) is hidden and a summary card mounts
 * in its place: file name, size, rows × cols, and a small preview.
 *
 * Structurally a sibling of `fenceWidgets/HostFenceExtension`, claiming
 * PARAGRAPHS instead of code fences: same position registry with stable
 * synthetic ids (via the generalized `mapFenceEntries`), same hide-the-node
 * decoration + React-root widget with `containFenceWidgetEvents`.
 *
 * The claim predicate is synchronous and doc-content-only (relative href +
 * data extension) — never an async listMedia consultation, so plugin state
 * stays deterministic per transaction. A claimed card whose file is missing
 * renders the error state instead of un-claiming.
 *
 * READ-ONLY by design in this phase: the card never touches the ProseMirror
 * document, so markdown round-trips byte-identically with the extension
 * active (`dataCard.test.tsx` holds that contract).
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { isDataFilePath } from '@bendyline/squisq/doc';
import { containFenceWidgetEvents } from '../fenceWidgets/fenceWidgetHost';
import { mapFenceEntries, type FenceBlockEntry } from '../fenceWidgets/fenceRegistry';
import { DataCardWidget } from './DataCardWidget';
import type { CalcEngineFactory } from './formulaSupport';

export type DataCardBlockEntry = FenceBlockEntry;

export interface DataCardPluginState {
  entries: DataCardBlockEntry[];
  decorations: DecorationSet;
  seq: number;
}

export const DATA_CARD_KEY = new PluginKey<DataCardPluginState>('squisq-data-card');

export interface DataCardExtensionOptions {
  /** When false, the extension is inert. */
  enabled?: boolean;
  /** Getter — stays live without an editor remount (the mentionProvider pattern). */
  mediaProvider?: () => MediaProvider | null | undefined;
  /** Getter for the media revision; a bump re-resolves mounted cards. */
  mediaRevision?: () => number;
  /**
   * Getter for the workspace container — enables the grid save flow's
   * `.versions/data/` pre-save backups. Absent = saves proceed without a
   * backup (and say so).
   */
  container?: () => ContentContainer | null | undefined;
  /** Open the Files panel focused on a sidecar path. */
  onOpenFiles?: (relativePath: string) => void;
  /** Notified after a successful sidecar save (hosts bump mediaRevision). */
  onMediaSaved?: () => void;
  /** Getter for the calc backend of formula sessions (default in-house). */
  calcEngineFactory?: () => CalcEngineFactory | null | undefined;
}

/**
 * The single data-file href a paragraph is entirely made of, or null.
 * Every text child must carry the SAME link href; any unlinked or
 * non-text content disqualifies the paragraph (an inline link in prose
 * stays prose).
 */
export function dataLinkHrefOf(node: PMNode): string | null {
  if (node.type.name !== 'paragraph' || node.childCount === 0) return null;
  let href: string | null = null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child.isText || !child.text || !child.text.trim()) return null;
    const link = child.marks.find((mark) => mark.type.name === 'link');
    const childHref = (link?.attrs as { href?: unknown } | undefined)?.href;
    if (typeof childHref !== 'string') return null;
    if (href === null) href = childHref;
    else if (href !== childHref) return null;
  }
  return href !== null && isDataFilePath(href) ? href : null;
}

export function findDataCardBlockPos(editor: Editor, blockId: string): number | null {
  return DATA_CARD_KEY.getState(editor.state)?.entries.find((e) => e.id === blockId)?.pos ?? null;
}

interface WidgetRootRef {
  root: Root;
}

function buildDecorations(
  doc: PMNode,
  entries: DataCardBlockEntry[],
  editor: Editor,
  options: DataCardExtensionOptions,
): DecorationSet {
  const decos: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || node.type.name !== 'paragraph') continue;
    decos.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, {
        class: 'squisq-data-card-hidden',
      }),
    );
    const blockId = entry.id;
    decos.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        () => {
          const container = document.createElement('div');
          // The generic marker lets block-at-a-time layout give a terminal,
          // height-capable component the card's remaining space. Document
          // layout ignores it, and the data-card-specific CSS teaches the
          // virtualized grid how to consume the extra height.
          container.className = 'squisq-data-card-host squisq-block-fill-available';
          container.contentEditable = 'false';
          // The card carries buttons; contain the edit/composition/clipboard
          // stream so ProseMirror can't replay it at the document selection.
          containFenceWidgetEvents(container);
          const root = createRoot(container);
          root.render(
            createElement(DataCardWidget, {
              editor,
              blockId,
              getMediaProvider: () => options.mediaProvider?.(),
              getMediaRevision: () => options.mediaRevision?.() ?? 0,
              getContainer: () => options.container?.(),
              onOpenFiles: options.onOpenFiles,
              onMediaSaved: options.onMediaSaved,
              getCalcEngineFactory: () => options.calcEngineFactory?.(),
            }),
          );
          (
            container as HTMLElement & { __squisqDataCardRoot?: WidgetRootRef }
          ).__squisqDataCardRoot = { root };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqDataCardRoot?: WidgetRootRef })
              .__squisqDataCardRoot;
            if (ref) setTimeout(() => ref.root.unmount(), 0);
          },
          side: 1,
          ignoreSelection: true,
          key: `squisq-data-card-${entry.id}`,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

function collectEntries(
  doc: PMNode,
  mapped: Map<number, string> | null,
  seqStart: number,
): { entries: DataCardBlockEntry[]; seq: number } {
  let seq = seqStart;
  const entries: DataCardBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return;
    if (!dataLinkHrefOf(node)) return false;
    entries.push({ id: mapped?.get(pos) ?? `data-card-${++seq}`, pos });
    return false;
  });
  return { entries, seq };
}

function applyState(
  tr: Transaction,
  prev: DataCardPluginState,
  editor: Editor,
  doc: PMNode,
  options: DataCardExtensionOptions,
): DataCardPluginState {
  if (!tr.docChanged) return prev;
  const mapped = mapFenceEntries(tr, prev.entries, doc, 'paragraph');
  const { entries, seq } = collectEntries(doc, mapped, prev.seq);
  return { entries, seq, decorations: buildDecorations(doc, entries, editor, options) };
}

export const DataCardExtension = Extension.create<DataCardExtensionOptions>({
  name: 'squisqDataCard',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    const options = this.options;
    if (options.enabled === false) return [];

    return [
      new Plugin<DataCardPluginState>({
        key: DATA_CARD_KEY,
        state: {
          init: (_config, state) => {
            const { entries, seq } = collectEntries(state.doc, null, 0);
            return {
              entries,
              seq,
              decorations: buildDecorations(state.doc, entries, editor, options),
            };
          },
          apply: (tr, prev, _oldState, newState) =>
            applyState(tr, prev, editor, newState.doc, options),
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

export default DataCardExtension;
