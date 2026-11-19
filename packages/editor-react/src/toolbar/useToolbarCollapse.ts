import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '../EditorContext';
import { chooseCollapsedItems, DOCUMENT_ACTIONS_ITEM, type CollapseGroup } from './toolbarCollapse';

/**
 * The width of an item's `[data-toolbar-transient]` descendants — content
 * that stays on the row whether or not the item is folded — margins and the
 * gap before each included.
 */
function transientWidth(item: HTMLElement): number {
  let width = 0;
  item.querySelectorAll<HTMLElement>('[data-toolbar-transient]').forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const style = getComputedStyle(element);
    const parentGap = element.parentElement
      ? Number.parseFloat(getComputedStyle(element.parentElement).columnGap) || 0
      : 0;
    width +=
      rect.width +
      (Number.parseFloat(style.marginLeft) || 0) +
      (Number.parseFloat(style.marginRight) || 0) +
      parentGap;
  });
  return width;
}

/** Measure the toolbar row and track which controls move into its overflow menu. */
export function useToolbarCollapse(activeView: EditorView, actionsLaneShown: boolean) {
  const actionsRef = useRef<HTMLDivElement>(null);
  // '|'-joined ids (see toolbar/toolbarCollapse.ts) of the buttons and
  // chrome currently collapsed into the ··· menu, plus the document-actions
  // group when it is folded into its own menu. Stored as a string so
  // identical measurements bail out of re-rendering.
  const [collapsedKey, setCollapsedKey] = useState('');
  // '|'-joined data-contextual ids of the contextual groups (template /
  // transition pickers, table / list controls) that don't fit in the actions row.
  const [clippedContextualKey, setClippedContextualKey] = useState('');
  // Collapsed items are `display: none`, so their widths are remembered from
  // the last time they were laid out — every item starts out displayed.
  const itemWidthsRef = useRef(new Map<string, number>());
  // Whether each chrome item shares the actions lane's row. Only a rowmate
  // gives the lane width back when it collapses; on a wrapped toolbar the
  // others are left alone.
  const chromeOnLaneRowRef = useRef(new Map<string, boolean>());
  const collapsedCountRef = useRef(0);

  useEffect(() => {
    const container = actionsRef.current;
    if (!container) return;
    const toolbar = container.parentElement;
    const widths = itemWidthsRef.current;
    const onLaneRow = chromeOnLaneRowRef.current;

    const gapOf = (element: Element | null | undefined): number =>
      element ? Number.parseFloat(getComputedStyle(element).columnGap) || 0 : 0;
    const isDisplayed = (element: HTMLElement): boolean =>
      !element.classList.contains('squisq-toolbar-button--overflowed') &&
      !element.closest('.squisq-toolbar-group--collapsed');
    const remember = (id: string, element: HTMLElement): DOMRect => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) widths.set(id, rect.width);
      return rect;
    };

    const measure = () => {
      const laneRect = container.getBoundingClientRect();

      // The lane's groups, in layout order. Collapsed buttons stay in the DOM
      // (display: none), so the structure is always complete.
      const groups: CollapseGroup[] = [];
      container.querySelectorAll<HTMLElement>(':scope > .squisq-toolbar-group').forEach((group) => {
        const contextual = group.dataset.contextual;
        if (contextual) {
          // Clipped contextual groups are only visibility: hidden, so they
          // still measure.
          remember(`contextual:${contextual}`, group);
          groups.push({ items: [`contextual:${contextual}`], separated: false });
          return;
        }
        const items: string[] = [];
        group.querySelectorAll<HTMLElement>(':scope > [data-toolbar-item]').forEach((item) => {
          const id = item.dataset.toolbarItem!;
          items.push(id);
          if (isDisplayed(item)) remember(id, item);
        });
        if (items.length > 0) groups.push({ items, separated: true });
      });

      const separator = container.querySelector<HTMLElement>(
        ':scope > .squisq-toolbar-group:not(.squisq-toolbar-contextual):not(.squisq-toolbar-group--collapsed) > .squisq-toolbar-separator',
      );
      if (separator) {
        const style = getComputedStyle(separator);
        const width =
          separator.getBoundingClientRect().width +
          (Number.parseFloat(style.marginLeft) || 0) +
          (Number.parseFloat(style.marginRight) || 0);
        if (width > 0) widths.set('separator', width);
      }

      // Everything the lane, the collapsible chrome and the ··· trigger share.
      const rowGap = gapOf(toolbar);
      let budget = laneRect.width;
      const chrome: string[] = [];
      const foldsInPlace = new Set<string>();
      toolbar?.querySelectorAll<HTMLElement>(':scope > [data-toolbar-item]').forEach((item) => {
        const id = item.dataset.toolbarItem!;
        const folded = item.dataset.toolbarFolded;
        if (folded !== undefined) {
          // Chrome that folds in place (the document-actions group) is always
          // displayed, either open or as its menu trigger; remember each
          // state's width separately. Transient content (a read-aloud
          // transport) stays on the row in both states, so it is left out of
          // both: it is a fixed cost the lane's own width already reflects.
          foldsInPlace.add(id);
          const rect = item.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            onLaneRow.set(id, rect.top < laneRect.bottom && rect.bottom > laneRect.top);
            const base = Math.max(0, rect.width - transientWidth(item));
            widths.set(folded === 'true' ? `${id}:folded` : id, base);
            if (onLaneRow.get(id)) budget += base + rowGap;
          }
        } else if (isDisplayed(item)) {
          const rect = remember(id, item);
          if (rect.width > 0 && rect.height > 0) {
            onLaneRow.set(id, rect.top < laneRect.bottom && rect.bottom > laneRect.top);
          }
          if (onLaneRow.get(id)) budget += (widths.get(id) ?? 0) + rowGap;
        }
        if (onLaneRow.get(id)) chrome.push(id);
      });
      const trigger = toolbar?.querySelector<HTMLElement>(':scope > .squisq-toolbar-overflow');
      const triggerWidth = trigger?.getBoundingClientRect().width ?? 0;
      if (triggerWidth > 0) {
        widths.set('trigger', triggerWidth);
        budget += triggerWidth + rowGap;
      }

      const known = [...widths.values()];
      const fallbackWidth = known.length > 0 ? Math.min(...known) : 32;
      const layout = {
        groups,
        chrome,
        widthOf: (id: string) => widths.get(id) ?? fallbackWidth,
        separatorWidth: widths.get('separator') ?? 0,
        groupGap: gapOf(container.querySelector(':scope > .squisq-toolbar-group')),
        laneGap: gapOf(container),
        rowGap,
        triggerWidth: widths.get('trigger') ?? fallbackWidth,
        // Until a group has been seen folded, assume its trigger is about a
        // button and a half wide (the glyph plus a chevron) behind its divider.
        foldedWidthOf: (id: string) =>
          foldsInPlace.has(id)
            ? (widths.get(`${id}:folded`) ??
              (widths.get('separator') ?? 0) + Math.round(fallbackWidth * 1.5))
            : undefined,
        budget,
      };
      let next = chooseCollapsedItems(layout);
      // Restore items only with a little slack to spare, so a row sitting
      // right at a threshold can't flip back and forth between measurements.
      if (next.size < collapsedCountRef.current) {
        next = chooseCollapsedItems({ ...layout, budget: budget - 4 });
      }
      collapsedCountRef.current = next.size;
      const ordered = [...groups.flatMap((group) => group.items), ...chrome].filter((id) =>
        next.has(id),
      );
      setCollapsedKey(ordered.filter((id) => !id.startsWith('contextual:')).join('|'));
      setClippedContextualKey(
        ordered
          .filter((id) => id.startsWith('contextual:'))
          .map((id) => id.slice('contextual:'.length))
          .join('|'),
      );
    };

    // Observe the row and every group in it: contextual groups mount/unmount
    // with the cursor context and change width with their value, all without
    // resizing the flex:1 container itself — a container-only observer would
    // go stale.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const observeAll = () => {
      ro?.disconnect();
      ro?.observe(container);
      container
        .querySelectorAll<HTMLElement>(':scope > .squisq-toolbar-group')
        .forEach((group) => ro?.observe(group));
    };
    const mo = new MutationObserver(() => {
      observeAll();
      measure();
    });
    mo.observe(container, { childList: true });
    if (!ro) window.addEventListener('resize', measure);
    observeAll();
    measure();
    return () => {
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', measure);
      mo.disconnect();
    };
  }, [activeView, actionsLaneShown]);

  const collapsed = new Set(actionsLaneShown && collapsedKey ? collapsedKey.split('|') : []);
  const clippedContextual = new Set(
    actionsLaneShown && clippedContextualKey ? clippedContextualKey.split('|') : [],
  );
  // The document actions fold into a menu of their own, not into ···, so
  // they may stay folded while the lane is away (Use, Find, Source): those
  // modes measure nothing, and the row that was too narrow for the group in
  // Write is still too narrow for it now.
  const documentActionsFolded = collapsedKey.split('|').includes(DOCUMENT_ACTIONS_ITEM);

  return { actionsRef, collapsed, clippedContextual, documentActionsFolded };
}
