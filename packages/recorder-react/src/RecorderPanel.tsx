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

/**
 * Inline 16×16 SVG mic icon — currentColor-driven so it inherits the
 * toolbar's icon color regardless of theme.
 */
function MicIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={5.5} y={2} width={5} height={8} rx={2.5} />
      <path d="M3.5 7.5v1a4.5 4.5 0 0 0 9 0v-1" />
      <line x1={8} y1={13} x2={8} y2={15} />
      <line x1={5.5} y1={15} x2={10.5} y2={15} />
    </svg>
  );
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
        <MicIcon />
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
