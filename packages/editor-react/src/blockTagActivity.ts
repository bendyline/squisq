import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView as ProseMirrorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const BLOCK_TAG_SELECTED_CLASS = 'squisq-block-tags--selected';
export const BLOCK_TAG_HOVERED_CLASS = 'squisq-block-tags--hovered';

export interface BlockTagActivityPluginState {
  selectedPosition: number | null;
  hoveredPosition: number | null;
  decorations: DecorationSet;
}

interface BlockTagHoverMeta {
  hoveredPosition: number | null;
}

export const BLOCK_TAG_ACTIVITY_KEY = new PluginKey<BlockTagActivityPluginState>(
  'squisq-block-tag-activity',
);

function isHeadingElement(element: Element): element is HTMLElement {
  return /^H[1-6]$/.test(element.tagName);
}

/**
 * Returns the heading position for the block owning a document position.
 * A block begins at a top-level heading and continues until the next heading.
 */
export function findOwningHeadingPosition(doc: ProseMirrorNode, position: number): number | null {
  let offset = 0;
  let owningPosition: number | null = null;

  for (let index = 0; index < doc.childCount && offset <= position; index += 1) {
    const node = doc.child(index);
    if (node.type.name === 'heading') owningPosition = offset;
    offset += node.nodeSize;
  }

  return owningPosition;
}

/** Find the preceding top-level heading for a DOM node under ProseMirror. */
export function findOwningHeadingElement(
  editorDom: HTMLElement,
  target: EventTarget | null,
): HTMLElement | null {
  if (!(target instanceof Node)) return null;

  let element =
    target.nodeType === Node.ELEMENT_NODE
      ? (target as HTMLElement)
      : (target.parentElement as HTMLElement | null);
  if (!element || element === editorDom || !editorDom.contains(element)) return null;

  while (element.parentElement && element.parentElement !== editorDom) {
    element = element.parentElement;
  }
  if (element.parentElement !== editorDom) return null;

  let candidate: Element | null = element;
  while (candidate && !isHeadingElement(candidate)) {
    candidate = candidate.previousElementSibling;
  }
  return candidate && isHeadingElement(candidate) ? candidate : null;
}

/**
 * Resolve blank canvas space to the heading-defined block at that vertical
 * position. Margins between top-level nodes are not owned by either node in
 * the DOM, so pointer events there target the ProseMirror root. Treating the
 * root as "no block" makes active-only tags disappear while the pointer
 * crosses ordinary paragraph/list spacing.
 */
export function findOwningHeadingElementAtPoint(
  editorDom: HTMLElement,
  target: EventTarget | null,
  clientY: number,
): HTMLElement | null {
  const direct = findOwningHeadingElement(editorDom, target);
  if (direct) return direct;
  if (!(target instanceof Node) || !editorDom.contains(target) || !Number.isFinite(clientY)) {
    return null;
  }

  const children = Array.from(editorDom.children);
  const lastChild = children[children.length - 1];
  if (!lastChild || clientY > lastChild.getBoundingClientRect().bottom) return null;

  let owningHeading: HTMLElement | null = null;
  for (const child of children) {
    if (child.getBoundingClientRect().top > clientY) break;
    if (isHeadingElement(child)) owningHeading = child;
  }
  return owningHeading;
}

function validHeadingPosition(doc: ProseMirrorNode, position: number | null): number | null {
  if (position === null) return null;
  return doc.nodeAt(position)?.type.name === 'heading' ? position : null;
}

function buildDecorations(
  doc: ProseMirrorNode,
  selectedPosition: number | null,
  hoveredPosition: number | null,
): DecorationSet {
  const classesByPosition = new Map<number, string[]>();

  if (selectedPosition !== null) {
    classesByPosition.set(selectedPosition, [BLOCK_TAG_SELECTED_CLASS]);
  }
  if (hoveredPosition !== null) {
    const classes = classesByPosition.get(hoveredPosition) ?? [];
    classes.push(BLOCK_TAG_HOVERED_CLASS);
    classesByPosition.set(hoveredPosition, classes);
  }

  const decorations: Decoration[] = [];
  for (const [position, classes] of classesByPosition) {
    const node = doc.nodeAt(position);
    if (!node || node.type.name !== 'heading') continue;
    decorations.push(
      Decoration.node(position, position + node.nodeSize, { class: classes.join(' ') }),
    );
  }

  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

function createPluginState(
  doc: ProseMirrorNode,
  selectionFrom: number,
  hoveredPosition: number | null,
): BlockTagActivityPluginState {
  const selectedPosition = findOwningHeadingPosition(doc, selectionFrom);
  const validHoveredPosition = validHeadingPosition(doc, hoveredPosition);
  return {
    selectedPosition,
    hoveredPosition: validHoveredPosition,
    decorations: buildDecorations(doc, selectedPosition, validHoveredPosition),
  };
}

function nextHoveredPosition(
  transaction: Transaction,
  previousPosition: number | null,
  doc: ProseMirrorNode,
): number | null {
  const meta = transaction.getMeta(BLOCK_TAG_ACTIVITY_KEY) as BlockTagHoverMeta | undefined;
  if (meta !== undefined) return validHeadingPosition(doc, meta.hoveredPosition);
  if (!transaction.docChanged || previousPosition === null) return previousPosition;

  const mapped = transaction.mapping.mapResult(previousPosition, 1);
  return mapped.deleted ? null : validHeadingPosition(doc, mapped.pos);
}

function headingPositionForTarget(
  view: ProseMirrorView,
  target: EventTarget | null,
  clientY: number,
): number | null {
  const heading = findOwningHeadingElementAtPoint(view.dom, target, clientY);
  if (!heading) return null;

  try {
    const positionInsideHeading = view.posAtDOM(heading, 0);
    return findOwningHeadingPosition(view.state.doc, positionInsideHeading);
  } catch {
    return null;
  }
}

function isEditableDomPosition(view: ProseMirrorView, node: Node): boolean {
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node.parentElement as Element | null);
  if (!element || !view.dom.contains(element)) return false;
  const island = element.closest('[contenteditable="false"]');
  return !island || !view.dom.contains(island);
}

