/**
 * Tiptap commands for diagram editing.
 *
 * Each command finds the relevant heading inside a diagram section (parent
 * heading + its direct sub-headings until the next equal-or-shallower
 * heading) and mutates either its `data-block-attrs` attribute or its
 * text content. All edits flow back into markdown via the existing
 * `tiptapBridge` round-trip — no parallel data store.
 */

import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  parsePandocAttrTokens,
  serializePandocAttributes,
  type HeadingAttributes,
} from '@bendyline/squisq/markdown';
import type { BlockConnection } from '@bendyline/squisq/schemas';

export interface HeadingLocation {
  /** Node start position in the doc (absolute). */
  pos: number;
  /** The heading PMNode. */
  node: PMNode;
  /** Parsed attributes derived from the heading's `data-block-attrs` (always defined). */
  attrs: HeadingAttributes;
  /** Computed id: explicit `#id` if set, otherwise the slugified heading text. */
  id: string;
}

/**
 * Slugify heading text the same way `core/src/doc/markdownToDoc.ts` does
 * (so an unset `#id` round-trips cleanly).
 */
function slugify(text: string): string {
  const out = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return out || 'block';
}

function getHeadingText(node: PMNode): string {
  let text = '';
  node.content.forEach((child) => {
    if (child.isText) text += child.text ?? '';
  });
  return text;
}

function getHeadingAttrs(node: PMNode): HeadingAttributes {
  const raw = (node.attrs as Record<string, unknown>).dataBlockAttrs;
  if (typeof raw === 'string' && raw.length > 0) {
    return parsePandocAttrTokens(raw);
  }
  return {};
}

function computeId(node: PMNode): string {
  const attrs = getHeadingAttrs(node);
  return attrs.id ?? slugify(getHeadingText(node));
}

/**
 * Find the diagram section that starts at `parentPos` (the position of the
 * parent heading with `dataTemplate === 'diagram'`). Returns every direct
 * sub-heading until the next equal-or-shallower heading. Body content
 * between sub-headings is included but not returned — only headings are
 * iterated.
 */
export function listDiagramChildren(editor: Editor, parentPos: number): HeadingLocation[] {
  const { state } = editor;
  const parent = state.doc.nodeAt(parentPos);
  if (!parent || parent.type.name !== 'heading') return [];
  const parentDepth = (parent.attrs as { level: number }).level;
  const targetChildDepth = parentDepth + 1;

  const results: HeadingLocation[] = [];
  let cursor = parentPos + parent.nodeSize;
  const docSize = state.doc.content.size;
  while (cursor < docSize) {
    const node = state.doc.nodeAt(cursor);
    if (!node) break;
    if (node.type.name === 'heading') {
      const level = (node.attrs as { level: number }).level;
      if (level <= parentDepth) break;
      if (level === targetChildDepth) {
        results.push({
          pos: cursor,
          node,
          attrs: getHeadingAttrs(node),
          id: computeId(node),
        });
      }
    }
    cursor += node.nodeSize;
  }
  return results;
}

/**
 * Compute the doc position immediately after the last node belonging to the
 * diagram section (the parent heading + everything until the next
 * equal-or-shallower heading).
 */
export function getDiagramSectionEnd(editor: Editor, parentPos: number): number {
  const { state } = editor;
  const parent = state.doc.nodeAt(parentPos);
  if (!parent || parent.type.name !== 'heading') return parentPos;
  const parentDepth = (parent.attrs as { level: number }).level;

  let cursor = parentPos + parent.nodeSize;
  const docSize = state.doc.content.size;
  while (cursor < docSize) {
    const node = state.doc.nodeAt(cursor);
    if (!node) break;
    if (node.type.name === 'heading') {
      const level = (node.attrs as { level: number }).level;
      if (level <= parentDepth) return cursor;
    }
    cursor += node.nodeSize;
  }
  return cursor;
}

