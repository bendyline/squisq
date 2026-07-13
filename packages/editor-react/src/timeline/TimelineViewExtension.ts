/**
 * TimelineViewExtension — mounts a WYSIWYG timeline editor over qualifying
 * authored timeline code fences while keeping the fence text as source of
 * truth. Every semantic edit is rendered back through the core codec.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  detectAsciiTimeline,
  isEligibleAsciiTimelineFenceLang,
  isExplicitTimelineLang,
  type AsciiTimeline,
} from '@bendyline/squisq/doc';
import { TimelineEditorWidget } from './TimelineEditorWidget';

export interface TimelineBlockEntry {
  /** Synthetic session id, stable across edits to one fence. */
  id: string;
  /** Current document position of the codeBlock node. */
  pos: number;
}

export interface TimelineViewPluginState {
  entries: TimelineBlockEntry[];
  decorations: DecorationSet;
  seq: number;
}

export const TIMELINE_VIEW_KEY = new PluginKey<TimelineViewPluginState>('squisq-timeline-view');

const detectCache = new WeakMap<PMNode, AsciiTimeline | null>();
const parseCache = new WeakMap<PMNode, AsciiTimeline | null>();

function fenceLangOf(node: PMNode): string | null {
  const language = (node.attrs as { language?: string | null }).language;
  return typeof language === 'string' ? language : null;
}

function eventCount(timeline: AsciiTimeline): number {
  return timeline.tracks.reduce((sum, track) => sum + track.events.length, 0);
}

/** Conservative full-detection gate used when first claiming a code fence. */
export function getTimelineForNode(node: PMNode): AsciiTimeline | null {
  if (node.type.name !== 'codeBlock') return null;
  const cached = detectCache.get(node);
  if (cached !== undefined) return cached;

  let result: AsciiTimeline | null = null;
  const language = fenceLangOf(node);
  if (isEligibleAsciiTimelineFenceLang(language)) {
    const detection = detectAsciiTimeline(node.textContent, {
      explicit: isExplicitTimelineLang(language),
    });
    if (detection.isTimeline && detection.timeline && eventCount(detection.timeline) > 0) {
      result = detection.timeline;
      parseCache.set(node, result);
    }
  }
  detectCache.set(node, result);
  return result;
}

/** Relaxed/sticky gate for a block already registered by this extension. */
export function parseTimelineForNode(node: PMNode): AsciiTimeline | null {
  if (node.type.name !== 'codeBlock') return null;
  const cached = parseCache.get(node);
  if (cached !== undefined) return cached;

  let result: AsciiTimeline | null = null;
  if (isEligibleAsciiTimelineFenceLang(fenceLangOf(node))) {
    const detection = detectAsciiTimeline(node.textContent, { explicit: true });
    if (detection.isTimeline && detection.timeline && eventCount(detection.timeline) > 0) {
      result = detection.timeline;
    }
  }
  parseCache.set(node, result);
  return result;
}

export function findTimelineBlockPos(editor: Editor, blockId: string): number | null {
  return (
    TIMELINE_VIEW_KEY.getState(editor.state)?.entries.find((entry) => entry.id === blockId)?.pos ??
    null
  );
}

interface TimelineWidgetHost extends HTMLElement {
  __squisqTimelineRoot?: Root;
}

function buildDecorations(
  doc: PMNode,
  entries: readonly TimelineBlockEntry[],
  editor: Editor,
): DecorationSet {
  const decorations: Decoration[] = [];
  for (const entry of entries) {
    const node = doc.nodeAt(entry.pos);
    if (!node || node.type.name !== 'codeBlock') continue;

    decorations.push(
      Decoration.node(entry.pos, entry.pos + node.nodeSize, {
        class: 'squisq-ascii-timeline-fence-hidden',
      }),
    );
    decorations.push(
      Decoration.widget(
        entry.pos + node.nodeSize,
        () => {
          const container = document.createElement('div') as TimelineWidgetHost;
          container.className = 'squisq-ascii-timeline-widget-host';
          container.contentEditable = 'false';
          // The widget contains real form controls inside a ProseMirror
          // decoration. Keep their complete edit/composition stream inside
          // the React root so browser/IME `beforeinput` events cannot also be
          // interpreted as text insertion at the document selection.
          for (const eventName of [
            'pointerdown',
            'mousedown',
            'keydown',
            'keyup',
            'beforeinput',
            'input',
            'change',
            'compositionstart',
            'compositionupdate',
            'compositionend',
            'paste',
            'cut',
          ]) {
            container.addEventListener(eventName, (event) => event.stopPropagation());
          }
          const root = createRoot(container);
          root.render(createElement(TimelineEditorWidget, { editor, blockId: entry.id }));
          container.__squisqTimelineRoot = root;
          return container;
        },
        {
          destroy: (dom) => {
            const root = (dom as TimelineWidgetHost).__squisqTimelineRoot;
            if (root) setTimeout(() => root.unmount(), 0);
          },
          side: 1,
          ignoreSelection: true,
          key: `squisq-timeline-${entry.id}`,
        },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

function applyState(
  tr: Transaction,
  previous: TimelineViewPluginState,
  editor: Editor,
  doc: PMNode,
): TimelineViewPluginState {
  if (!tr.docChanged) return previous;

  const mapped = new Map<number, string>();
  const claimed = new Set<string>();
  for (const entry of previous.entries) {
    const result = tr.mapping.mapResult(entry.pos, 1);
    if (!result.deleted) {
      mapped.set(result.pos, entry.id);
      claimed.add(entry.id);
    }
  }
  // `setNodeMarkup` during language promotion can mark the opening token as
  // deleted even though the codeBlock still occupies the mapped position.
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
  const entries: TimelineBlockEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    const knownId = mapped.get(pos);
    const timeline = knownId ? parseTimelineForNode(node) : getTimelineForNode(node);
    if (!timeline) return false;
    entries.push({ id: knownId ?? `timeline-${++seq}`, pos });
    return false;
  });

  return { entries, seq, decorations: buildDecorations(doc, entries, editor) };
}

export interface TimelineViewExtensionOptions {
  /** When false, the extension does not claim fences or mount widgets. */
  enabled?: boolean;
}

export const TimelineViewExtension = Extension.create<TimelineViewExtensionOptions>({
  name: 'squisqTimelineView',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    if (this.options.enabled === false) return [];

    return [
      new Plugin<TimelineViewPluginState>({
        key: TIMELINE_VIEW_KEY,
        state: {
          init: (_config, state) => {
            let seq = 0;
            const entries: TimelineBlockEntry[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return;
              if (!getTimelineForNode(node)) return false;
              entries.push({ id: `timeline-${++seq}`, pos });
              return false;
            });
            return {
              entries,
              seq,
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

export default TimelineViewExtension;