/**
 * The browser moves the caret itself for Ctrl+End, Page Down and the arrow
 * keys, and ProseMirror learns of it only from the asynchronous
 * `selectionchange` event. Scrolling in between slides another block under a
 * still pointer, so `mouseover` fires first. A hover transaction then changes
 * decorations, ProseMirror redraws, and it writes its older selection back
 * over the move — the caret appears not to move at all. Carry the caret the
 * browser already shows into the hover transaction instead.
 */
function withPendingDomSelection(view: ProseMirrorView, transaction: Transaction): Transaction {
  const { selection } = view.state;
  if (view.composing || !view.hasFocus() || !(selection instanceof TextSelection)) {
    return transaction;
  }

  const domSelection = view.dom.ownerDocument.getSelection();
  const anchorNode = domSelection?.anchorNode;
  const focusNode = domSelection?.focusNode;
  if (!domSelection || !anchorNode || !focusNode) return transaction;
  if (!isEditableDomPosition(view, anchorNode) || !isEditableDomPosition(view, focusNode)) {
    return transaction;
  }

  let anchor: number;
  let head: number;
  try {
    anchor = view.posAtDOM(anchorNode, domSelection.anchorOffset);
    head = view.posAtDOM(focusNode, domSelection.focusOffset);
  } catch {
    return transaction;
  }
  if (anchor === selection.anchor && head === selection.head) return transaction;

  const { doc } = transaction;
  return transaction.setSelection(TextSelection.between(doc.resolve(anchor), doc.resolve(head)));
}

function setHoveredPosition(view: ProseMirrorView, hoveredPosition: number | null): void {
  const current = BLOCK_TAG_ACTIVITY_KEY.getState(view.state)?.hoveredPosition ?? null;
  if (current === hoveredPosition) return;
  view.dispatch(
    withPendingDomSelection(
      view,
      view.state.tr
        .setMeta(BLOCK_TAG_ACTIVITY_KEY, { hoveredPosition } satisfies BlockTagHoverMeta)
        .setMeta('addToHistory', false),
    ),
  );
}

/**
 * ProseMirror-owned block activity decorations. Using node decorations keeps
 * the classes stable when ProseMirror reconciles its managed heading DOM.
 */
export const BlockTagActivityExtension = Extension.create({
  name: 'squisqBlockTagActivity',

  addProseMirrorPlugins() {
    return [
      new Plugin<BlockTagActivityPluginState>({
        key: BLOCK_TAG_ACTIVITY_KEY,
        state: {
          init: (_config, state) => createPluginState(state.doc, state.selection.from, null),
          apply: (transaction, previous, _oldState, newState) =>
            createPluginState(
              newState.doc,
              newState.selection.from,
              nextHoveredPosition(transaction, previous.hoveredPosition, newState.doc),
            ),
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
          handleDOMEvents: {
            mouseover(view, event) {
              setHoveredPosition(view, headingPositionForTarget(view, event.target, event.clientY));
              return false;
            },
            mousemove(view, event) {
              // `mouseover` covers real document nodes. Only track continuous
              // movement while the root itself owns the pointer (the blank
              // margin/gutter case), avoiding geometry reads over text.
              if (event.target !== view.dom) return false;
              setHoveredPosition(view, headingPositionForTarget(view, event.target, event.clientY));
              return false;
            },
            mouseleave(view) {
              setHoveredPosition(view, null);
              return false;
            },
          },
        },
      }),
    ];
  },
});

export default BlockTagActivityExtension;
