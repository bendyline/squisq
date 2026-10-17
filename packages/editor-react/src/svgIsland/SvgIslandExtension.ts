/**
 * Tiptap extension for `svg` code fences (SVG islands).
 *
 * The code block stays the document's source of truth: the extension hides
 * it and mounts a widget after it that shows the island as a picture, with a
 * Source view (a Monaco inset) that edits the fence body. Nothing but the
 * author's own edits is ever written back, so an untouched island round-trips
 * byte-identically.
 *
 * A host that registers its own `svg` fence renderer owns those fences
 * instead (the `HostFenceExtension` mounts it), as on the read path.
 */

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';
import { createElement } from 'react';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
import { isSvgIslandLang } from '@bendyline/squisq/markdown';
import { mountWidgetRoot, type WidgetRoot } from '../widgetRoot';
import { containFenceWidgetEvents } from '../fenceWidgets/fenceWidgetHost';
import { mapFenceEntries, type FenceBlockEntry } from '../fenceWidgets/fenceRegistry';
import { SvgIslandWidget } from './SvgIslandWidget';

export type SvgIslandBlockEntry = FenceBlockEntry;

export interface SvgIslandPluginState {
  entries: SvgIslandBlockEntry[];
  decorations: DecorationSet;
  /**
   * Islands showing their Source view. Held here rather than in the widget,
   * so it survives ProseMirror re-creating the widget's DOM.
   */
  sourceVisible: ReadonlySet<string>;
  seq: number;
}

export interface SvgIslandExtensionOptions {
  /** When false, leave svg fences as ordinary code blocks. */
  enabled?: boolean;
  /** Live host fence-renderer registry; a host `svg` renderer wins. */
  renderers?: () => FenceRendererMap | null | undefined;
}

export const SVG_ISLAND_KEY = new PluginKey<SvgIslandPluginState>('squisq-svg-island');

/** Whether a node is a ```svg fence (whether or not it sanitizes cleanly). */
export function isSvgIslandNode(node: PMNode): boolean {
  if (node.type.name !== 'codeBlock') return false;
  const language = (node.attrs as { language?: unknown }).language;
  return typeof language === 'string' && isSvgIslandLang(language);
}

export function findSvgIslandBlockPos(editor: Editor, blockId: string): number | null {
  const state = SVG_ISLAND_KEY.getState(editor.state);
  return state?.entries.find((entry) => entry.id === blockId)?.pos ?? null;
}

export function isSvgIslandSourceVisible(editor: Editor, blockId: string): boolean {
  return SVG_ISLAND_KEY.getState(editor.state)?.sourceVisible.has(blockId) ?? false;
}

/** Show or hide an island's Source view without changing any document bytes. */
export function toggleSvgIslandSource(editor: Editor, blockId: string): void {
  editor.view.dispatch(editor.state.tr.setMeta(SVG_ISLAND_KEY, { toggleSource: blockId }));
}

/**
 * Replace an island's fence body in one transaction. Honors read-only, and
 * clears the body rather than building an (invalid) empty text node.
 */
export function replaceSvgIslandText(editor: Editor, blockId: string, next: string): boolean {
  if (!editor.isEditable) return false;
  const pos = findSvgIslandBlockPos(editor, blockId);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !isSvgIslandNode(node) || node.textContent === next) return false;
  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  const tr = next
    ? editor.state.tr.replaceWith(from, to, editor.state.schema.text(next))
    : editor.state.tr.delete(from, to);
  editor.view.dispatch(tr);
  return true;
}

interface WidgetRootRef {
  root: WidgetRoot;
}

function buildDecorations(
  doc: PMNode,
  entries: readonly SvgIslandBlockEntry[],
  editor: Editor,
): DecorationSet {
  const decorations: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || !isSvgIslandNode(node)) continue;
    decorations.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, {
        class: 'squisq-svg-island-fence-hidden',
      }),
    );
    const blockId = entry.id;
    decorations.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        (view) => {
          const container = document.createElement('div');
          container.className = 'squisq-svg-island-widget-host';
          container.contentEditable = 'false';
          // The Source view is a Monaco editor; keep its keystrokes,
          // composition and clipboard out of ProseMirror.
          containFenceWidgetEvents(container);
          const root = mountWidgetRoot(
            container,
            'SVG',
            createElement(SvgIslandWidget, {
              editor,
              blockId,
              host: view.dom.parentElement ?? view.dom,
            }),
          );
          (
            container as HTMLElement & { __squisqSvgIslandRoot?: WidgetRootRef }
          ).__squisqSvgIslandRoot = { root };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqSvgIslandRoot?: WidgetRootRef })
              .__squisqSvgIslandRoot;
            if (ref) ref.root.unmount();
          },
          ignoreSelection: true,
          key: `squisq-svg-island-${entry.id}`,
          side: 1,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

function collectEntries(
  doc: PMNode,
  options: SvgIslandExtensionOptions,
  idFor: (pos: number) => string,
): SvgIslandBlockEntry[] {
  if (options.renderers?.()?.svg) return [];
  const entries: SvgIslandBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    if (isSvgIslandNode(node)) entries.push({ id: idFor(pos), pos });
    return false;
  });
  return entries;
}

function applyState(
  tr: Transaction,
  previous: SvgIslandPluginState,
  editor: Editor,
  doc: PMNode,
  options: SvgIslandExtensionOptions,
): SvgIslandPluginState {
  const meta = tr.getMeta(SVG_ISLAND_KEY) as { toggleSource?: string } | undefined;
  let sourceVisible = previous.sourceVisible;
  if (meta?.toggleSource) {
    const next = new Set(sourceVisible);
    if (next.has(meta.toggleSource)) next.delete(meta.toggleSource);
    else next.add(meta.toggleSource);
    sourceVisible = next;
  }
  // The widget reads the toggle itself; the decorations do not depend on it.
  if (!tr.docChanged)
    return sourceVisible === previous.sourceVisible ? previous : { ...previous, sourceVisible };
  const mapped = mapFenceEntries(tr, previous.entries, doc);
  let seq = previous.seq;
  const entries = collectEntries(doc, options, (pos) => mapped.get(pos) ?? `svg-${++seq}`);
  const liveIds = new Set(entries.map((entry) => entry.id));
  return {
    entries,
    seq,
    sourceVisible: new Set([...sourceVisible].filter((id) => liveIds.has(id))),
    decorations: buildDecorations(doc, entries, editor),
  };
}

export const SvgIslandExtension = Extension.create<SvgIslandExtensionOptions>({
  name: 'squisqSvgIsland',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    if (this.options.enabled === false) return [];
    const editor = this.editor as Editor;
    const options = this.options;
    return [
      new Plugin<SvgIslandPluginState>({
        key: SVG_ISLAND_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries = collectEntries(state.doc, options, () => `svg-${++seq}`);
            return {
              entries,
              seq,
              sourceVisible: new Set<string>(),
              decorations: buildDecorations(state.doc, entries, editor),
            };
          },
          apply: (tr, previous, _oldState, newState) =>
            applyState(tr, previous, editor, newState.doc, options),
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

export default SvgIslandExtension;
