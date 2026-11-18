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
import { mountWidgetRoot, type WidgetRoot } from '../widgetRoot';
import { createElement } from 'react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parsePandocAttrTokens } from '@bendyline/squisq/markdown';
import { SceneBlockWidget, type SceneBlockMode } from './SceneBlockWidget';
import type { SceneTextChannel } from './text/sceneTextChannel';

/** A scene heading's own identity: its `{#id}`, else its text as a slug. */
function headingIdentity(node: PMNode): string {
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
 * The key of every `mode` heading in `doc`, by position: the heading's
 * identity, with its ordinal from the second heading of the same identity on
 * (`sketch`, `sketch~2`). The key is part of the widget decoration's `key`,
 * so the canvas survives attribute-only commits (drag/resize write the
 * heading's `data-block-attrs`) and edits above it. It once carried the
 * heading's position: typing above a canvas then orphaned it — it drew
 * nothing until ProseMirror rebuilt the widget, and the page shifted by the
 * canvas's height.
 */
export function sceneHeadingKeys(doc: PMNode, mode: SceneBlockMode): Map<number, string> {
  const keys = new Map<number, string>();
  const seen = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      if ((node.attrs as { dataTemplate?: string }).dataTemplate === mode) {
        const identity = headingIdentity(node);
        const ordinal = (seen.get(identity) ?? 0) + 1;
        seen.set(identity, ordinal);
        keys.set(pos, ordinal === 1 ? identity : `${identity}~${String(ordinal)}`);
      }
      return false;
    }
    return node.isTextblock ? false : undefined;
  });
  return keys;
}

/** The key of the `mode` heading at `position`, or null when there is none. */
export function getHeadingKey(doc: PMNode, position: number, mode: SceneBlockMode): string | null {
  return sceneHeadingKeys(doc, mode).get(position) ?? null;
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
  for (const [pos, key] of sceneHeadingKeys(editor.state.doc, mode)) {
    if (key === headingKey) return pos;
  }
  return null;
}

const KEY = new PluginKey('squisq-scene-block');
const TEMPLATE_MODE: Record<string, SceneBlockMode> = {
  layout: 'layout',
  drawing: 'drawing',
};

interface SceneRoot {
  el: HTMLElement;
  root: WidgetRoot;
}

function buildDecorations(
  state: EditorState,
  editor: Editor,
  textChannel?: SceneTextChannel,
): DecorationSet {
  const decos: Decoration[] = [];
  const keys: Record<SceneBlockMode, Map<number, string>> = {
    layout: sceneHeadingKeys(state.doc, 'layout'),
    drawing: sceneHeadingKeys(state.doc, 'drawing'),
  };

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const attrs = node.attrs as { level: number; dataTemplate?: string };
    const mode = attrs.dataTemplate ? TEMPLATE_MODE[attrs.dataTemplate] : undefined;
    if (!mode) return;
    const parentDepth = attrs.level;
    const widgetPos = pos + node.nodeSize;
    const parentPos = pos;
    const headingKey = keys[mode].get(pos);
    if (headingKey === undefined) return;
    decos.push(
      Decoration.widget(
        widgetPos,
        (view) => {
          const container = document.createElement('div');
          container.className = 'squisq-scene-widget-host squisq-block-fill-available';
          container.contentEditable = 'false';
          container.addEventListener('mousedown', (e) => e.stopPropagation());
          container.addEventListener('keydown', (e) => e.stopPropagation());

          const root = mountWidgetRoot(
            container,
            mode,
            createElement(SceneBlockWidget, {
              editor,
              headingKey,
              fallbackParentPos: parentPos,
              mode,
              host: view.dom.parentElement ?? view.dom,
              textChannel,
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
            if (ref) ref.root.unmount();
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
  textChannel?: SceneTextChannel;
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
          init: (_config, state) => buildDecorations(state, editor, this.options.textChannel),
          apply: (tr, oldDecos, _oldState, newState) => {
            if (!tr.docChanged) return oldDecos;
            return buildDecorations(newState, editor, this.options.textChannel);
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
