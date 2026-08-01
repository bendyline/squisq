/* eslint-disable react-refresh/only-export-components */
/**
 * Presentation mode state and toolbar chrome.
 *
 * Presentation is intentionally session-only: it changes where the active
 * Use surface is shown, never the document or its frontmatter.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useEditorContext } from '../EditorContext';
import { Icon } from '../Icon';
import { usePreviewSettings } from '../PreviewControls';

export type PresentationTarget = 'control' | 'window' | 'fullscreen';

interface PresentationModeContextValue {
  selectedTarget: PresentationTarget;
  activeTarget: PresentationTarget | null;
  popupRoot: HTMLElement | null;
  availableTargets: readonly PresentationTarget[];
  fullscreenSupported: boolean;
  selectTarget: (target: PresentationTarget) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const PresentationModeContext = createContext<PresentationModeContextValue | null>(null);

export function usePresentationMode(): PresentationModeContextValue {
  const value = useContext(PresentationModeContext);
  if (!value) {
    throw new Error('usePresentationMode must be used within PresentationModeProvider');
  }
  return value;
}

/** Optional form used by the independently exported PreviewPanel. */
export function usePresentationModeOptional(): PresentationModeContextValue | null {
  return useContext(PresentationModeContext);
}

export interface PresentationModeProviderProps {
  rootRef: RefObject<HTMLElement>;
  children: ReactNode;
  /** Whether the host supports opening the audience view in a separate window. */
  allowWindow?: boolean;
  /** Whether the host supports presenting through the browser Fullscreen API. */
  allowFullscreen?: boolean;
}

const POPUP_WIDTH = 1280;
const POPUP_HEIGHT = 720;

/**
 * How long to let a resolved `exitFullscreen()` actually release the element
 * before reporting the exit as failed. Electron on macOS turns HTML fullscreen
 * into a native Spaces transition and resolves the promise roughly half a
 * second before that transition starts, so the release lands well after the
 * await settles.
 */
const FULLSCREEN_RELEASE_TIMEOUT_MS = 4000;

/**
 * Resolve once `root` is no longer the fullscreen element, or when the timeout
 * expires. Hosts disagree about when `exitFullscreen()` settles relative to the
 * `fullscreenchange` that actually releases the element, so the event is the
 * only trustworthy signal.
 */
function waitForFullscreenRelease(
  ownerDocument: Document,
  root: Element,
  timeoutMs: number,
): Promise<boolean> {
  if (ownerDocument.fullscreenElement !== root) return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (released: boolean): void => {
      ownerDocument.removeEventListener('fullscreenchange', handleChange);
      window.clearTimeout(timer);
      resolve(released);
    };
    const handleChange = (): void => {
      if (ownerDocument.fullscreenElement !== root) settle(true);
    };
    const timer = window.setTimeout(
      () => settle(ownerDocument.fullscreenElement !== root),
      timeoutMs,
    );
    ownerDocument.addEventListener('fullscreenchange', handleChange);
  });
}

function copyDocumentStyles(source: Document, target: Document): void {
  for (const sheet of Array.from(source.styleSheets)) {
    if (sheet.href) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      target.head.appendChild(link);
      continue;
    }
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      const style = target.createElement('style');
      style.textContent = css;
      target.head.appendChild(style);
    } catch {
      // An inaccessible inline sheet cannot be reproduced in the popup.
    }
  }
}

function copyCustomProperties(source: HTMLElement, target: HTMLElement): void {
  const sourceWindow = source.ownerDocument.defaultView;
  if (!sourceWindow) return;

  const computed = sourceWindow.getComputedStyle(source);
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    if (!property.startsWith('--')) continue;
    target.style.setProperty(property, computed.getPropertyValue(property));
  }
}

