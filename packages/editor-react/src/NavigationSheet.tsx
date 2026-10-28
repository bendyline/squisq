/**
 * NavigationSheet
 *
 * The outline and block previews for an editor too narrow to show them as
 * panes. A popover slides in from the right edge and leaves a strip of the
 * document showing on the left; tapping that strip, pressing Escape, swiping
 * the sheet back, or choosing a section closes it. See
 * {@link useNavigationSheetSwipe} for the gestures that open it.
 *
 * Mounted inside `.squisq-editor-with-gutter` so the outline and preview list
 * find the editor they navigate. editor.css removes it when the editor body
 * is wide enough for the panes themselves.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { BlockPreviewList } from './BlockPreviewList';
import { Icon } from './Icon';
import { OutlinePanel } from './OutlinePanel';
import { useEscapeDismissal } from './useEscapeDismissal';
import { useNavigationSheetSwipe, type NavigationSheetPanel } from './useNavigationSheetSwipe';

export interface NavigationSheetProps {
  /** The panel showing, or `null` while the sheet is closed. */
  panel: NavigationSheetPanel | null;
  onPanelChange: (panel: NavigationSheetPanel | null) => void;
  readOnly: boolean;
  basePath: string;
  mediaProvider: MediaProvider | null;
}

const PANEL_LABELS: Record<NavigationSheetPanel, string> = {
  outline: 'Outline',
  previews: 'Block previews',
};
/** Short enough for both tabs to fit a 320px phone beside the close button. */
const TAB_LABELS: Record<NavigationSheetPanel, string> = {
  outline: 'Outline',
  previews: 'Previews',
};
const PANELS: readonly NavigationSheetPanel[] = ['outline', 'previews'];
/** Outlasts the slide-out in editor.css, so a closing sheet keeps its content. */
const CLOSE_LINGER_MS = 300;

export function NavigationSheet({
  panel,
  onPanelChange,
  readOnly,
  basePath,
  mediaProvider,
}: NavigationSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const tabIdPrefix = useId();
  // The panel a finger is pulling in before the release commits it.
  const [dragPanel, setDragPanel] = useState<NavigationSheetPanel | null>(null);
  const open = panel !== null;
  const shown = panel ?? dragPanel;
  // The list stays mounted while the sheet slides away, then unmounts so the
  // previews stop re-rendering on every edit behind a closed sheet.
  const [lastShown, setLastShown] = useState(shown);
  if (shown && shown !== lastShown) setLastShown(shown);
  const content = shown ?? lastShown;
  useEffect(() => {
    if (shown || !lastShown) return;
    const timer = setTimeout(() => setLastShown(null), CLOSE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [shown, lastShown]);

  const close = useCallback(() => {
    setDragPanel(null);
    onPanelChange(null);
  }, [onPanelChange]);
  const commit = useCallback(
    (next: NavigationSheetPanel) => {
      setDragPanel(null);
      onPanelChange(next);
    },
    [onPanelChange],
  );

  useNavigationSheetSwipe({
    sheetRef,
    panelRef,
    open,
    onDragStart: setDragPanel,
    onOpen: commit,
    onClose: close,
  });
  useEscapeDismissal(open, close);

  // A host's own edge gesture (a file drawer, say) must not start on the
  // scrim of a sheet that is already open. Native, because a React handler
  // runs only after the event has bubbled past the host's listener.
  useEffect(() => {
    const scrim = scrimRef.current;
    if (!scrim) return;
    const stop = (event: PointerEvent) => event.stopPropagation();
    scrim.addEventListener('pointerdown', stop);
    return () => scrim.removeEventListener('pointerdown', stop);
  }, []);

  // While open, the editor body beside the sheet leaves the tab order and the
  // accessibility tree, and focus moves into the sheet, which also drops the
  // on-screen keyboard. The toolbar above stays live, so it is not aria-modal.
  useEffect(() => {
    const sheet = sheetRef.current;
    const surface = sheet?.parentElement;
    if (!open || !sheet || !surface) return;
    const siblings = Array.from(surface.children).filter(
      (child): child is HTMLElement =>
        child !== sheet && child instanceof HTMLElement && !child.inert,
    );
    for (const sibling of siblings) sibling.inert = true;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      for (const sibling of siblings) sibling.inert = false;
    };
  }, [open]);

  return (
    <div
      ref={sheetRef}
      className="squisq-navigation-sheet"
      data-state={open ? 'open' : dragPanel ? 'dragging' : 'closed'}
      data-testid="navigation-sheet"
    >
      <div ref={scrimRef} className="squisq-navigation-sheet-scrim" onClick={close} />
      <div
        ref={panelRef}
        className="squisq-navigation-sheet-panel"
        role="dialog"
        aria-label={content ? PANEL_LABELS[content] : 'Document navigation'}
        tabIndex={-1}
      >
        {content && (
          <>
            <div className="squisq-navigation-sheet-header">
              <div className="squisq-navigation-sheet-tabs" role="tablist">
                {PANELS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    id={`${tabIdPrefix}-${option}`}
                    aria-selected={content === option}
                    aria-controls={`${tabIdPrefix}-body`}
                    className="squisq-navigation-sheet-tab"
                    onClick={() => commit(option)}
                  >
                    {TAB_LABELS[option]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="squisq-navigation-sheet-close"
                aria-label="Close"
                onClick={close}
              >
                <Icon icon="xmark" />
              </button>
            </div>
            <div
              id={`${tabIdPrefix}-body`}
              className="squisq-navigation-sheet-body"
              role="tabpanel"
              aria-labelledby={`${tabIdPrefix}-${content}`}
            >
              {content === 'outline' ? (
                <OutlinePanel presentation="sheet" readOnly={readOnly} onNavigate={close} />
              ) : (
                <BlockPreviewList
                  basePath={basePath}
                  mediaProvider={mediaProvider}
                  onNavigate={close}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
