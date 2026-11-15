/**
 * Footnotes in the Write view.
 *
 * The Markdown bridge has no footnote nodes: a reference (`[^note]`) and its
 * definition (`[^note]: …`) travel as ordinary text, which keeps them exactly
 * as written through every round trip. Shown as plain text they read as
 * stray brackets in the prose and an odd line at the end. This extension only
 * decorates them: the reference becomes a small raised marker that names its
 * footnote's text on hover, and a definition line reads as a footnote. The
 * document and its Markdown are untouched.
 *
 * Slides draw neither, and PPTX export moves them to the speaker notes.
 */

import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** A footnote label as GFM reads it: no spaces, no closing bracket. */
const REFERENCE = /\[\^([^\]\s]+)\]/g;
/** A definition: the label and a colon at the very start of a paragraph. */
const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*/;

export interface FootnoteSyntaxRange {
  readonly kind: 'reference' | 'definition-label';
  readonly from: number;
  readonly to: number;
  readonly label: string;
}

export interface FootnoteSyntaxScan {
  readonly ranges: readonly FootnoteSyntaxRange[];
  /** Paragraphs that are footnote definitions, by position. */
  readonly definitions: ReadonlyArray<{ readonly from: number; readonly to: number }>;
  /** Each definition's text, by label, for the reference's tooltip. */
  readonly texts: ReadonlyMap<string, string>;
}

function isCodeText(node: ProseMirrorNode): boolean {
  return node.marks.some((mark) => mark.type.name === 'code');
}

/**
 * Footnote syntax in `doc`, outside code blocks and inline code. Positions
 * are document positions, ready for decorations.
 */
export function scanFootnoteSyntax(doc: ProseMirrorNode): FootnoteSyntaxScan {
  const ranges: FootnoteSyntaxRange[] = [];
  const definitions: Array<{ from: number; to: number }> = [];
  const texts = new Map<string, string>();

  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    const content = pos + 1;
    let skipUntil = -1;
    if (node.type.name === 'paragraph') {
      const definition = DEFINITION.exec(node.textContent);
      if (definition) {
        const label = definition[1]!;
        definitions.push({ from: pos, to: pos + node.nodeSize });
        // `[^label]:`, without the space after it.
        ranges.push({
          kind: 'definition-label',
          from: content,
          to: content + label.length + 4,
          label,
        });
        skipUntil = content + definition[0].length;
        if (!texts.has(label)) {
          const text = node.textContent.slice(definition[0].length).trim();
          if (text) texts.set(label, text);
        }
      }
    }
    node.forEach((child, offset) => {
      if (!child.isText || !child.text || isCodeText(child)) return;
      const start = content + offset;
      for (const match of child.text.matchAll(REFERENCE)) {
        const from = start + match.index!;
        if (from < skipUntil) continue;
        ranges.push({ kind: 'reference', from, to: from + match[0].length, label: match[1]! });
      }
    });
    return false;
  });
  return { ranges, definitions, texts };
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const { ranges, definitions, texts } = scanFootnoteSyntax(doc);
  if (ranges.length === 0) return DecorationSet.empty;
  const decorations = [
    ...definitions.map(({ from, to }) =>
      Decoration.node(from, to, { class: 'squisq-footnote-definition' }),
    ),
    ...ranges.map(({ kind, from, to, label }) => {
      if (kind === 'definition-label') {
        return Decoration.inline(from, to, { class: 'squisq-footnote-label' });
      }
      const text = texts.get(label);
      return Decoration.inline(from, to, {
        class: text ? 'squisq-footnote-ref' : 'squisq-footnote-ref squisq-footnote-ref--missing',
        title: text ? `Footnote: ${text}` : `Footnote "${label}" has no text yet`,
      });
    }),
  ];
  return DecorationSet.create(doc, decorations);
}

const FOOTNOTE_SYNTAX_KEY = new PluginKey<DecorationSet>('squisq-footnote-syntax');

/** Decorates footnote references and definitions in the Write view. */
export const FootnoteSyntaxExtension = Extension.create({
  name: 'squisqFootnoteSyntax',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: FOOTNOTE_SYNTAX_KEY,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply: (transaction, previous, _oldState, newState) =>
            transaction.docChanged ? buildDecorations(newState.doc) : previous,
        },
        props: {
          decorations: (state) => FOOTNOTE_SYNTAX_KEY.getState(state) ?? null,
        },
      }),
    ];
  },
});
