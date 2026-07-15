/* eslint-disable react-refresh/only-export-components */
/**
 * Session-only print-preview state and toolbar controls.
 *
 * Print preview changes only the current Use surface. It never writes a
 * document setting or frontmatter value.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import { useEditorContext } from '../EditorContext';
import { Icon } from '../Icon';
import { usePreviewSettings } from '../PreviewControls';
import { usePresentationMode } from '../presentation/PresentationMode';

export type PrintSlidesPerPage = 1 | 2 | 9;

interface PrintModeContextValue {
  active: boolean;
  slidesPerPage: PrintSlidesPerPage;
  setSlidesPerPage: (value: PrintSlidesPerPage) => void;
  open: () => Promise<void>;
  close: () => void;
  print: () => void;
  registerPrintHandler: (handler: (() => void) | null) => () => void;
}

const PrintModeContext = createContext<PrintModeContextValue | null>(null);

export function usePrintMode(): PrintModeContextValue {
  const value = useContext(PrintModeContext);
  if (!value) throw new Error('usePrintMode must be used within PrintModeProvider');
  return value;
}

/** Optional form used by the independently exported PreviewPanel. */
export function usePrintModeOptional(): PrintModeContextValue | null {
  return useContext(PrintModeContext);
}

export interface PrintModeProviderProps {
  rootRef: RefObject<HTMLElement>;
  children: ReactNode;
}

export function PrintModeProvider({ rootRef, children }: PrintModeProviderProps) {
  const { activeView } = useEditorContext();
  const { activeTarget: presentationTarget, stop: stopPresentation } = usePresentationMode();
  const [active, setActive] = useState(false);
  const [slidesPerPage, setSlidesPerPage] = useState<PrintSlidesPerPage>(1);
  const customPrintHandlerRef = useRef<(() => void) | null>(null);
  const printAncestorsRef = useRef<HTMLElement[]>([]);

  const unmarkPrinting = useCallback(() => {
    const ownerDocument = rootRef.current?.ownerDocument;
    ownerDocument?.body.classList.remove('squisq-printing');
    for (const ancestor of printAncestorsRef.current) {
      delete ancestor.dataset.squisqPrintAncestor;
    }
    printAncestorsRef.current = [];
  }, [rootRef]);

  const markPrinting = useCallback(() => {
    const root = rootRef.current;
    const ownerDocument = root?.ownerDocument;
    if (!root || !ownerDocument) return;
    unmarkPrinting();
    ownerDocument.body.classList.add('squisq-printing');
    let ancestor = root.parentElement;
    while (ancestor && ancestor !== ownerDocument.body) {
      ancestor.dataset.squisqPrintAncestor = 'true';
      printAncestorsRef.current.push(ancestor);
      ancestor = ancestor.parentElement;
    }
  }, [rootRef, unmarkPrinting]);

  const close = useCallback(() => {
    setActive(false);
    customPrintHandlerRef.current = null;
    unmarkPrinting();
  }, [unmarkPrinting]);

  const open = useCallback(async () => {
    if (presentationTarget) await stopPresentation();
    setActive(true);
  }, [presentationTarget, stopPresentation]);

  const registerPrintHandler = useCallback((handler: (() => void) | null) => {
    customPrintHandlerRef.current = handler;
    return () => {
      if (customPrintHandlerRef.current === handler) customPrintHandlerRef.current = null;
    };
  }, []);

  const print = useCallback(() => {
    const customHandler = customPrintHandlerRef.current;
    if (customHandler) {
      customHandler();
      return;
    }

    const ownerDocument = rootRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!ownerDocument || !ownerWindow) return;
    markPrinting();
    ownerWindow.print();
  }, [markPrinting, rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (active) root.dataset.printPreview = 'true';
    else delete root.dataset.printPreview;
    return () => {
      delete root.dataset.printPreview;
    };
  }, [active, rootRef]);

  // Print preview belongs to Use. Moving back to an authoring mode restores
  // the ordinary surface and toolbar immediately.
  useEffect(() => {
    if (activeView !== 'preview' && active) close();
  }, [active, activeView, close]);

  useEffect(() => {
    if (!active) return;
    const ownerWindow = rootRef.current?.ownerDocument.defaultView;
    const ownerDocument = rootRef.current?.ownerDocument;
    if (!ownerWindow || !ownerDocument) return;

    const handleBeforePrint = () => markPrinting();
    const handleAfterPrint = () => unmarkPrinting();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    ownerWindow.addEventListener('beforeprint', handleBeforePrint);
    ownerWindow.addEventListener('afterprint', handleAfterPrint);
    ownerDocument.addEventListener('keydown', handleKeyDown);
    return () => {
      ownerWindow.removeEventListener('beforeprint', handleBeforePrint);
      ownerWindow.removeEventListener('afterprint', handleAfterPrint);
      ownerDocument.removeEventListener('keydown', handleKeyDown);
      handleAfterPrint();
    };
  }, [active, close, markPrinting, rootRef, unmarkPrinting]);

  const value = useMemo<PrintModeContextValue>(
    () => ({
      active,
      slidesPerPage,
      setSlidesPerPage,
      open,
      close,
      print,
      registerPrintHandler,
    }),
    [active, close, open, print, registerPrintHandler, slidesPerPage],
  );

  return <PrintModeContext.Provider value={value}>{children}</PrintModeContext.Provider>;
}

/** The ordinary Use-toolbar trigger, placed directly after Present. */
export function PrintModeControl() {
  const { open } = usePrintMode();
  return (
    <button
      type="button"
      className="squisq-print-trigger"
      onClick={() => void open()}
      aria-label="Print"
      data-tooltip="Print"
    >
      <Icon icon="fa-solid fa-print" />
      <span>Print</span>
    </button>
  );
}

const SLIDES_PER_PAGE_OPTIONS: readonly PrintSlidesPerPage[] = [1, 2, 9];

/** Replacement toolbar shown for the duration of print preview. */
export function PrintPreviewToolbar() {
  const { activeDisplayMode } = usePreviewSettings();
  const { slidesPerPage, setSlidesPerPage, print, close } = usePrintMode();

  return (
    <div className="squisq-print-toolbar" aria-label="Print preview controls">
      <span className="squisq-print-toolbar-title">Print preview</span>
      {activeDisplayMode === 'slideshow' && (
        <div className="squisq-print-density" role="group" aria-label="Slides per page">
          {SLIDES_PER_PAGE_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={`squisq-print-density-button${slidesPerPage === value ? ' squisq-print-density-button--active' : ''}`}
              aria-pressed={slidesPerPage === value}
              aria-label={`${value} ${value === 1 ? 'slide' : 'slides'} per page`}
              onClick={() => setSlidesPerPage(value)}
            >
              <span>{value}</span>
              <span className="squisq-print-density-label">
                {' '}
                {value === 1 ? 'slide' : 'slides'} per page
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="squisq-print-toolbar-spacer" />
      <button type="button" className="squisq-print-action" onClick={print}>
        <Icon icon="fa-solid fa-print" />
        <span>Print</span>
      </button>
      <button type="button" className="squisq-print-close" onClick={close}>
        <Icon icon="fa-solid fa-xmark" />
        <span>Close</span>
      </button>
    </div>
  );
}
