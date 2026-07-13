import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
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

function setHoveredPosition(view: ProseMirrorView, hoveredPosition: number | null): void {
  const current = BLOCK_TAG_ACTIVITY_KEY.getState(view.state)?.hoveredPosition ?? null;
  if (current === hoveredPosition) return;
  view.dispatch(
    view.state.tr
      .setMeta(BLOCK_TAG_ACTIVITY_KEY, { hoveredPosition } satisfies BlockTagHoverMeta)
      .setMeta('addToHistory', false),
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
