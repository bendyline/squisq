/**
 * AccessoryBlocksExtension — folds a section's accessory blocks (slide
 * summaries: `### Headline {[summary]}`) into one row in the Write view.
 *
 * Accessory blocks are part of the document's markdown — side information
 * about the section above them — but never slides or narration, so the view
 * shows them quietly and out of the way:
 *
 * - **One row per section.** Each run of consecutive accessory blocks gets a
 *   "Slide summaries (3)" row in its place, collapsed by default. Its button
 *   opens the run inline (muted, editable as ordinary headings and lists) and
 *   closes it again. Which runs are open is view state: never saved, never an
 *   undo step, and forgotten when the view closes.
 * - **Folded text cannot be edited by accident.** The caret steps over a
 *   folded run; Backspace or Delete at its edge opens it rather than merging
 *   text into a summary nobody can see; a selection inside one (a Find match,
 *   a proofing finding) opens it.
 * - **Summaries stay with their section** (`accessoryBlockRepairs.ts`).
 *
 * The document stays a flat list of headings and paragraphs — the outline,
 * block positions and the markdown bridge all rely on that — so everything
 * here is decorations, like the document tray's hidden media.
 */

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { ACCESSORY_BLOCK_TYPES, isAccessoryBlockType } from '@bendyline/squisq/doc';
import { DOCUMENT_TRAY_KEY } from '../documentTray/DocumentTrayExtension';
import { computeAccessoryRuns, type AccessoryRun } from './accessoryBlockRuns';
import { accessoryRunRepair, skipsAccessoryRepairs } from './accessoryBlockRepairs';

export interface AccessoryBlocksState {
  runs: AccessoryRun[];
  /**
   * The runs the reader opened: each one's position (`run.from`) and key. The
   * position follows edits; the key finds the run again when an edit (a
   * reload of the whole document) loses the position.
   */
  open: ReadonlyMap<number, string>;
  decorations: DecorationSet;
}

export const ACCESSORY_BLOCKS_KEY = new PluginKey<AccessoryBlocksState>('squisq-accessory-blocks');
/** Class on every node of a run; with `--hidden` while the run is folded. */
export const ACCESSORY_NODE_CLASS = 'squisq-accessory-block-node';
export const ACCESSORY_HIDDEN_CLASS = 'squisq-accessory-block-node--hidden';
const ROW_CLASS = 'squisq-accessory-row';
const ROW_KEY_ATTRIBUTE = 'data-accessory-run';

type AccessoryMeta = { toggle: number } | { expand: number } | { collapse: number };

function isOpen(state: AccessoryBlocksState, run: AccessoryRun): boolean {
  return state.open.has(run.from);
}

/** Which of `runs` stay open after `tr`. */
function openAfter(
  prev: AccessoryBlocksState,
  tr: Transaction,
  runs: readonly AccessoryRun[],
): Map<number, string> {
  if (!tr.docChanged) return new Map(prev.open);
  const positions = new Set<number>();
  const lostKeys = new Set<string>();
  for (const [pos, key] of prev.open) {
    const result = tr.mapping.mapResult(pos, 1);
    if (result.deleted) lostKeys.add(key);
    else positions.add(result.pos);
  }
  const open = new Map<number, string>();
  for (const run of runs) {
    if (positions.has(run.from) || lostKeys.has(run.key)) open.set(run.from, run.key);
  }
  return open;
}

/** Open or close the run whose row has this key (the row's button calls this). */
export function toggleAccessoryRun(view: EditorView, key: string): void {
  const run = ACCESSORY_BLOCKS_KEY.getState(view.state)?.runs.find((item) => item.key === key);
  if (!run) return;
  view.dispatch(
    view.state.tr
      .setMeta(ACCESSORY_BLOCKS_KEY, { toggle: run.from } satisfies AccessoryMeta)
      .setMeta('addToHistory', false),
  );
}

/** Open the run containing `pos`, if it is folded — for code that moves the caret there. */
export function revealAccessoryBlockAt(view: EditorView, pos: number): boolean {
  const state = ACCESSORY_BLOCKS_KEY.getState(view.state);
  const run = state?.runs.find((item) => pos >= item.from && pos < item.to);
  if (!state || !run || isOpen(state, run)) return false;
  view.dispatch(
    view.state.tr
      .setMeta(ACCESSORY_BLOCKS_KEY, { expand: run.from } satisfies AccessoryMeta)
      .setMeta('addToHistory', false),
  );
  return true;
}

