/**
 * Tiptap commands for drawing editing.
 *
 * The drawing counterpart to `diagramCommands.ts`. Each command finds a
 * shape's child heading inside a `{[drawing]}` section and mutates its
 * `{[shape …]}` annotation (the `dataTemplate` + `dataTemplateParams` node
 * attrs) or its text. Geometry/style live in the annotation params; the
 * shape's id lives in `dataBlockAttrs` (`#id`). All edits round-trip back to
 * markdown via `tiptapBridge` — no parallel data store.
 *
 * The section walk + a node rename are identical to diagrams, so those
 * generic helpers are reused from `diagramCommands.ts`.
 */

import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  parsePandocAttrTokens,
  serializePandocAttributes,
  quoteAttrValue,
} from '@bendyline/squisq/markdown';
import {
  listDiagramChildren,
  getDiagramSectionEnd,
  renameNode,
} from '../../diagram/diagramCommands';

/** Renaming a shape = replacing its heading text (same op as a diagram node). */
export { renameNode as renameShape };

export interface DrawingChild {
  /** Heading node start position (absolute). */
  pos: number;
  node: PMNode;
  /** Computed id (explicit `#id`, else slugified text). */
  id: string;
  /** Shape/connector kind from the `{[…]}` annotation (`dataTemplate`). */
  kind: string | null;
  /** Parsed `{[…]}` params (`dataTemplateParams`). */
  params: Record<string, string>;
  /** Heading text (the shape label). */
  text: string;
}

/** List the drawing's child shapes/connectors with their annotation parsed. */
export function listDrawingChildren(editor: Editor, parentPos: number): DrawingChild[] {
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
      text: headingText(c.node),
    };
  });
}

/**
 * Insert a new shape as a child heading at the end of the drawing section.
 * The heading carries `dataTemplate=<kind>`, `dataTemplateParams=<geometry>`,
 * and `dataBlockAttrs="#<id>"`, so it round-trips to `### label {#id} {[kind …]}`.
 */
export function addShape(
  editor: Editor,
  parentPos: number,
  id: string,
  kind: string,
  params: Record<string, string>,
  label = '',
): boolean {
  const parent = editor.state.doc.nodeAt(parentPos);
  if (!parent || parent.type.name !== 'heading') return false;
  const childDepth = childDepthFor(editor, parentPos, parent);
  const insertPos = getDiagramSectionEnd(editor, parentPos);
  const tParams = serializeParams(params);
  const blockAttrs = idToBlockAttrs(id);

  return editor
    .chain()
    .command(({ tr, state }) => {
      const headingType = state.schema.nodes.heading;
      if (!headingType) return false;
      const content = label.length > 0 ? state.schema.text(label) : null;
      const heading = headingType.create(
        {
          level: childDepth,
          dataTemplate: kind,
          dataTemplateParams: tParams.length > 0 ? tParams : null,
          dataBlockAttrs: blockAttrs,
        },
        content,
      );
      tr.insert(insertPos, heading);
      return true;
    })
    .run();
}

/** Update a shape's `x`/`y` from a drag. */
export function moveShape(
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

/** Update a shape's `width`/`height` from a resize-handle drag. */
export function resizeShape(
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

/** Set (or, when value is empty, clear) a single style/param on a shape. */
export function setShapeParam(
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

/** Set a connector's end-styles / line-style / routing params (empty value clears). */
export function setConnectorStyle(
  editor: Editor,
  parentPos: number,
  id: string,
  style: { startStyle?: string; endStyle?: string; lineStyle?: string; routing?: string },
): boolean {
  return updateChildParams(editor, parentPos, id, (p) => {
    for (const [key, value] of Object.entries(style)) {
      if (value == null || value.length === 0) delete p[key];
      else p[key] = value;
    }
  });
}

/**
 * Insert a connector (`{[arrow from=.. to=..]}`, or `line`) as a child
 * heading joining two shapes by id.
 */
export function addConnector(
  editor: Editor,
  parentPos: number,
  id: string,
  from: string,
  to: string,
  kind: 'arrow' | 'line' = 'arrow',
  label = '',
): boolean {
  return addShape(editor, parentPos, id, kind, { from, to }, label);
}

/** Re-point a connector's `from` or `to` endpoint at a different shape. */
export function retargetConnector(
  editor: Editor,
  parentPos: number,
  connectorId: string,
  end: 'from' | 'to',
  newTarget: string,
): boolean {
  return updateChildParams(editor, parentPos, connectorId, (p) => {
    p[end] = newTarget;
  });
}

/** Delete the connector heading joining `from`→`to`, if present. */
export function removeConnector(
  editor: Editor,
  parentPos: number,
  from: string,
  to: string,
): boolean {
  const target = listDrawingChildren(editor, parentPos).find(
    (c) => isConnector(c) && c.params.from === from && c.params.to === to,
  );
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

/**
 * Delete a shape's heading (and body) plus any connector that referenced
 * it. Ranges are computed against the original doc and deleted high→low so
 * earlier deletions don't shift later positions.
 */
export function removeShape(editor: Editor, parentPos: number, id: string): boolean {
  const children = listDrawingChildren(editor, parentPos);
  const target = children.find((c) => c.id === id);
  if (!target) return false;

  const ranges: Array<[number, number]> = [headingRange(editor, target.pos)];
  for (const c of children) {
    if (c.id === id) continue;
    if (isConnector(c) && (c.params.from === id || c.params.to === id)) {
      ranges.push(headingRange(editor, c.pos));
    }
  }
  ranges.sort((a, b) => b[0] - a[0]);

  return editor
    .chain()
    .command(({ tr }) => {
      for (const [start, end] of ranges) tr.delete(start, end);
      return true;
    })
    .run();
}

// ============================================
// Internal helpers
// ============================================

/** A `line`/`arrow` child carrying `from`/`to` is a connector (not a plain line). */
function isConnector(c: DrawingChild): boolean {
  if (c.kind !== 'line' && c.kind !== 'arrow') return false;
  return c.params.from != null || c.params.to != null;
}

/** Read params, mutate, and write the heading's `dataTemplateParams` back. */
function updateChildParams(
  editor: Editor,
  parentPos: number,
  id: string,
  mutate: (params: Record<string, string>) => void,
): boolean {
  const target = listDrawingChildren(editor, parentPos).find((c) => c.id === id);
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

/** Heading section range `[start, end)` — the heading plus its body content. */
function headingRange(editor: Editor, pos: number): [number, number] {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return [pos, pos];
  let cursor = pos + node.nodeSize;
  const docSize = state.doc.content.size;
  while (cursor < docSize) {
    const n = state.doc.nodeAt(cursor);
    if (!n) break;
    if (n.type.name === 'heading') break;
    cursor += n.nodeSize;
  }
  return [pos, cursor];
}

/** Child heading depth: inherit existing children's level, else parent+1. */
function childDepthFor(editor: Editor, parentPos: number, parent: PMNode): number {
  const parentDepth = (parent.attrs as { level: number }).level;
  const existing = listDrawingChildren(editor, parentPos);
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

function headingText(node: PMNode): string {
  let text = '';
  node.content.forEach((child) => {
    if (child.isText) text += child.text ?? '';
  });
  return text;
}
