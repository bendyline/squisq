/**
 * RecorderButton — drop-in button that opens the {@link RecorderModal}
 * in a portal anchored to `document.body`. Convenience wrapper for
 * hosts that don't need to manage modal open/close state themselves.
 *
 * Mirrors the consumption pattern of `VideoExportButton` in
 * `@bendyline/squisq-video-react`.
 */

import { useCallback, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { RecorderModal, type RecorderSaveResult } from './RecorderModal.js';
import type { RecorderSource } from './hooks/useMediaRecorder.js';

export interface RecorderButtonProps {
  /** Where to write the resulting recording. Required. */
  mediaProvider: MediaProvider;
  /** Optional container for narration `.timing.json` sidecar writes. */
  container?: ContentContainer | null;
  /** Initial capture source. Defaults to `'mic'`. */
  initialMode?: RecorderSource;
  /** Fired after a successful save. */
  onSave?: (result: RecorderSaveResult) => void;
  /** Button label. Defaults to `'Record'`. */
  label?: string;
  /** Optional inline button styles. */
  style?: CSSProperties;
  /** Whether the button is disabled. */
  disabled?: boolean;
}

export function RecorderButton({
  mediaProvider,
  container = null,
  initialMode = 'mic',
  onSave,
  label = 'Record',
  style,
  disabled,
}: RecorderButtonProps) {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const handleSave = useCallback(
    (result: RecorderSaveResult) => {
      onSave?.(result);
    },
    [onSave],
  );

  return (
    <>
      <button type="button" onClick={handleOpen} style={style} disabled={disabled}>
        {label}
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <RecorderModal
            mediaProvider={mediaProvider}
            container={container}
            initialMode={initialMode}
            onClose={handleClose}
            onSave={handleSave}
          />,
          document.body,
        )}
    </>
  );
}
