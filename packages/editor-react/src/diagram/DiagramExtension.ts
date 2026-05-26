/**
 * DiagramExtension — Tiptap/ProseMirror plugin that:
 *
 * 1. Mounts a React-Flow canvas (`DiagramWidget`) immediately after every
 *    heading whose `dataTemplate === 'diagram'`.
 * 2. Hides the direct sub-headings of each diagram parent (until the next
 *    equal-or-shallower heading) by tagging them with a `data-squisq-diagram-child`
 *    attribute — CSS in `styles/diagram.css` does the actual hiding.
 *
 * Widgets are rendered as plain DOM nodes attached to a ProseMirror
 * `Decoration.widget`. React is mounted into the widget DOM with
 * `react-dom/client`'s `createRoot`, and unmounted on the widget's
 * `destroy` hook.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parsePandocAttrTokens } from '@bendyline/squisq/markdown';
import { DiagramWidget } from './DiagramWidget';

/**
 * Stable identifier for a diagram heading — prefers the persisted
 * Pandoc `#id`, falls back to a slugified version of the heading's
 * text. Used as part of the widget decoration's `key` so the widget
 * survives attribute-only doc changes (drag/resize commits).
 */
export function getHeadingKey(node: PMNode): string {
  const raw = (node.attrs as Record<string, unknown>).dataBlockAttrs;
  if (typeof raw === 'string' && raw.length > 0) {
    const attrs = parsePandocAttrTokens(raw);
    if (attrs.id) return attrs.id;
  }
  let text = '';
  node.content.forEach((child) => {
    if (child.isText) text += child.text ?? '';
  });
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'block';
}

/**
 * Find the current document position of a diagram heading by its
 * stable key. Returns `null` if the heading no longer exists (e.g. the
 * user removed it). Used by the widget to re-resolve its parent
 * position on every read, since the kept-alive widget's captured
 * `parentPos` would otherwise go stale when content above shifts.
 */
export function findDiagramHeadingPos(
  editor: Editor,
  headingKey: string,
): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name !== 'heading') return;
    const attrs = node.attrs as { dataTemplate?: string };
    if (attrs.dataTemplate !== 'diagram') return;
    if (getHeadingKey(node) === headingKey) {
      found = pos;
      return false;
    }
  });
  return found;
}

const KEY = new PluginKey('squisq-diagram');

interface DiagramRoot {
  el: HTMLElement;
  root: Root;
}

function buildDecorations(state: EditorState, editor: Editor): DecorationSet {
  const decos: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const attrs = node.attrs as { level: number; dataTemplate?: string };
    if (attrs.dataTemplate === 'diagram') {
      const parentDepth = attrs.level;
      const widgetPos = pos + node.nodeSize;
      const parentPos = pos;
      // Stable widget key derived from the heading's persisted id (or its
      // text-derived slug). ProseMirror treats decorations with matching
      // keys as equal, so it keeps the existing widget DOM (and the
      // mounted React root) across attribute-only doc changes — which
      // happen on every drag commit when we write `x=`/`y=` back to the
      // heading. Without this, every drop would destroy and recreate the
      // canvas, blowing away pan/zoom and making the cards appear to snap
      // back to their pre-fit position.
      const headingKey = getHeadingKey(node);
      decos.push(
        Decoration.widget(
          widgetPos,
          (view) => {
            const container = document.createElement('div');
            container.className = 'squisq-diagram-widget-host';
            container.contentEditable = 'false';
            // Stop ProseMirror from treating clicks/keys inside the
            // widget as document interactions.
            container.addEventListener('mousedown', (e) => e.stopPropagation());
            container.addEventListener('keydown', (e) => e.stopPropagation());

            const root = createRoot(container);
            root.render(
              createElement(DiagramWidget, {
                editor,
                headingKey,
                fallbackParentPos: parentPos,
                host: view.dom.parentElement ?? view.dom,
              }),
            );

            // Stash for destroy.
            (container as HTMLElement & { __squisqDiagramRoot?: DiagramRoot }).__squisqDiagramRoot =
              {
                el: container,
                root,
              };
            return container;
          },
          {
            destroy: (dom) => {
              const ref = (dom as HTMLElement & { __squisqDiagramRoot?: DiagramRoot })
                .__squisqDiagramRoot;
              if (ref) {
                // Defer to next tick so React isn't unmounted mid-render.
                setTimeout(() => ref.root.unmount(), 0);
              }
            },
            // Cluster the widget tightly after the heading; don't side-bias.
            side: 1,
            ignoreSelection: true,
            key: `squisq-diagram-${headingKey}`,
          },
        ),
      );

      // Mark child headings (depth = parentDepth + 1 .. 6, until next ≤parentDepth).
      let cursor = pos + node.nodeSize;
      while (cursor < state.doc.content.size) {
        const child = state.doc.nodeAt(cursor);
        if (!child) break;
        if (child.type.name === 'heading') {
          const childLevel = (child.attrs as { level: number }).level;
          if (childLevel <= parentDepth) break;
          decos.push(
            Decoration.node(cursor, cursor + child.nodeSize, {
              'data-squisq-diagram-child': 'true',
            }),
          );
        }
        cursor += child.nodeSize;
      }
    }
  });

  return DecorationSet.create(state.doc, decos);
}

export interface DiagramExtensionOptions {
  /** When false, the extension is inert (no widgets, no decorations). */
  enabled?: boolean;
}

export const DiagramExtension = Extension.create<DiagramExtensionOptions>({
  name: 'squisqDiagram',

  addOptions() {
    return {
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    const enabled = this.options.enabled !== false;
    if (!enabled) return [];

    return [
      new Plugin({
        key: KEY,
        state: {
          init: (_config, state) => buildDecorations(state, editor),
          apply: (tr, oldDecos, _oldState, newState) => {
            if (!tr.docChanged) return oldDecos;
            return buildDecorations(newState, editor);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export default DiagramExtension;