function applyAttrs(editor: Editor, pos: number, attrs: HeadingAttributes): boolean {
  const raw = serializePandocAttributes(attrs);
  return editor
    .chain()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node) return false;
      tr.setNodeAttribute(pos, 'dataBlockAttrs', raw ?? null);
      return true;
    })
    .run();
}

/**
 * Update a node's `x` / `y` attributes from a drag.
 */
export function moveNode(
  editor: Editor,
  parentPos: number,
  nodeId: string,
  x: number,
  y: number,
): boolean {
  const target = listDiagramChildren(editor, parentPos).find((c) => c.id === nodeId);
  if (!target) return false;
  const attrs = { ...target.attrs };
  if (!attrs.id) attrs.id = nodeId;
  const params = { ...(attrs.params ?? {}) };
  params.x = String(Math.round(x));
  params.y = String(Math.round(y));
  attrs.params = params;
  return applyAttrs(editor, target.pos, attrs);
}

/**
 * Add a connection from `sourceId` to `targetId` (optionally typed). No-op
 * if the same connection already exists.
 */
export function addConnection(
  editor: Editor,
  parentPos: number,
  sourceId: string,
  targetId: string,
  type?: string,
): boolean {
  const source = listDiagramChildren(editor, parentPos).find((c) => c.id === sourceId);
  if (!source) return false;
  const attrs = { ...source.attrs };
  if (!attrs.id) attrs.id = sourceId;
  const params = { ...(attrs.params ?? {}) };
  const existing = parseConnectionsList(params.connectsTo);
  const dup = existing.find((c) => c.target === targetId && (c.type ?? '') === (type ?? ''));
  if (dup) return false;
  existing.push(type ? { target: targetId, type } : { target: targetId });
  params.connectsTo = serializeConnectionsList(existing);
  attrs.params = params;
  return applyAttrs(editor, source.pos, attrs);
}

/**
 * Remove a connection from `sourceId` to `targetId`. If `type` is provided,
 * only the matching-typed entry is removed; otherwise the first match
 * (regardless of type) is removed.
 */
export function removeConnection(
  editor: Editor,
  parentPos: number,
  sourceId: string,
  targetId: string,
  type?: string,
): boolean {
  const source = listDiagramChildren(editor, parentPos).find((c) => c.id === sourceId);
  if (!source) return false;
  const attrs = { ...source.attrs };
  const params = { ...(attrs.params ?? {}) };
  const existing = parseConnectionsList(params.connectsTo);
  const remaining = existing.filter((c) => {
    if (c.target !== targetId) return true;
    if (type != null && (c.type ?? '') !== type) return true;
    return false;
  });
  if (remaining.length === existing.length) return false;
  if (remaining.length === 0) {
    delete params.connectsTo;
  } else {
    params.connectsTo = serializeConnectionsList(remaining);
  }
  attrs.params = Object.keys(params).length > 0 ? params : undefined;
  return applyAttrs(editor, source.pos, attrs);
}

/**
 * Replace a heading's text content (used when the user renames a node
 * via a double-click in the canvas).
 */
export function renameNode(
  editor: Editor,
  parentPos: number,
  nodeId: string,
  newText: string,
): boolean {
  const target = listDiagramChildren(editor, parentPos).find((c) => c.id === nodeId);
  if (!target) return false;
  const headingPos = target.pos;
  const heading = target.node;
  // Replace the heading's content with a single text node containing the
  // new text. This preserves heading attrs (including dataBlockAttrs).
  return editor
    .chain()
    .command(({ tr, state }) => {
      const from = headingPos + 1;
      const to = headingPos + heading.nodeSize - 1;
      const textNode = state.schema.text(newText);
      tr.replaceWith(from, to, textNode);
      return true;
    })
    .run();
}

/**
 * Insert a new heading node at the end of the diagram section. The new
 * heading carries `data-block-attrs` with the supplied id and position,
 * so the freshly-inserted node appears in React Flow at the expected
 * coordinates.
 */
