/**
 * AsciiDiagramExtension — Tiptap/ProseMirror plugin that turns code blocks
 * containing ASCII box-and-line diagrams into interactive diagram canvases.
 *
 * The FENCE TEXT REMAINS THE SOURCE OF TRUTH: the plugin never converts
 * the document. For each qualifying codeBlock it:
 * 1. hides the `<pre>` via a node decoration (or tags it visible-monospace
 *    when the user toggles "source" mode), and
 * 2. mounts an `AsciiDiagramWidget` after it via a widget decoration.
 *
 * Identity: codeBlocks have no persisted id and their content changes on
 * every canvas edit (self-inflicted fence rewrite), so neither a content
 * hash nor a raw position can key the widget. Instead the plugin keeps a
 * POSITION REGISTRY in its state: each qualifying block gets a synthetic
 * session id (`ascii-N`); on every doc change old positions are remapped
 * through `tr.mapping` and matched against the new doc walk. Same id →
 * same widget decoration key → ProseMirror keeps the DOM + React root
 * alive (pan/zoom survives), exactly like the heading-key trick the
 * legacy DiagramExtension used.
 *
 * Hysteresis: a NEW block must pass full detection (`detectAsciiDiagram`,
 * ≥2 boxes + thresholds); an already-registered block stays interactive
 * while its fence still parses to ≥1 box, so deleting down to one node
 * doesn't kick the user back to a raw code block mid-edit.
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
  detectAsciiDiagram,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
  parseAsciiDiagram,
  type AsciiDiagram,
} from '@bendyline/squisq/doc';
import { AsciiDiagramWidget } from './AsciiDiagramWidget';
import type { SceneTextChannel } from '../scene/text/sceneTextChannel';

export interface AsciiDiagramBlockEntry {
  /** Synthetic session id (`ascii-N`), stable across edits for one block. */
  id: string;
  /** Document position of the codeBlock node at the current state. */
  pos: number;
}

export interface AsciiDiagramPluginState {
  entries: AsciiDiagramBlockEntry[];
  decorations: DecorationSet;
  sourceVisible: ReadonlySet<string>;
  /** Monotonic id allocator. */
  seq: number;
}

export const ASCII_DIAGRAM_KEY = new PluginKey<AsciiDiagramPluginState>('squisq-ascii-diagram');

// ---------------------------------------------------------------------------
// Gate caches — keyed on the PMNode instance. ProseMirror's structural
// sharing reuses node objects for unchanged blocks, so only an actually
// edited fence re-runs detection/parsing.
// ---------------------------------------------------------------------------

const detectCache = new WeakMap<PMNode, AsciiDiagram | null>();
const parseCache = new WeakMap<PMNode, AsciiDiagram | null>();

function fenceLangOf(node: PMNode): string | null {
  const lang = (node.attrs as { language?: string | null }).language;
  return typeof lang === 'string' ? lang : null;
}

/** Full-detection gate for NEW blocks: lang allowlist + content thresholds. */
export function getAsciiDiagramForNode(node: PMNode): AsciiDiagram | null {
  if (node.type.name !== 'codeBlock') return null;
  const cached = detectCache.get(node);
  if (cached !== undefined) return cached;
  let result: AsciiDiagram | null = null;
  const lang = fenceLangOf(node);
  if (isEligibleAsciiFenceLang(lang)) {
    const detection = detectAsciiDiagram(node.textContent, {
      explicit: isExplicitDiagramLang(lang),
    });
    if (detection.isDiagram && detection.diagram) {
      result = detection.diagram;
      parseCache.set(node, result);
    }
  }
  detectCache.set(node, result);
  return result;
}

/** Box-drawing corners/junctions/verticals leaking into a label = a garbled parse. */
const GARBLED_LABEL = /[│┃║┌┐└┘├┤┬┴┼╭╮╰╯┏┓┗┛╔╗╚╝┣┫┳┻╋╠╣╦╩╬]/;

/**
 * Relaxed gate for ALREADY-REGISTERED blocks: any parse with ≥1 box, so
 * editing a diagram down doesn't kick the user out mid-edit. But a GARBLED
 * parse (box-drawing chars leaked into labels — the desync signature of
 * broken art) is never a valid diagram; rejecting it here keeps a broken
 * fence from being held as a diagram by hysteresis (e.g. after undoing a
 * repair, where the fence reverts to broken art the RepairableExtension owns).
 */
export function parseAsciiDiagramForNode(node: PMNode): AsciiDiagram | null {
  if (node.type.name !== 'codeBlock') return null;
  const cached = parseCache.get(node);
  if (cached !== undefined) return cached;
  let result: AsciiDiagram | null = null;
  if (isEligibleAsciiFenceLang(fenceLangOf(node))) {
    const parsed = parseAsciiDiagram(node.textContent);
    if (parsed.nodes.length > 0 && !parsed.nodes.some((n) => GARBLED_LABEL.test(n.label))) {
      result = parsed;
    }
  }
  parseCache.set(node, result);
  return result;
}

/** Resolve a registered block's current doc position (null when gone). */
export function findAsciiDiagramBlockPos(editor: Editor, blockId: string): number | null {
  const state = ASCII_DIAGRAM_KEY.getState(editor.state);
  return state?.entries.find((e) => e.id === blockId)?.pos ?? null;
}

export function isAsciiSourceVisible(editor: Editor, blockId: string): boolean {
  const state = ASCII_DIAGRAM_KEY.getState(editor.state);
  return state?.sourceVisible.has(blockId) ?? false;
}

/** Toggle the raw-fence view for one diagram block (meta-only transaction). */
export function toggleAsciiSource(editor: Editor, blockId: string): void {
  const tr = editor.state.tr.setMeta(ASCII_DIAGRAM_KEY, { toggleSource: blockId });
  editor.view.dispatch(tr);
}

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