function preparePopupDocument(
  popup: Window,
  sourceRoot: HTMLElement,
  title: string,
  colorScheme: 'light' | 'dark',
  presentationBackground: string,
): HTMLElement {
  const source = sourceRoot.ownerDocument;
  const doc = popup.document;
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  doc.title = title;

  const base = doc.createElement('base');
  base.href = source.baseURI;
  doc.head.appendChild(base);

  const viewport = doc.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  doc.head.appendChild(viewport);

  copyDocumentStyles(source, doc);

  const frameStyle = doc.createElement('style');
  frameStyle.textContent =
    'html,body{width:100%;height:100%;margin:0;overflow:hidden;}' +
    '#squisq-presentation-root{position:relative;width:100%;height:100%;overflow:hidden;' +
    'background:var(--squisq-presentation-bg,var(--squisq-bg,#f5f5f5));}';
  doc.head.appendChild(frameStyle);

  const root = doc.createElement('div');
  root.id = 'squisq-presentation-root';
  root.className = 'squisq-editor-shell squisq-presentation-root';
  root.dataset.theme = colorScheme;
  copyCustomProperties(sourceRoot, root);
  root.style.setProperty('--squisq-presentation-bg', presentationBackground);
  doc.body.appendChild(root);
  return root;
}

function presentationTitle(docTitle: unknown): string {
  return typeof docTitle === 'string' && docTitle.trim()
    ? `${docTitle.trim()} - Presentation`
    : 'Squisq Presentation';
}

