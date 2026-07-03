/**
 * Slim Tiptap presets for the canvas inline text editor.
 *
 * Deliberately NOT the document editor's extension set: a textbox must not
 * recursively mount canvases (no `DiagramExtension`/`SceneBlockExtension`)
 * or carry block-template annotations (no `HeadingWithTemplate`).
 *
 * - `inline`  → paragraph + marks (bold/italic/strike/code) + link. Used for
 *   single-label text (diagram nodes, drawing shapes).
 * - `block`   → also lists, blockquote, code block — but NO headings. Used for
 *   layout textboxes, whose content is stored as the child sub-block's
 *   markdown body (a heading there would re-parse as a sibling sub-block).
 * - `rich`    → also headings. (Currently unused by shipping surfaces.)
 */

import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import type { SceneTextLevel } from './sceneTextConfig';

export function buildSceneTextExtensions(level: SceneTextLevel): Extensions {
  const starter =
    level === 'inline'
      ? StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
        })
      : level === 'block'
        ? StarterKit.configure({ heading: false, horizontalRule: false })
        : StarterKit.configure({ horizontalRule: false });
  return [starter, Link.configure({ openOnClick: false })];
}