interface WidgetRootRef {
  root: Root;
}

function buildDecorations(
  doc: PMNode,
  entries: AsciiDiagramBlockEntry[],
  sourceVisible: ReadonlySet<string>,
  editor: Editor,
  textChannel?: SceneTextChannel,
): DecorationSet {
  const decos: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || node.type.name !== 'codeBlock') continue;
    const cls = sourceVisible.has(entry.id)
      ? 'squisq-ascii-fence-source'
      : 'squisq-ascii-fence-hidden';
    decos.push(Decoration.node(entry.pos, entry.pos + node.nodeSize, { class: cls }));
    const blockId = entry.id;
    const fallbackPos = entry.pos;
    decos.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        (view) => {
          const container = document.createElement('div');
          container.className = 'squisq-ascii-diagram-widget-host';
          container.contentEditable = 'false';
          // Keep ProseMirror from treating clicks/keys inside the widget
          // as document interactions.
          container.addEventListener('mousedown', (e) => e.stopPropagation());
          container.addEventListener('keydown', (e) => e.stopPropagation());
          const root = createRoot(container);
          root.render(
            createElement(AsciiDiagramWidget, {
              editor,
              blockId,
              fallbackPos,
              host: view.dom.parentElement ?? view.dom,
              textChannel,
            }),
          );
          (container as HTMLElement & { __squisqAsciiRoot?: WidgetRootRef }).__squisqAsciiRoot = {
            root,
          };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqAsciiRoot?: WidgetRootRef })
              .__squisqAsciiRoot;
            // Defer so React isn't unmounted mid-render.
            if (ref) setTimeout(() => ref.root.unmount(), 0);
          },
          side: 1,
          ignoreSelection: true,
          key: `squisq-ascii-${entry.id}`,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

function applyState(
  tr: Transaction,
  prev: AsciiDiagramPluginState,
  editor: Editor,
  doc: PMNode,
  textChannel?: SceneTextChannel,
): AsciiDiagramPluginState {
  const meta = tr.getMeta(ASCII_DIAGRAM_KEY) as { toggleSource?: string } | undefined;
  let sourceVisible = prev.sourceVisible;
  if (meta?.toggleSource) {
    const next = new Set(sourceVisible);
    if (next.has(meta.toggleSource)) next.delete(meta.toggleSource);
    else next.add(meta.toggleSource);
    sourceVisible = next;
  }

  if (!tr.docChanged) {
    if (!meta?.toggleSource) return prev;
    return {
      ...prev,
      sourceVisible,
      decorations: buildDecorations(doc, prev.entries, sourceVisible, editor, textChannel),
    };
  }

  // Doc changed: remap known positions (bias 1 so an insertion exactly at
  // the block's start shifts the tracked position forward WITH the node),
  // then walk the new doc and reconcile.
  const mapped = new Map<number, string>();
  const claimed = new Set<string>();
  // Pass 1: survivors whose start position wasn't touched.
  for (const entry of prev.entries) {
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (!result.deleted) {
      mapped.set(result.pos, entry.id);
      claimed.add(entry.id);
    }
  }
  // Pass 2: boundary-churn survivors. An attrs-only `setNodeMarkup` (the
  // language-promotion step) rewrites the codeBlock's opening token, so
  // `mapResult` reports the start as `deleted` even though the block is still
  // there. Adopt the old id when a codeBlock still sits at the mapped position
  // and that slot isn't already claimed — this keeps the widget's React root
  // (pan/zoom) alive across the one-time promotion, instead of remounting.
  for (const entry of prev.entries) {
    if (claimed.has(entry.id)) continue;
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (mapped.has(result.pos)) continue;
    if (doc.nodeAt(result.pos)?.type.name === 'codeBlock') {
      mapped.set(result.pos, entry.id);
      claimed.add(entry.id);
    }
  }

  let seq = prev.seq;
  const entries: AsciiDiagramBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    const knownId = mapped.get(pos);
    // Hysteresis: known blocks stay while they parse at all; new blocks
    // must pass full detection.
    const diagram = knownId ? parseAsciiDiagramForNode(node) : getAsciiDiagramForNode(node);
    if (!diagram) return false;
    entries.push({ id: knownId ?? `ascii-${++seq}`, pos });
    return false;
  });

  const liveIds = new Set(entries.map((e) => e.id));
  const prunedSourceVisible = new Set([...sourceVisible].filter((id) => liveIds.has(id)));

  return {
    entries,
    seq,
    sourceVisible: prunedSourceVisible,
    decorations: buildDecorations(doc, entries, prunedSourceVisible, editor, textChannel),
  };
}

export interface AsciiDiagramExtensionOptions {
  /** When false, the extension is inert (no widgets, no decorations). */
  enabled?: boolean;
  textChannel?: SceneTextChannel;
}

export const AsciiDiagramExtension = Extension.create<AsciiDiagramExtensionOptions>({
  name: 'squisqAsciiDiagram',

  addOptions() {
    return {
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    if (this.options.enabled === false) return [];

    return [
      new Plugin<AsciiDiagramPluginState>({
        key: ASCII_DIAGRAM_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries: AsciiDiagramBlockEntry[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return;
              if (!getAsciiDiagramForNode(node)) return false;
              entries.push({ id: `ascii-${++seq}`, pos });
              return false;
            });
            return {
              entries,
              seq,
              sourceVisible: new Set<string>(),
              decorations: buildDecorations(
                state.doc,
                entries,
                new Set(),
                editor,
                this.options.textChannel,
              ),
            };
          },
          apply: (tr, prev, _oldState, newState) =>
            applyState(tr, prev, editor, newState.doc, this.options.textChannel),
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

export default AsciiDiagramExtension;
