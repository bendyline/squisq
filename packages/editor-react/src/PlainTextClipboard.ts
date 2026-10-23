/**
 * PlainTextClipboard — Tiptap Extension
 *
 * Writes the `text/plain` flavor of a copy, cut, or drag. Tiptap's built-in
 * serializer puts a blank line before *every* block node, wrappers included,
 * so the first item of a list (bulletList > listItem > paragraph) arrived in
 * Notepad behind five blank lines and each later item behind three.
 *
 * This one writes the text a reader sees: a blank line between paragraphs,
 * one line per list item with its bullet, number, or checkbox, nested items
 * indented under their parent, and table rows as tab-separated lines. Inline
 * marks contribute only their text; inline nodes with `renderText` (hard
 * breaks, mentions, wiki links) contribute that text.
 *
 * The `text/html` flavor is untouched, and it is what a paste back into the
 * editor reads (see WysiwygEditor's handlePaste).
 */

import { Extension, getTextSerializersFromSchema, type TextSerializer } from '@tiptap/core';
import type { Fragment, Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

type TextSerializers = Record<string, TextSerializer>;

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

const isList = (node: ProseMirrorNode) => LIST_TYPES.has(node.type.name);
const isListItem = (node: ProseMirrorNode) => LIST_ITEM_TYPES.has(node.type.name);
const isTableRow = (node: ProseMirrorNode) => node.type.spec.tableRole === 'row';
const isTableCell = (node: ProseMirrorNode) =>
  node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell';

/** Plain text for a clipboard slice, laid out as the module comment describes. */
export function sliceToPlainText(slice: Slice, serializers: TextSerializers = {}): string {
  // Words within one paragraph, list item, or cell are just those words:
  // no bullet, even though the slice carries the item around them.
  const textblock = soleOpenTextblock(slice);
  if (textblock) return inlineText(textblock, serializers);
  const first = slice.content.firstChild;
  if (first?.isInline) {
    // A selected inline node (a mention) slices to bare inline content. Wrap
    // it in the schema's default textblock so its serializer has a parent.
    const wrapper = first.type.schema.topNodeType.contentMatch.defaultType;
    return wrapper ? inlineText(wrapper.create(null, slice.content), serializers) : '';
  }
  return blocksText(slice.content, serializers);
}

/** The textblock a selection lies within, when it lies within a single one. */
function soleOpenTextblock(slice: Slice): ProseMirrorNode | null {
  let content = slice.content;
  for (let depth = 1; depth <= Math.min(slice.openStart, slice.openEnd); depth++) {
    if (content.childCount !== 1) return null;
    const node = content.child(0);
    if (node.isTextblock) return node;
    content = node.content;
  }
  return null;
}

function inlineText(textblock: ProseMirrorNode, serializers: TextSerializers): string {
  const range = { from: 0, to: textblock.content.size };
  let text = '';
  textblock.forEach((node, pos, index) => {
    const serialize = serializers[node.type.name];
    text += serialize
      ? serialize({ node, pos, parent: textblock, index, range })
      : node.textContent;
  });
  return text;
}

function blocksText(content: Fragment, serializers: TextSerializers, inListItem = false): string {
  let text = '';
  let previous: ProseMirrorNode | null = null;
  for (let i = 0; i < content.childCount; i++) {
    const node = content.child(i);
    const block = blockText(node, serializers);
    // Blocks without text (images, rules) leave no gap, but an empty table
    // cell still holds its column.
    if (!block && !isTableCell(node)) continue;
    if (previous) text += separator(previous, node, inListItem);
    text += block;
    previous = node;
  }
  return text;
}

function separator(previous: ProseMirrorNode, next: ProseMirrorNode, inListItem: boolean): string {
  if (isTableCell(previous) && isTableCell(next)) return '\t';
  if (isListItem(previous) && isListItem(next)) return '\n';
  if (isTableRow(previous) && isTableRow(next)) return '\n';
  // A sublist starts on the line after its item's own text.
  if (inListItem && isList(next)) return '\n';
  return '\n\n';
}

function blockText(node: ProseMirrorNode, serializers: TextSerializers): string {
  if (node.isTextblock) return inlineText(node, serializers);
  if (isList(node)) return listText(node, serializers);
  // Items sliced out without their list still get a bullet.
  if (isListItem(node)) return listItemText(node, bulletMarker(node), serializers);
  // A cell is one TSV field.
  if (isTableCell(node)) return blocksText(node.content, serializers).replace(/\s*\n\s*/g, ' ');
  return blocksText(node.content, serializers);
}

function listText(list: ProseMirrorNode, serializers: TextSerializers): string {
  const start: unknown = list.attrs.start;
  const items: string[] = [];
  list.forEach((item, _pos, index) => {
    const marker = typeof start === 'number' ? `${start + index}. ` : bulletMarker(item);
    items.push(listItemText(item, marker, serializers));
  });
  return items.join('\n');
}

function bulletMarker(item: ProseMirrorNode): string {
  const checked: unknown = item.attrs.checked;
  if (typeof checked !== 'boolean') return '- ';
  return checked ? '- [x] ' : '- [ ] ';
}

function listItemText(item: ProseMirrorNode, marker: string, serializers: TextSerializers) {
  const body = blocksText(item.content, serializers, true);
  const indent = ' '.repeat(marker.length);
  const lines = body.split('\n').map((line) => (line ? indent + line : line));
  // A selection that starts inside a sublist cuts the parent item's own text
  // away. Keep the sublist indented under the parent's position, unmarked.
  if (item.firstChild && isList(item.firstChild)) return lines.join('\n');
  lines[0] = body ? marker + lines[0].slice(indent.length) : marker.trimEnd();
  return lines.join('\n');
}

/** Replaces Tiptap's built-in `text/plain` clipboard serializer. */
export const PlainTextClipboard = Extension.create({
  name: 'plainTextClipboard',

  addProseMirrorPlugins() {
    const serializers = getTextSerializersFromSchema(this.editor.schema);
    return [
      new Plugin({
        key: new PluginKey('plainTextClipboard'),
        props: {
          // Tiptap runs a later extension's plugins first, so this prop wins
          // over the core ClipboardTextSerializer's.
          clipboardTextSerializer: (slice) => sliceToPlainText(slice, serializers),
        },
      }),
    ];
  },
});
