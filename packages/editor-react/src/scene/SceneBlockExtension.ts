/**
 * SceneBlockExtension — Tiptap plugin that mounts a Scene-based editor
 * below any heading whose `dataTemplate` is `layout` or `drawing`.
 *
 * Same shape as `DiagramExtension`: each matching heading gets a
 * ProseMirror widget decoration that renders a `<SceneBlockWidget>`
 * (React) into a contenteditable=false host. Sub-headings of the
 * matched block are hidden via a `data-squisq-scene-child` attribute
 * so the canvas is the sole visual representation of the section in
 * the WYSIWYG view (mirrors the diagram hide rule).
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
import { SceneBlockWidget, type SceneBlockMode } from './SceneBlockWidget';

/**
 * Stable identifier for a layout/drawing heading — used as part of the
 * widget decoration's `key` so the canvas survives attribute-only doc
 * changes (drag/resize commits write into the heading's
 * `data-block-attrs`).
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
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'block'
  );
}

/**
 * Find the current document position of a layout/drawing heading by
 * its stable key. Returns `null` if the heading no longer exists.
 */
export function findSceneHeadingPos(
  editor: Editor,
  headingKey: string,
  mode: SceneBlockMode,
): number | null {
  const expectedTemplate = mode;
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name !== 'heading') return;
    const attrs = node.attrs as { dataTemplate?: string };
    if (attrs.dataTemplate !== expectedTemplate) return;
    if (getHeadingKey(node) === headingKey) {
      found = pos;
      return false;
    }
  });
  return found;
}

const KEY = new PluginKey('squisq-scene-block');
const TEMPLATE_MODE: Record<string, SceneBlockMode> = {
  layout: 'layout',
  drawing: 'drawing',
};

interface SceneRoot {
  el: HTMLElement;
  root: Root;
}

function buildDecorations(state: EditorState, editor: Editor): DecorationSet {
  const decos: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const attrs = node.attrs as { level: number; dataTemplate?: string };
    const mode = attrs.dataTemplate ? TEMPLATE_MODE[attrs.dataTemplate] : undefined;
    if (!mode) return;
    const parentDepth = attrs.level;
    const widgetPos = pos + node.nodeSize;
    const parentPos = pos;
    const headingKey = getHeadingKey(node);
    decos.push(
      Decoration.widget(
        widgetPos,
        (view) => {
          const container = document.createElement('div');
          container.className = 'squisq-scene-widget-host';
          container.contentEditable = 'false';
          container.addEventListener('mousedown', (e) => e.stopPropagation());
          container.addEventListener('keydown', (e) => e.stopPropagation());

          const root = createRoot(container);
          root.render(
            createElement(SceneBlockWidget, {
              editor,
              headingKey,
              fallbackParentPos: parentPos,
              mode,
              host: view.dom.parentElement ?? view.dom,
            }),
          );

          (container as HTMLElement & { __squisqSceneRoot?: SceneRoot }).__squisqSceneRoot = {
            el: container,
            root,
          };
          return container;
        },
        {
          destroy: (dom) => {
            const ref = (dom as HTMLElement & { __squisqSceneRoot?: SceneRoot }).__squisqSceneRoot;
            if (ref) setTimeout(() => ref.root.unmount(), 0);
          },
          side: 1,
          ignoreSelection: true,
          // Stable key so the canvas survives attribute-only doc changes
          // (drag/resize commits) — see DiagramExtension for the same
          // pattern and rationale.
          key: `squisq-scene-${mode}-${headingKey}`,
        },
      ),
    );

    // Hide direct sub-headings of this block — the Scene canvas is the
    // visible representation of any nested structure.
    let cursor = pos + node.nodeSize;
    while (cursor < state.doc.content.size) {
      const child = state.doc.nodeAt(cursor);
      if (!child) break;
      if (child.type.name === 'heading') {
        const childLevel = (child.attrs as { level: number }).level;
        if (childLevel <= parentDepth) break;
        decos.push(
          Decoration.node(cursor, cursor + child.nodeSize, {
            'data-squisq-scene-child': 'true',
          }),
        );
      }
      cursor += child.nodeSize;
    }
  });

  return DecorationSet.create(state.doc, decos);
}

export interface SceneBlockExtensionOptions {
  /** When false, the extension is inert. */
  enabled?: boolean;
}

export const SceneBlockExtension = Extension.create<SceneBlockExtensionOptions>({
  name: 'squisqSceneBlock',

  addOptions() {
    return { enabled: true };
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

export default SceneBlockExtension;
