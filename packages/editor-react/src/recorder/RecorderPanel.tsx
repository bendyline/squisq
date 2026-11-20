/**
 * RecorderPanel — toolbar-anchored trigger that opens the
 * {@link RecorderModal} in a portal. Shaped to slot into an editor
 * toolbar alongside other panels (e.g. `VersionHistoryPanel`); ships a
 * compact mic/record icon and no label by default.
 *
 * For a button that owns its own visual label, use {@link RecorderButton}
 * instead.
 */

import { lazy, Suspense, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type {
  RecorderColorScheme,
  RecorderNarrationOptions,
  RecorderSaveResult,
  RecorderSlidesOptions,
} from './RecorderModal.js';
import { Icon } from '../Icon';
import type { RecorderSource } from './hooks/useMediaRecorder.js';

// The dialog (capture hooks, device pickers, slides deck, narration stage) is
// loaded the first time it opens: the editor toolbar shows this panel on every
// visit, and most visits never record. e2e/startup-performance.spec.ts holds
// the startup script budget this keeps it out of.
const RecorderModal = lazy(() =>
  import('./RecorderModal.js').then((module) => ({ default: module.RecorderModal })),
);

export interface RecorderPanelProps {
  mediaProvider: MediaProvider;
  container?: ContentContainer | null;
  initialMode?: RecorderSource;
  /** Light/dark chrome scheme copied onto the portaled modal. */
  colorScheme?: RecorderColorScheme;
  onSave?: (result: RecorderSaveResult) => void;
  /** Enables the modal's "Show narration mode" checkbox. */
  narration?: RecorderNarrationOptions | null;
  /** Enables the modal's "Show slides mode" checkbox. */
  slides?: RecorderSlidesOptions | null;
  /** ARIA / tooltip label. Defaults to `'Record media'`. */
  tooltip?: string;
  /** Dialog heading / accessible name. Defaults to the modal's own `'Record media'`. */
  title?: string;
  /** Optional className for the trigger button. */
  className?: string;
  /** Controlled modal state. Omit to let the panel manage its own state. */
  open?: boolean;
  /** Called whenever the trigger or modal requests an open-state change. */
  onOpenChange?: (open: boolean) => void;
  /** Render the built-in trigger button. Defaults to true. */
  showTrigger?: boolean;
}

export function RecorderPanel({
  mediaProvider,
  container = null,
  initialMode = 'mic',
  colorScheme = 'light',
  onSave,
  narration = null,
  slides = null,
  tooltip = 'Record media',
  title,
  className,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: RecorderPanelProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );
  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          className={className}
          data-tooltip={tooltip}
          aria-label={tooltip}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon icon="fa-solid fa-microphone" />
        </button>
      )}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <Suspense fallback={null}>
            <RecorderModal
              mediaProvider={mediaProvider}
              container={container}
              initialMode={initialMode}
              colorScheme={colorScheme}
              narration={narration}
              slides={slides}
              {...(title !== undefined ? { title } : {})}
              onClose={handleClose}
              onSave={(result) => {
                onSave?.(result);
              }}
            />
          </Suspense>,
          document.body,
        )}
    </>
  );
}