export function PresentationModeProvider({
  rootRef,
  children,
  allowWindow = true,
  allowFullscreen = true,
}: PresentationModeProviderProps) {
  const { activeView, colorScheme, doc } = useEditorContext();
  const { activeTheme } = usePreviewSettings();
  const popupNameId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [selectedTarget, setSelectedTarget] = useState<PresentationTarget>('control');
  const [activeTarget, setActiveTarget] = useState<PresentationTarget | null>(null);
  const [popupRoot, setPopupRoot] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeTargetRef = useRef(activeTarget);
  activeTargetRef.current = activeTarget;
  const previousActiveTargetRef = useRef<PresentationTarget | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupCleanupRef = useRef<(() => void) | null>(null);

  const fullscreenSupported =
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function';
  const availableTargets = useMemo<readonly PresentationTarget[]>(
    () => [
      'control',
      ...(allowWindow ? (['window'] as const) : []),
      ...(allowFullscreen ? (['fullscreen'] as const) : []),
    ],
    [allowFullscreen, allowWindow],
  );

  const releasePopup = useCallback((closeWindow: boolean) => {
    const popup = popupRef.current;
    popupCleanupRef.current?.();
    popupCleanupRef.current = null;
    popupRef.current = null;
    setPopupRoot(null);
    // Use a queued state update rather than the ref alone. If popup setup
    // fails after `setActiveTarget('window')` but before React commits it, this
    // updater still runs after that queued transition and clears the state.
    setActiveTarget((current) => (current === 'window' ? null : current));
    if (closeWindow && popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        // The user may have already closed or navigated the window.
      }
    }
  }, []);

  const stop = useCallback(async () => {
    const active = activeTargetRef.current;
    if (active === 'window') {
      releasePopup(true);
      return;
    }
    if (active === 'fullscreen') {
      const root = rootRef.current;
      const ownerDocument = root?.ownerDocument;
      if (root && ownerDocument?.fullscreenElement === root) {
        try {
          await ownerDocument.exitFullscreen();
        } catch {
          if (ownerDocument.fullscreenElement === root) {
            setError('Could not exit full screen. Press Escape to leave it.');
            return;
          }
        }
        // A resolved `exitFullscreen()` does not mean the element has been
        // released yet, so re-checking synchronously here would report a
        // failure for an exit that is merely still animating.
        const released = await waitForFullscreenRelease(
          ownerDocument,
          root,
          FULLSCREEN_RELEASE_TIMEOUT_MS,
        );
        if (!released) {
          setError('Still in full screen. Press Escape to leave it.');
          return;
        }
      }
    }
    setActiveTarget(null);
  }, [releasePopup, rootRef]);

  const start = useCallback(async () => {
    setError(null);
    const root = rootRef.current;
    if (!root) return;
    const activeElement = root.ownerDocument.activeElement;
    returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

    if (selectedTarget === 'control') {
      setActiveTarget('control');
      return;
    }

    if (selectedTarget === 'fullscreen') {
      if (!allowFullscreen) return;
      if (typeof root.requestFullscreen !== 'function') {
        setError('Full screen is unavailable here.');
        return;
      }
      try {
        // Keep this call directly in the user-initiated click path: hosts
        // reject fullscreen requests after the activation has been yielded.
        // Hiding navigation asks Chromium (including Electron) for the complete
        // OS display instead of a browser-chrome-constrained presentation.
        await root.requestFullscreen({ navigationUI: 'hide' });
        setActiveTarget('fullscreen');
      } catch {
        setError('Could not enter full screen.');
      }
      return;
    }

    if (!allowWindow) return;

    let popup: Window | null = null;
    try {
      const screenWidth = window.screen?.availWidth || POPUP_WIDTH;
      const screenHeight = window.screen?.availHeight || POPUP_HEIGHT;
      const width = Math.min(POPUP_WIDTH, Math.max(640, Math.round(screenWidth * 0.9)));
      const height = Math.min(POPUP_HEIGHT, Math.max(480, Math.round(screenHeight * 0.9)));
      popup = window.open(
        '',
        `squisq-presentation-${popupNameId}`,
        `popup=yes,width=${width},height=${height}`,
      );
      if (!popup) throw new Error('Popup blocked');
      const nextRoot = preparePopupDocument(
        popup,
        root,
        presentationTitle(doc?.frontmatter?.title),
        colorScheme,
        activeTheme.colors.background,
      );
      popupRef.current = popup;
      setPopupRoot(nextRoot);
      setActiveTarget('window');

      const handlePageHide = () => releasePopup(false);
      const handlePopupKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') releasePopup(true);
      };
      popup.addEventListener('pagehide', handlePageHide);
      popup.document.addEventListener('keydown', handlePopupKeyDown);
      const closedPoll = window.setInterval(() => {
        if (popup?.closed) releasePopup(false);
      }, 500);
      popupCleanupRef.current = () => {
        popup?.removeEventListener('pagehide', handlePageHide);
        popup?.document.removeEventListener('keydown', handlePopupKeyDown);
        window.clearInterval(closedPoll);
      };
      popup.focus();
    } catch {
      if (popupRef.current) releasePopup(true);
      else if (popup && !popup.closed) popup.close();
      setError('The presentation window was blocked. Allow pop-ups and try again.');
    }
  }, [
    allowFullscreen,
    allowWindow,
    activeTheme.colors.background,
    colorScheme,
    doc?.frontmatter?.title,
    popupNameId,
    releasePopup,
    rootRef,
    selectedTarget,
  ]);

  const selectTarget = useCallback(
    (target: PresentationTarget) => {
      if (!availableTargets.includes(target)) return;
      if (target === selectedTarget) return;
      setSelectedTarget(target);
      if (activeTargetRef.current !== null) void stop();
    },
    [availableTargets, selectedTarget, stop],
  );

  // Hosts can change capabilities without remounting the editor. Leave any
  // now-unavailable presentation and return the split button to its safe,
  // in-control destination.
  useEffect(() => {
    if (availableTargets.includes(selectedTarget)) return;
    setSelectedTarget('control');
    if (activeTargetRef.current !== null) void stop();
  }, [availableTargets, selectedTarget, stop]);

  // Fullscreen can end outside React (normally via the browser's Escape key).
  useEffect(() => {
    const root = rootRef.current;
    const ownerDocument = root?.ownerDocument;
    if (!root || !ownerDocument) return;
    const handleFullscreenChange = () => {
      if (activeTargetRef.current === 'fullscreen' && ownerDocument.fullscreenElement !== root) {
        setActiveTarget(null);
      }
    };
    ownerDocument.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => ownerDocument.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [rootRef]);

  // The bounded mode relies on the shell data attribute for its layout. The
  // popup attribute is useful to hosts for styling the active toolbar button.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (activeTarget) root.dataset.presentationMode = activeTarget;
    else delete root.dataset.presentationMode;
    return () => {
      delete root.dataset.presentationMode;
    };
  }, [activeTarget, rootRef]);

  // Presentation belongs to Use. Switching back to an editor closes any
  // external window and restores the normal shell immediately.
  useEffect(() => {
    if (activeView !== 'preview' && activeTargetRef.current !== null) void stop();
  }, [activeView, stop]);

  // Moving into bounded/fullscreen presentation hides the toolbar that held
  // focus. Put focus on the visible exit affordance, then restore the original
  // launcher after every exit path (button, Escape, native fullscreen exit,
  // or the audience window being closed externally).
  useEffect(() => {
    const previous = previousActiveTargetRef.current;
    previousActiveTargetRef.current = activeTarget;
    if (previous === null || activeTarget !== null) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, [activeTarget]);

  useEffect(() => {
    if (activeTarget !== 'control') return;
    const ownerDocument = rootRef.current?.ownerDocument;
    if (!ownerDocument) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void stop();
    };
    ownerDocument.addEventListener('keydown', handleKeyDown);
    return () => ownerDocument.removeEventListener('keydown', handleKeyDown);
  }, [activeTarget, rootRef, stop]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(
    () => () => {
      popupCleanupRef.current?.();
      const popup = popupRef.current;
      if (popup && !popup.closed) popup.close();
      const root = rootRef.current;
      const ownerDocument = root?.ownerDocument;
      if (root && ownerDocument?.fullscreenElement === root) {
        void ownerDocument.exitFullscreen().catch(() => undefined);
      }
    },
    [rootRef],
  );

  const value = useMemo<PresentationModeContextValue>(
    () => ({
      selectedTarget,
      activeTarget,
      popupRoot,
      availableTargets,
      fullscreenSupported,
      selectTarget,
      start,
      stop,
    }),
    [
      selectedTarget,
      activeTarget,
      popupRoot,
      availableTargets,
      fullscreenSupported,
      selectTarget,
      start,
      stop,
    ],
  );

  const presentationThemeStyle = {
    '--squisq-presentation-control-bg': activeTheme.colors.backgroundLight,
    '--squisq-presentation-control-text': activeTheme.colors.text,
    '--squisq-presentation-control-border': activeTheme.colors.primary,
  } as CSSProperties;

  const exitButton = activeTarget ? (
    <button
      type="button"
      className="squisq-presentation-exit"
      data-theme={colorScheme}
      style={presentationThemeStyle}
      onClick={() => void stop()}
      autoFocus={activeTarget === 'control' || activeTarget === 'fullscreen'}
      aria-label="Exit presentation mode"
      title="Exit presentation mode (Esc)"
    >
      <Icon icon="fa-solid fa-compress" />
      <span>Exit presentation</span>
    </button>
  ) : null;

  return (
    <PresentationModeContext.Provider value={value}>
      {children}
      {(activeTarget === 'control' || activeTarget === 'fullscreen') && exitButton}
      {activeTarget === 'window' && popupRoot && exitButton
        ? createPortal(exitButton, popupRoot)
        : null}
      {error && typeof document !== 'undefined'
        ? createPortal(
            <div className="squisq-presentation-error" data-theme={colorScheme} role="alert">
              {error}
            </div>,
            document.body,
          )
        : null}
    </PresentationModeContext.Provider>
  );
}