/** "Slide summaries (3)": what a run holds, by the accessory registry. */
export function accessoryRunLabel(run: Pick<AccessoryRun, 'blocks'>): string {
  const counts = new Map<string, number>();
  for (const block of run.blocks) counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
  return [...counts]
    .map(([type, count]) => {
      const info = isAccessoryBlockType(type) ? ACCESSORY_BLOCK_TYPES[type] : undefined;
      if (!info) return `${count} × ${type}`;
      return count === 1 ? info.label : `${info.pluralLabel} (${count})`;
    })
    .join(' · ');
}

function buildState(
  doc: PMNode,
  runs: AccessoryRun[],
  open: Map<number, string>,
): AccessoryBlocksState {
  const decorations: Decoration[] = [];
  let index = 0;
  doc.forEach((node, pos) => {
    while (index < runs.length && runs[index]!.to <= pos) index += 1;
    const run = runs[index];
    if (!run || pos < run.from) return;
    if (pos === run.from) {
      decorations.push(
        Decoration.widget(pos, (view) => rowElement(view, run.key), {
          side: -1,
          ignoreSelection: true,
          key: `${ROW_CLASS}:${run.key}`,
          stopEvent: () => true,
        }),
      );
    }
    const folded = !open.has(run.from);
    decorations.push(
      Decoration.node(
        pos,
        pos + node.nodeSize,
        {
          class: folded
            ? `${ACCESSORY_NODE_CLASS} ${ACCESSORY_HIDDEN_CLASS}`
            : ACCESSORY_NODE_CLASS,
        },
        { accessoryHidden: folded },
      ),
    );
  });
  return { runs, open, decorations: DecorationSet.create(doc, decorations) };
}

/** The row's DOM. Its label and state are written by `syncRows` after every update. */
function rowElement(view: EditorView, key: string): HTMLElement {
  const row = document.createElement('div');
  row.className = ROW_CLASS;
  row.contentEditable = 'false';
  row.setAttribute(ROW_KEY_ATTRIBUTE, key);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${ROW_CLASS}-toggle`;
  const chevron = document.createElement('span');
  chevron.className = `${ROW_CLASS}-chevron`;
  chevron.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = `${ROW_CLASS}-label`;
  button.append(chevron, label);
  // Keep the editor's focus and selection; the click does the work.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    toggleAccessoryRun(view, row.getAttribute(ROW_KEY_ATTRIBUTE) ?? key);
  });
  row.append(button);
  syncRow(row, view.state);
  return row;
}

function syncRow(row: HTMLElement, state: EditorState): void {
  const plugin = ACCESSORY_BLOCKS_KEY.getState(state);
  const run = plugin?.runs.find((item) => item.key === row.getAttribute(ROW_KEY_ATTRIBUTE));
  if (!plugin || !run) return;
  const open = isOpen(plugin, run);
  const button = row.querySelector('button');
  const label = row.querySelector(`.${ROW_CLASS}-label`);
  const text = accessoryRunLabel(run);
  if (label && label.textContent !== text) label.textContent = text;
  button?.setAttribute('aria-expanded', String(open));
  button?.setAttribute('title', open ? 'Hide' : 'Show');
  row.classList.toggle(`${ROW_CLASS}--open`, open);
}

function syncRows(view: EditorView): void {
  for (const row of view.dom.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`)) {
    syncRow(row, view.state);
  }
}

function foldedRunAt(state: EditorState, pos: number): AccessoryRun | undefined {
  const plugin = ACCESSORY_BLOCKS_KEY.getState(state);
  return plugin?.runs.find((run) => pos >= run.from && pos < run.to && !isOpen(plugin, run));
}

function inDocumentTray(state: EditorState, pos: number): boolean {
  return (
    DOCUMENT_TRAY_KEY.getState(state)?.items.some(
      (item) => pos >= item.pos && pos < item.pos + item.node.nodeSize,
    ) ?? false
  );
}