export function addNode(
  editor: Editor,
  parentPos: number,
  id: string,
  label: string,
  x: number,
  y: number,
): boolean {
  const { state } = editor;
  const parent = state.doc.nodeAt(parentPos);
  if (!parent || parent.type.name !== 'heading') return false;
  const parentDepth = (parent.attrs as { level: number }).level;
  const childDepth = Math.min(6, parentDepth + 1);

  const insertPos = getDiagramSectionEnd(editor, parentPos);
  const dataBlockAttrs = serializePandocAttributes({
    id,
    params: { x: String(Math.round(x)), y: String(Math.round(y)) },
  });

  return editor
    .chain()
    .command(({ tr, state: s }) => {
      const headingType = s.schema.nodes.heading;
      if (!headingType) return false;
      const newHeading = headingType.create(
        {
          level: childDepth,
          dataTemplate: null,
          dataTemplateParams: null,
          dataBlockAttrs: dataBlockAttrs ?? null,
        },
        s.schema.text(label),
      );
      tr.insert(insertPos, newHeading);
      return true;
    })
    .run();
}

/**
 * Remove a child node's heading (and any body content under it up to the
 * next heading). Also strips inbound `connectsTo` references on remaining
 * siblings so the diagram doesn't carry dangling targets.
 */
export function removeNode(editor: Editor, parentPos: number, nodeId: string): boolean {
  const children = listDiagramChildren(editor, parentPos);
  const target = children.find((c) => c.id === nodeId);
  if (!target) return false;

  // Determine the deletion range: from the heading's start to the start
  // of the next heading at any depth (or the diagram section end).
  const { state } = editor;
  const docSize = state.doc.content.size;
  let cursor = target.pos + target.node.nodeSize;
  while (cursor < docSize) {
    const node = state.doc.nodeAt(cursor);
    if (!node) break;
    if (node.type.name === 'heading') break;
    cursor += node.nodeSize;
  }
  const deleteFrom = target.pos;
  const deleteTo = cursor;

  return editor
    .chain()
    .command(({ tr }) => {
      tr.delete(deleteFrom, deleteTo);
      return true;
    })
    .command(({ tr }) => {
      // After deletion, positions for remaining children have shifted;
      // re-walk and strip inbound references. We use the live doc from
      // the transaction so the positions stay correct.
      const stale = listDiagramChildren(editor, parentPos);
      for (const sib of stale) {
        if (sib.id === nodeId) continue;
        const params = { ...(sib.attrs.params ?? {}) };
        if (!params.connectsTo) continue;
        const entries = parseConnectionsList(params.connectsTo).filter((c) => c.target !== nodeId);
        const before = parseConnectionsList(params.connectsTo).length;
        if (entries.length === before) continue;
        if (entries.length === 0) {
          delete params.connectsTo;
        } else {
          params.connectsTo = serializeConnectionsList(entries);
        }
        const nextAttrs: HeadingAttributes = { ...sib.attrs };
        nextAttrs.params = Object.keys(params).length > 0 ? params : undefined;
        const raw = serializePandocAttributes(nextAttrs);
        tr.setNodeAttribute(sib.pos, 'dataBlockAttrs', raw ?? null);
      }
      return true;
    })
    .run();
}

// ============================================
// Internal: connection-list parse / serialize
// ============================================
//
// Mirrors `parseConnectionList` from core/annotationCoercion.ts, but
// returns the raw object shape so we can mutate before re-serialising.

function parseConnectionsList(raw: string | undefined): BlockConnection[] {
  if (!raw) return [];
  const out: BlockConnection[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const colonIdx = entry.indexOf(':');
    if (colonIdx < 0) {
      out.push({ target: entry });
    } else {
      const target = entry.slice(0, colonIdx).trim();
      const type = entry.slice(colonIdx + 1).trim();
      if (!target) continue;
      out.push(type ? { target, type } : { target });
    }
  }
  return out;
}

function serializeConnectionsList(list: BlockConnection[]): string {
  return list.map((c) => (c.type ? `${c.target}:${c.type}` : c.target)).join(',');
}
