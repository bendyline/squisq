/**
 * HostFenceExtension — mounts HOST-registered fence renderers
 * (`@bendyline/squisq/fence`) inside the WYSIWYG editor.
 *
 * Structurally a sibling of TreeViewExtension/CodeSnippetExtension:
 * position registry with stable synthetic ids, `mapFenceEntries` for
 * boundary-churn survival, hide-the-fence node decoration + a widget
 * decoration hosting a React root with `containFenceWidgetEvents`.
 *
 * Ownership is simply "the host registry claims this fence language".
 * The registry is read through a GETTER (the `mentionProvider` pattern)
 * so renderer implementations can change without remounting the editor;
 * the *set* of claimed languages is also consulted per-transaction, but
 * remember to pass the same languages to
 * `CodeSnippetExtension.reservedLanguages` or Monaco claims them first.
 *
 * The fence body is the single source of truth. Renderers receive
 * `mode: 'edit'` plus a `replaceValue` callback that rewrites the fence
 * text in one undoable transaction; the info-string meta is NOT provided
 * (it does not survive the ProseMirror round-trip — payload lives in the
 * body, see the fence contract docs).
 *
 * The React surface lives in `HostFenceWidget.tsx`, mirroring how every
 * other fence family splits its `.ts` extension from its `.tsx` widget.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { Theme } from '@bendyline/squisq/schemas';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
import { replaceAsciiFenceText } from '../asciiDiagram/asciiDiagramCommands';
import { containFenceWidgetEvents } from './fenceWidgetHost';
import { HostFenceWidget } from './HostFenceWidget';
import { mapFenceEntries, type FenceBlockEntry } from './fenceRegistry';

export type HostFenceBlockEntry = FenceBlockEntry;

export interface HostFencePluginState {
  entries: HostFenceBlockEntry[];
  decorations: DecorationSet;
  seq: number;
}

export const HOST_FENCE_KEY = new PluginKey<HostFencePluginState>('squisq-host-fence');

export interface HostFenceExtensionOptions {
  /** When false, the extension is inert. */
  enabled?: boolean;
  /**
   * Getter for the host registry — read on every ownership check so
   * renderer implementations stay live without an editor remount.
   */
  renderers?: () => FenceRendererMap | null | undefined;
  /** Getter for the active theme, forwarded into the render context. */
  theme?: () => Theme | undefined;
}

/** The fence's declared language, normalized to a bare lowercase token. */
export function fenceLangToken(node: PMNode): string {
  const lang = (node.attrs as { language?: string | null }).language;
  if (typeof lang !== 'string') return '';
  return lang.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

export function findHostFenceBlockPos(editor: Editor, blockId: string): number | null {
  return HOST_FENCE_KEY.getState(editor.state)?.entries.find((e) => e.id === blockId)?.pos ?? null;
}

/**
 * Replace a claimed fence's body in one undoable transaction. This is
 * what backs `FenceRenderContext.replaceValue` in edit mode; exported so
 * hosts building their own extensions get the same write boundary
 * (read-only enforcement included) as the built-in fence families.
 */
export function replaceHostFenceText(editor: Editor, blockId: string, next: string): boolean {
  const pos = findHostFenceBlockPos(editor, blockId);
  if (pos === null) return false;
  return replaceAsciiFenceText(editor, pos, next);
}

interface WidgetRootRef {
  root: Root;
}

function buildDecorations(
  doc: PMNode,
  entries: HostFenceBlockEntry[],
  editor: Editor,
  options: HostFenceExtensionOptions,
): DecorationSet {
  const decos: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || node.type.name !== 'codeBlock') continue;
    decos.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, {
        class: 'squisq-host-fence-hidden',
      }),
    );
    const blockId = entry.id;
    decos.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        () => {
          const container = document.createElement('div');
          container.className = 'squisq-host-fence-widget-host';
          container.contentEditable = 'false';
          // Host widgets carry arbitrary form controls; contain the whole
          // edit/composition/clipboard stream so ProseMirror can't replay
          // it at the document selection.
          containFenceWidgetEvents(container);
          const root = createRoot(container);
          root.render(
            createElement(HostFenceWidget, {
              editor,
              blockId,
              getRenderers: () => options.renderers?.(),
              getTheme: () => options.theme?.(),
            }),
          );
          (
            container as HTMLElement & { __squisqHostFenceRoot?: WidgetRootRef }
          ).__squisqHostFenceRoot = { root };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqHostFenceRoot?: WidgetRootRef })
              .__squisqHostFenceRoot;
            if (ref) setTimeout(() => ref.root.unmount(), 0);
          },
          side: 1,
          ignoreSelection: true,
          key: `squisq-host-fence-${entry.id}`,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

function claims(node: PMNode, options: HostFenceExtensionOptions): boolean {
  if (node.type.name !== 'codeBlock') return false;
  const lang = fenceLangToken(node);
  if (!lang) return false;
  return Boolean(options.renderers?.()?.[lang]);
}

function applyState(
  tr: Transaction,
  prev: HostFencePluginState,
  editor: Editor,
  doc: PMNode,
  options: HostFenceExtensionOptions,
): HostFencePluginState {
  if (!tr.docChanged) return prev;

  const mapped = mapFenceEntries(tr, prev.entries, doc);

  let seq = prev.seq;
  const entries: HostFenceBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    if (!claims(node, options)) return false;
    entries.push({ id: mapped.get(pos) ?? `host-fence-${++seq}`, pos });
    return false;
  });

  return { entries, seq, decorations: buildDecorations(doc, entries, editor, options) };
}

export const HostFenceExtension = Extension.create<HostFenceExtensionOptions>({
  name: 'squisqHostFence',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    const options = this.options;
    if (options.enabled === false || !options.renderers) return [];

    return [
      new Plugin<HostFencePluginState>({
        key: HOST_FENCE_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries: HostFenceBlockEntry[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return;
              if (!claims(node, options)) return false;
              entries.push({ id: `host-fence-${++seq}`, pos });
              return false;
            });
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

export default HostFenceExtension;
