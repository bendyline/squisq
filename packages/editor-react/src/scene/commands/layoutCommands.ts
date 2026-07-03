/**
 * Tiptap commands for layout editing.
 *
 * The layout counterpart to `drawingCommands.ts`: each layer is a child
 * heading inside a `{[layout]}` section, and its `{[type …]}` annotation
 * (`dataTemplate` + `dataTemplateParams`) carries geometry/style while its
 * `{#id}` lives in `dataBlockAttrs`. The one difference from drawing is
 * that a **text** layer's content lives in the child heading's *body*
 * (paragraphs/lists/marks) rather than the heading text — so it round-trips
 * to readable markdown. All edits flow through the main editor's
 * transactions, so the doc's normal save path serializes them; there is no
 * parallel data store.
 *
 * The section walk is identical to diagrams/drawings, so those generic
 * helpers are reused from `diagramCommands.ts`.
 */

import type { Editor } from '@tiptap/react';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { DOMSerializer, DOMParser as PMDOMParser, Fragment } from '@tiptap/pm/model';
import {
  parsePandocAttrTokens,
  serializePandocAttributes,
  quoteAttrValue,
} from '@bendyline/squisq/markdown';
import { listDiagramChildren } from '../../diagram/diagramCommands';

export interface LayoutChild {
  /** Heading node start position (absolute). */
  pos: number;
  node: PMNode;
  /** Computed id (explicit `#id`, else slugified text). */
  id: string;
  /** Layer kind from the `{[…]}` annotation (`text`/`rectangle`/`image`/…). */
  kind: string | null;
  /** Parsed `{[…]}` params (`dataTemplateParams`). */
  params: Record<string, string>;
  /** The child's body serialized to HTML (a text layer's rich content). */
  bodyHtml: string;
  /** Plain text of the body (newline-joined across block nodes). */
  bodyText: string;
}

/** List the layout's child layers with their annotation + body parsed. */
export function listLayoutChildren(editor: Editor, parentPos: number): LayoutChild[] {
  return listDiagramChildren(editor, parentPos).map((c) => {
    const a = c.node.attrs as { dataTemplate?: string | null; dataTemplateParams?: string | null };
    return {
      pos: c.pos,
      node: c.node,
      id: c.id,
      kind: a.dataTemplate ?? null,
      params: a.dataTemplateParams
        ? (parsePandocAttrTokens(a.dataTemplateParams).params ?? {})
        : {},
      bodyHtml: bodyToHtml(editor, c.pos, c.node),
      bodyText: bodyToText(editor, c.pos, c.node),
    };
  });
}

/**
 * Insert a new layer as a child heading at the end of the layout section.
 * The heading carries `dataTemplate=<kind>`, `dataTemplateParams=<geometry>`,
 * and `dataBlockAttrs="#<id>"`; a non-empty `bodyHtml` is parsed into the
 * child's body so it round-trips to `### {#id} {[kind …]}` + markdown body.
 */
export function addLayoutLayer(
  editor: Editor,
  parentPos: number,
  id: string,
  kind: string,
  params: Record<string, string>,
  bodyHtml = '',
): boolean {
  const parent = editor.state.doc.nodeAt(parentPos);
  if (!parent || parent.type.name !== 'heading') return false;
  const childDepth = childDepthFor(editor, parentPos, parent);
  const insertPos = layoutInsertPos(editor, parentPos);
  const tParams = serializeParams(params);
  const blockAttrs = idToBlockAttrs(id);

  return editor
    .chain()
    .command(({ tr, state }) => {
      const headingType = state.schema.nodes.heading;
      if (!headingType) return false;
      const heading = headingType.create({
        level: childDepth,
        dataTemplate: kind,
        dataTemplateParams: tParams.length > 0 ? tParams : null,
        dataBlockAttrs: blockAttrs,
      });
      let content = Fragment.from(heading);
      if (bodyHtml.trim()) content = content.append(htmlToBody(state.schema, bodyHtml));
      tr.insert(insertPos, content);
      return true;
    })
    .run();
}

/** Update a layer's `x`/`y` from a drag. */
export function moveLayoutLayer(
  editor: Editor,
  parentPos: number,
  id: string,
  x: number,
  y: number,
): boolean {
  return updateChildParams(editor, parentPos, id, (p) => {
    p.x = String(Math.round(x));
    p.y = String(Math.round(y));
  });
}

/** Update a layer's `width`/`height` from a resize-handle drag. */
export function resizeLayoutLayer(
  editor: Editor,
  parentPos: number,
  id: string,
  width: number,
  height: number,
): boolean {
  return updateChildParams(editor, parentPos, id, (p) => {
    p.width = String(Math.round(width));
    p.height = String(Math.round(height));
  });
}

/** Set (or, when value is empty, clear) a single style/param on a layer. */
export function setLayoutParam(
  editor: Editor,
  parentPos: number,
  id: string,
  key: string,
  value: string,
): boolean {
  return updateChildParams(editor, parentPos, id, (p) => {
    if (value.length === 0) delete p[key];
    else p[key] = value;
  });
}

/**
 * Replace a text layer's body with the content parsed from `bodyHtml`
 * (an empty value clears it). The heading + its `{[text …]}` annotation are
 * preserved; only the body changes.
 */
