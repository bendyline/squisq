/**
 * SidePanelDrawer — the image editor's layers and properties pane.
 *
 * In a wide editor it is a plain 280px column beside the canvas. Once the
 * editor body is phone-width (see SIDE_PANEL_DRAWER_MAX_BODY_WIDTH) the pane
 * would leave the canvas a sliver, so it becomes a drawer: hidden past the
 * right edge with a small tab left showing, pulled in by a tap on the tab or a
 * swipe from the edge, and put away by a tap on the tab or the scrim, a swipe
 * back to the right, or Escape. image-editor.css switches the layout.
 *
 * The root is `display: contents`, so the scrim, the edge strip and the panel
 * lay out against the editor body while the root still carries the state and
 * the drag progress they all read.
 */

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import {
  SIDE_PANEL_DRAWER_MAX_BODY_WIDTH,
  useSidePanelDrawerSwipe,
} from './useSidePanelDrawerSwipe';

export interface SidePanelDrawerProps {
  children: ReactNode;
}

export function SidePanelDrawer({ children }: SidePanelDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const show = useCallback(() => {
    setDragging(false);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setDragging(false);
    setOpen(false);
    // Focus inside the panel would be left on a control that is about to
    // hide; the tab is still showing, and is where the panel opens again.
    if (contentRef.current?.contains(document.activeElement)) {
      tabRef.current?.focus({ preventScroll: true });
    }
  }, []);
  const startDrag = useCallback(() => setDragging(true), []);

  useSidePanelDrawerSwipe({
    drawerRef,
    panelRef,
    handleRefs: [tabRef, edgeRef],
    open,
    onDragStart: startDrag,
    onOpen: show,
    onClose: hide,
  });

  return (
    <div
      ref={drawerRef}
      className="squisq-image-editor-drawer"
      data-state={open ? 'open' : dragging ? 'dragging' : 'closed'}
      data-testid="image-editor-drawer"
    >
      <div className="squisq-image-editor-drawer-scrim" aria-hidden="true" onClick={hide} />
      <div ref={edgeRef} className="squisq-image-editor-drawer-edge" aria-hidden="true" />
      <div
        ref={panelRef}
        className="squisq-image-editor-side"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented || !open) return;
          const body = drawerRef.current?.parentElement;
          if (!body || body.getBoundingClientRect().width > SIDE_PANEL_DRAWER_MAX_BODY_WIDTH) {
            return;
          }
          // Put the drawer away rather than letting the modal around the
          // editor close on the same key.
          event.preventDefault();
          event.stopPropagation();
          hide();
        }}
      >
        <button
          ref={tabRef}
          type="button"
          className="squisq-image-editor-drawer-tab"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={open ? 'Hide layers and properties' : 'Show layers and properties'}
          title={open ? 'Hide layers and properties' : 'Layers and properties'}
          onClick={() => (open ? hide() : show())}
        >
          <Icon icon={open ? 'fa-solid fa-chevron-right' : 'fa-solid fa-layer-group'} />
        </button>
        <div ref={contentRef} id={contentId} className="squisq-image-editor-side-content">
          {children}
        </div>
      </div>
    </div>
  );
}
