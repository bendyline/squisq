import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { mapFenceEntries } from '../fenceWidgets/fenceRegistry';
import { collectDocumentTrayMedia, type LocatedTrayMedia } from './documentTrayMedia';

export interface DocumentTrayItem extends LocatedTrayMedia {
  id: string;
}

export interface DocumentTrayState {
  enabled: boolean;
  items: DocumentTrayItem[];
  decorations: DecorationSet;
  seq: number;
}

export const DOCUMENT_TRAY_KEY = new PluginKey<DocumentTrayState>('squisq-document-tray');
export const DOCUMENT_TRAY_ATTRIBUTE = 'data-squisq-document-tray';

/** Node views must not mount a second player behind the hidden source node. */
export function isDocumentTrayDecoration(decorations: readonly Decoration[]): boolean {
  return decorations.some((decoration) => decoration.spec.documentTray === true);
}

function rangeInTray(state: EditorState, from: number, to: number): boolean {
  return (
    DOCUMENT_TRAY_KEY.getState(state)?.items.some(
      (item) =>
        from >= item.pos &&
        from < item.pos + item.node.nodeSize &&
        to <= item.pos + item.node.nodeSize,
    ) ?? false
  );
}

function startBody(state: EditorState): Transaction {
  const pos = state.doc.content.size;
  const tr = state.tr.insert(pos, state.schema.nodes.paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, pos + 1));
}

function buildState(
  doc: PMNode,
  enabled: boolean,
  prev?: DocumentTrayState,
  tr?: Transaction,
): DocumentTrayState {
  let seq = prev?.seq ?? 0;
  const mapped = new Map<number, string>();
  if (prev && tr) {
    for (const type of ['audio', 'video', 'paragraph']) {
      const entries = prev.items.filter((item) => item.node.type.name === type);
      for (const [pos, id] of mapFenceEntries(tr, entries, doc, type)) mapped.set(pos, id);
    }
  }
  const items = enabled
    ? collectDocumentTrayMedia(doc).map((item) => ({
        ...item,
        id: mapped.get(item.pos) ?? `document-media-${++seq}`,
      }))
    : [];
  return {
    enabled,
    items,
    seq,
    decorations: DecorationSet.create(
      doc,
      items.map((item) =>
        Decoration.node(
          item.pos,
          item.pos + item.node.nodeSize,
          { [DOCUMENT_TRAY_ATTRIBUTE]: item.id, class: 'squisq-document-tray-source' },
          { documentTray: true },
        ),
      ),
    ),
  };
}

export const DocumentTrayExtension = Extension.create<{ enabled: boolean }>({
  name: 'squisqDocumentTray',
  // The hosted-video plugin reads this state to avoid mounting duplicate iframes.
  priority: 110,
  addOptions() {
    return { enabled: true };
  },
  addProseMirrorPlugins() {
    const enabled = this.options.enabled;
    return [
      new Plugin<DocumentTrayState>({
        key: DOCUMENT_TRAY_KEY,
        state: {
          init: (_config, state) => buildState(state.doc, enabled),
          apply: (tr, prev) => {
            const setting: unknown = tr.getMeta(DOCUMENT_TRAY_KEY);
            const active = typeof setting === 'boolean' ? setting : prev.enabled;
            return tr.docChanged || active !== prev.enabled
              ? buildState(tr.doc, active, prev, tr)
              : prev;
          },
        },
        appendTransaction: (_transactions, oldState, state) => {
          const items = DOCUMENT_TRAY_KEY.getState(state)?.items ?? [];
          if (
            !items.length ||
            (!state.selection.empty && !(state.selection instanceof NodeSelection))
          )
            return null;
          const containingItem = (position: number) =>
            items.find((item) => position >= item.pos && position < item.pos + item.node.nodeSize);
          if (!containingItem(state.selection.from)) return null;
          const direction = state.selection.from < oldState.selection.from ? -1 : 1;
          for (const step of [direction, -direction]) {
            let at = state.selection.from;
            let hidden = containingItem(at);
            while (hidden) {
              at = step > 0 ? hidden.pos + hidden.node.nodeSize : hidden.pos;
              const next = Selection.findFrom(state.doc.resolve(at), step, true);
              if (!next) break;
              hidden = containingItem(next.from);
              if (!hidden) return state.tr.setSelection(next).setMeta('addToHistory', false);
            }
          }
          return null;
        },
        props: {
          decorations: (state) => DOCUMENT_TRAY_KEY.getState(state)?.decorations,
          // A media-only document has no visible caret target yet. Start the
          // body on the first typed character instead of editing a hidden
          // annotation; this is a real, undoable user edit, never a mount edit.
          handleTextInput: (view, from, to, text) => {
            if (!rangeInTray(view.state, from, to)) return false;
            view.dispatch(startBody(view.state).insertText(text));
            return true;
          },
          handlePaste: (view, _event, slice) => {
            const { from, to } = view.state.selection;
            if (!rangeInTray(view.state, from, to)) return false;
            view.dispatch(startBody(view.state).replaceSelection(slice).scrollIntoView());
            return true;
          },
          // Backspace at the first body paragraph must not silently delete an
          // invisible attachment. Tray removal has an explicit, undoable action.
          handleKeyDown: (view, event) => {
            const { selection } = view.state;
            if (
              (selection.empty || selection instanceof NodeSelection) &&
              rangeInTray(view.state, selection.from, selection.to)
            ) {
              if (event.key === 'Enter') {
                view.dispatch(startBody(view.state).scrollIntoView());
                return true;
              }
              if (event.key === 'Backspace' || event.key === 'Delete') return true;
            }
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
            if (!selection.empty || !selection.$from.parent.isTextblock) return false;
            const backward = event.key === 'Backspace';
            const { $from } = selection;
            if (
              $from.depth !== 1 ||
              $from.parentOffset !== (backward ? 0 : $from.parent.content.size)
            )
              return false;
            const edge = backward ? $from.before() : $from.after();
            return (
              DOCUMENT_TRAY_KEY.getState(view.state)?.items.some((item) =>
                backward ? item.pos + item.node.nodeSize === edge : item.pos === edge,
              ) ?? false
            );
          },
        },
      }),
    ];
  },
});