export function setLayoutText(
  editor: Editor,
  parentPos: number,
  id: string,
  bodyHtml: string,
): boolean {
  const target = listLayoutChildren(editor, parentPos).find((c) => c.id === id);
  if (!target) return false;
  const bodyStart = target.pos + target.node.nodeSize;
  const [, bodyEnd] = headingRange(editor, target.pos);
  return editor
    .chain()
    .command(({ tr, state }) => {
      if (!tr.doc.nodeAt(target.pos)) return false;
      const body = bodyHtml.trim() ? htmlToBody(state.schema, bodyHtml) : Fragment.empty;
      tr.replaceWith(bodyStart, bodyEnd, body);
      return true;
    })
    .run();
}

/** Delete a layer's heading and its body. */
export function removeLayoutLayer(editor: Editor, parentPos: number, id: string): boolean {
  const target = listLayoutChildren(editor, parentPos).find((c) => c.id === id);
  if (!target) return false;
  const [start, end] = headingRange(editor, target.pos);
  return editor
    .chain()
    .command(({ tr }) => {
      tr.delete(start, end);
      return true;
    })
    .run();
}

// ============================================
// Internal helpers
// ============================================

/** Read params, mutate, and write the heading's `dataTemplateParams` back. */
function updateChildParams(
  editor: Editor,
  parentPos: number,
  id: string,
  mutate: (params: Record<string, string>) => void,
): boolean {
  const target = listLayoutChildren(editor, parentPos).find((c) => c.id === id);
  if (!target) return false;
  const params = { ...target.params };
  mutate(params);
  const tParams = serializeParams(params);
  return editor
    .chain()
    .command(({ tr }) => {
      if (!tr.doc.nodeAt(target.pos)) return false;
      tr.setNodeAttribute(target.pos, 'dataTemplateParams', tParams.length > 0 ? tParams : null);
      return true;
    })
    .run();
}

/**
 * Body range `[start, end)` for a layout child — the heading plus its body,
 * stopping at the next heading OR a horizontal rule. A layout textbox can't
 * contain an `hr` (the `block` editor level forbids it), so a `---` always
 * marks the end of the layout's content; bounding on it keeps a trailing
 * child's body from swallowing loose document content that follows the
 * layout block (e.g. a closing paragraph after a `---`).
 */
function headingRange(editor: Editor, pos: number): [number, number] {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return [pos, pos];
  let cursor = pos + node.nodeSize;
  const docSize = state.doc.content.size;
  while (cursor < docSize) {
    const n = state.doc.nodeAt(cursor);
    if (!n) break;
    if (n.type.name === 'heading' || n.type.name === 'horizontalRule') break;
    cursor += n.nodeSize;
  }
  return [pos, cursor];
}

/** Serialize a child's body fragment to HTML (a text layer's rich content). */
function bodyToHtml(editor: Editor, headingPos: number, headingNode: PMNode): string {
  const { state } = editor;
  const bodyStart = headingPos + headingNode.nodeSize;
  const [, bodyEnd] = headingRange(editor, headingPos);
  if (bodyEnd <= bodyStart) return '';
  const fragment = state.doc.slice(bodyStart, bodyEnd).content;
  if (fragment.size === 0) return '';
  const dom = DOMSerializer.fromSchema(state.schema).serializeFragment(fragment);
  const div = document.createElement('div');
  div.appendChild(dom);
  return div.innerHTML;
}

/** Plain text of a child's body (newline-joined across block nodes). */
function bodyToText(editor: Editor, headingPos: number, headingNode: PMNode): string {
  const { state } = editor;
  const bodyStart = headingPos + headingNode.nodeSize;
  const [, bodyEnd] = headingRange(editor, headingPos);
  if (bodyEnd <= bodyStart) return '';
  return state.doc.textBetween(bodyStart, bodyEnd, '\n').trim();
}

/** Parse Tiptap HTML into a Fragment of block nodes for the doc body. */
function htmlToBody(schema: Schema, html: string): Fragment {
  const div = document.createElement('div');
  div.innerHTML = html;
  return PMDOMParser.fromSchema(schema).parse(div).content;
}

/**
 * Where to append a new layer heading: after the last child's bounded body
 * (or, with no children, after the parent heading's bounded body). Unlike
 * `getDiagramSectionEnd` (which runs to the next ≤parent heading and so spans
 * any trailing loose document content), this stops at the layout's `---`/next
 * heading boundary — so new children don't leapfrog content that follows the
 * layout block.
 */
function layoutInsertPos(editor: Editor, parentPos: number): number {
  const children = listLayoutChildren(editor, parentPos);
  const anchor = children.length > 0 ? children[children.length - 1].pos : parentPos;
  return headingRange(editor, anchor)[1];
}

/** Child heading depth: inherit existing children's level, else parent+1. */
function childDepthFor(editor: Editor, parentPos: number, parent: PMNode): number {
  const parentDepth = (parent.attrs as { level: number }).level;
  const existing = listLayoutChildren(editor, parentPos);
  const inherited = existing[0]?.node.attrs.level as number | undefined;
  return Math.min(6, inherited ?? parentDepth + 1);
}

/** Serialize a param map to a `{[…]}` body string (`k=v k=v`), quoted canonically. */
function serializeParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${quoteAttrValue(v)}`)
    .join(' ');
}

/** The `#id` inner string for `dataBlockAttrs` (no outer braces). */
function idToBlockAttrs(id: string): string | null {
  return stripBraces(serializePandocAttributes({ id }));
}

function stripBraces(s: string | null): string | null {
  if (s == null || s === '{}') return null;
  if (s.startsWith('{') && s.endsWith('}')) return s.slice(1, -1);
  return s;
}