const PRESENTATION_OPTIONS: readonly {
  target: PresentationTarget;
  label: string;
  summary: string;
  icon: string;
}[] = [
  {
    target: 'control',
    label: 'Fill canvas',
    summary: 'Use the entire app canvas.',
    icon: 'fa-solid fa-window-maximize',
  },
  {
    target: 'window',
    label: 'New window',
    summary: 'Open an audience view synced to this one.',
    icon: 'fa-solid fa-up-right-from-square',
  },
  {
    target: 'fullscreen',
    label: 'Full screen',
    summary: 'Use the entire OS screen.',
    icon: 'fa-solid fa-expand',
  },
];

const MENU_WIDTH = 340;
const MENU_MARGIN = 8;
const MENU_GAP = 4;

/** Fixed Use-toolbar split button: launch on the left, destination on the right. */
export function PresentationModeControl() {
  const {
    selectedTarget,
    activeTarget,
    availableTargets,
    fullscreenSupported,
    selectTarget,
    start,
    stop,
  } = usePresentationMode();
  const { colorScheme } = useEditorContext();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const options = PRESENTATION_OPTIONS.filter((option) => availableTargets.includes(option.target));
  const selected =
    options.find((option) => option.target === selectedTarget) ?? PRESENTATION_OPTIONS[0];

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, window.innerWidth - MENU_MARGIN * 2);
    setAnchor({
      top: rect.bottom + MENU_GAP,
      left: Math.min(
        Math.max(MENU_MARGIN, rect.right - width),
        Math.max(MENU_MARGIN, window.innerWidth - width - MENU_MARGIN),
      ),
    });
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [closeMenu, open, updatePosition]);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    (checked ?? first)?.focus();
  }, [anchor, open]);

  return (
    <div className="squisq-presentation-control">
      <button
        type="button"
        className={`squisq-toolbar-button squisq-presentation-start${activeTarget ? ' squisq-toolbar-button--active' : ''}`}
        aria-label={activeTarget ? 'Stop presentation' : `Present: ${selected.label}`}
        aria-pressed={activeTarget !== null}
        data-tooltip={activeTarget ? 'Exit presentation' : `Present: ${selected.label}`}
        onClick={() => void (activeTarget ? stop() : start())}
      >
        <Icon icon="fa-solid fa-display" />
      </button>
      {options.length > 1 && (
        <button
          ref={triggerRef}
          type="button"
          className={`squisq-presentation-menu-trigger${open ? ' squisq-presentation-menu-trigger--open' : ''}`}
          aria-label="Presentation options"
          aria-haspopup="menu"
          aria-expanded={open}
          title={`Presentation destination: ${selected.label}`}
          onClick={() => (open ? closeMenu() : openMenu())}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            openMenu();
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      )}
      {open && anchor
        ? createPortal(
            <div
              ref={menuRef}
              className="squisq-use-mode-menu squisq-presentation-menu"
              data-theme={colorScheme}
              role="menu"
              aria-label="Presentation options"
              style={{ top: anchor.top, left: anchor.left }}
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault();
                  closeMenu(true);
                  return;
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitemradio"]:not(:disabled)',
                  ),
                );
                if (items.length === 0) return;
                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : event.key === 'ArrowUp'
                        ? (currentIndex - 1 + items.length) % items.length
                        : (currentIndex + 1) % items.length;
                items[nextIndex]?.focus();
              }}
            >
              {options.map((option) => {
                const isSelected = option.target === selectedTarget;
                const disabled = option.target === 'fullscreen' && !fullscreenSupported;
                return (
                  <button
                    key={option.target}
                    type="button"
                    className={`squisq-use-mode-menu-item squisq-presentation-menu-item${isSelected ? ' squisq-use-mode-menu-item--selected squisq-presentation-menu-item--selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    disabled={disabled}
                    onClick={() => {
                      selectTarget(option.target);
                      closeMenu(true);
                    }}
                  >
                    <span
                      className="squisq-use-mode-menu-icon squisq-presentation-menu-icon"
                      aria-hidden="true"
                    >
                      <Icon icon={option.icon} />
                    </span>
                    <span className="squisq-use-mode-menu-copy squisq-presentation-menu-copy">
                      <span className="squisq-use-mode-menu-label squisq-presentation-menu-label">
                        {option.label}
                      </span>
                      <span className="squisq-use-mode-menu-summary squisq-presentation-menu-summary">
                        {disabled ? 'Full screen is unavailable.' : option.summary}
                      </span>
                    </span>
                    <span
                      className="squisq-use-mode-menu-check squisq-presentation-menu-check"
                      aria-hidden="true"
                    >
                      {isSelected && <Icon icon="fa-solid fa-check" />}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
