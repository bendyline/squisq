/**
 * RecorderPanel — toolbar-anchored trigger that opens the
 * {@link RecorderModal} in a portal. Shaped to slot into an editor
 * toolbar alongside other panels (e.g. `VersionHistoryPanel`); ships a
 * compact mic/record icon and no label by default.
 *
 * For a button that owns its own visual label, use {@link RecorderButton}
 * instead.
 */

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { RecorderModal, type RecorderSaveResult } from './RecorderModal.js';
import { Icon } from '../Icon';
import type { RecorderSource } from './hooks/useMediaRecorder.js';

export interface RecorderPanelProps {
  mediaProvider: MediaProvider;
  container?: ContentContainer | null;
  initialMode?: RecorderSource;
  onSave?: (result: RecorderSaveResult) => void;
  /** ARIA / tooltip label. Defaults to `'Record media'`. */
  tooltip?: string;
  /** Optional className for the trigger button. */
  className?: string;
}

export function RecorderPanel({
  mediaProvider,
  container = null,
  initialMode = 'mic',
  onSave,
  tooltip = 'Record media',
  className,
}: RecorderPanelProps) {
  const [open, setOpen] = useState(false);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className={className}
        data-tooltip={tooltip}
        aria-label={tooltip}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon="fa-solid fa-microphone" />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <RecorderModal
            mediaProvider={mediaProvider}
            container={container}
            initialMode={initialMode}
            onClose={handleClose}
            onSave={(result) => {
              onSave?.(result);
            }}
          />,
          document.body,
        )}
    </>
  );
}
