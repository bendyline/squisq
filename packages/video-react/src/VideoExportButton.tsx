/**
 * VideoExportButton — Simple button that opens the VideoExportModal in a portal.
 *
 * Convenience wrapper for consumers who want a drop-in button.
 * The modal renders via `createPortal` into `document.body`.
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Doc } from '@bendyline/squisq/schemas';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { VideoExportModal } from './VideoExportModal.js';

export interface VideoExportButtonProps {
  /** The document to export */
  doc: Doc;
  /** Player IIFE bundle source */
  playerScript: string;
  /** Optional media provider for resolving images/audio */
  mediaProvider?: MediaProvider;
  /** Pre-collected images map */
  images?: Map<string, ArrayBuffer>;
  /** Pre-collected audio map */
  audio?: Map<string, ArrayBuffer>;
  /** Button label (default: "Export Video") */
  label?: string;
  /** Additional inline styles for the button */
  style?: React.CSSProperties;
  /** Whether the button is disabled */
  disabled?: boolean;
}

export function VideoExportButton({
  doc,
  playerScript,
  mediaProvider,
  images,
  audio,
  label = 'Export Video',
  style,
  disabled,
}: VideoExportButtonProps) {
  const [showModal, setShowModal] = useState(false);

  const handleOpen = useCallback(() => setShowModal(true), []);
  const handleClose = useCallback(() => setShowModal(false), []);

  return (
    <>
      <button onClick={handleOpen} disabled={disabled} style={style}>
        {label}
      </button>

      {showModal &&
        createPortal(
          <VideoExportModal
            doc={doc}
            playerScript={playerScript}
            mediaProvider={mediaProvider}
            images={images}
            audio={audio}
            onClose={handleClose}
          />,
          document.body,
        )}
    </>
  );
}