/** Move a caret out of folded summaries, in the direction it was travelling. */
function evict(oldState: EditorState, state: EditorState): Transaction | null {
  const { selection } = state;
  if (!selection.empty && !(selection instanceof NodeSelection)) return null;
  if (!foldedRunAt(state, selection.from)) return null;
  const direction = selection.from < oldState.selection.from ? -1 : 1;
  for (const step of [direction, -direction]) {
    let at = selection.from;
    let run = foldedRunAt(state, at);
    while (run) {
      const edge = step > 0 ? run.to : run.from;
      const next = Selection.findFrom(state.doc.resolve(edge), step, true);
      if (!next || inDocumentTray(state, next.from)) break;
      at = next.from;
      run = foldedRunAt(state, at);
      if (!run) return state.tr.setSelection(next).setMeta('addToHistory', false);
    }
  }
  return null;
}

export const AccessoryBlocksExtension = Extension.create({
  name: 'squisqAccessoryBlocks',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<AccessoryBlocksState>({
        key: ACCESSORY_BLOCKS_KEY,
        state: {
          init: (_config, state) =>
            buildState(state.doc, computeAccessoryRuns(state.doc), new Map()),
          apply: (tr, prev) => {
            const meta = tr.getMeta(ACCESSORY_BLOCKS_KEY) as AccessoryMeta | undefined;
            if (!tr.docChanged && !meta) return prev;
            const runs = tr.docChanged ? computeAccessoryRuns(tr.doc) : prev.runs;
            const open = openAfter(prev, tr, runs);
            if (meta) {
              const at =
                'toggle' in meta ? meta.toggle : 'expand' in meta ? meta.expand : meta.collapse;
              const run = runs.find((item) => item.from === at);
              const wanted = 'toggle' in meta ? !open.has(at) : 'expand' in meta;
              if (run && wanted) open.set(at, run.key);
              else open.delete(at);
            }
            return buildState(tr.doc, runs, open);
          },
        },
        appendTransaction: (transactions, oldState, state) => {
          // Summaries stay with their section.
          if (editor.isEditable && !skipsAccessoryRepairs(transactions)) {
            const before = ACCESSORY_BLOCKS_KEY.getState(oldState);
            if (before?.runs.length) {
              const mapping = new Mapping();
              for (const tr of transactions) mapping.appendMapping(tr.mapping);
              const repair = accessoryRunRepair(
                before.runs,
                oldState.doc,
                mapping,
                state,
                (run) => !isOpen(before, run),
              );
              if (repair) return repair;
            }
          }
          // A selection inside folded summaries (a Find match, a proofing
          // finding) opens them; a caret steps over them.
          const { selection } = state;
          if (!selection.empty && !(selection instanceof NodeSelection)) {
            const run = foldedRunAt(state, selection.from);
            if (run && selection.to <= run.to)
              return state.tr
                .setMeta(ACCESSORY_BLOCKS_KEY, { expand: run.from } satisfies AccessoryMeta)
                .setMeta('addToHistory', false);
            return null;
          }
          return evict(oldState, state);
        },
        view: (view) => {
          syncRows(view);
          return { update: (next) => syncRows(next) };
        },
        props: {
          decorations: (state) => ACCESSORY_BLOCKS_KEY.getState(state)?.decorations,
          // Backspace at the start of the line after folded summaries, or
          // Delete at the end of the line before them, would merge text into a
          // summary nobody can see. The first press opens them instead.
          handleKeyDown: (view, event) => {
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
            const { selection } = view.state;
            if (!selection.empty || !selection.$from.parent.isTextblock) return false;
            const { $from } = selection;
            const backward = event.key === 'Backspace';
            if (
              $from.depth !== 1 ||
              $from.parentOffset !== (backward ? 0 : $from.parent.content.size)
            )
              return false;
            const edge = backward ? $from.before() : $from.after();
            const plugin = ACCESSORY_BLOCKS_KEY.getState(view.state);
            const run = plugin?.runs.find((item) =>
              backward ? item.to === edge : item.from === edge,
            );
            if (!plugin || !run || isOpen(plugin, run)) return false;
            view.dispatch(
              view.state.tr
                .setMeta(ACCESSORY_BLOCKS_KEY, { expand: run.from } satisfies AccessoryMeta)
                .setMeta('addToHistory', false),
            );
            return true;
          },
        },
      }),
    ];
  },
});

export default AccessoryBlocksExtension;
