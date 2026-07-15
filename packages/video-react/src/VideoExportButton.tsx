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
import { VideoExportModal, type VideoExportPalette } from './VideoExportModal.js';
import type { VideoExportConfig } from './hooks/useVideoExport.js';

export interface VideoExportButtonProps {
  /** The document to export */
  doc: Doc;
  /**
   * Player IIFE bundle source. Unused by the browser export path (frames
   * are captured from a live in-page DocPlayer); only forwarded for
   * CLI/Playwright-style pipelines that render standalone HTML.
   */
  playerScript?: string;
  /** Optional media provider for resolving images/audio */
  mediaProvider?: MediaProvider;
  /** Pre-collected images map */
  images?: Map<string, ArrayBuffer>;
  /** Pre-collected audio map */
  audio?: Map<string, ArrayBuffer>;
  /**
   * Seeds the modal's initial output format and export settings and is merged
   * as a base into the config passed to the export hook. Forwarded to
   * {@link VideoExportModal}.
   */
  defaultConfig?: Partial<VideoExportConfig>;
  /** Visual color scheme forwarded to the portaled modal. Defaults to light. */
  colorScheme?: 'light' | 'dark';
  /** Optional host palette overrides forwarded to the portaled modal. */
  uiPalette?: Partial<VideoExportPalette>;
  /** Button label (defaults to "Export Video", or "Export GIF" for a GIF default config) */
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
  defaultConfig,
  colorScheme,
  uiPalette,
  label,
  style,
  disabled,
}: VideoExportButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const resolvedLabel =
    label ?? (defaultConfig?.outputFormat === 'gif' ? 'Export GIF' : 'Export Video');

  const handleOpen = useCallback(() => setShowModal(true), []);
  const handleClose = useCallback(() => setShowModal(false), []);

  return (
    <>
      <button onClick={handleOpen} disabled={disabled} style={style}>
        {resolvedLabel}
      </button>

      {showModal &&
        createPortal(
          <VideoExportModal
            doc={doc}
            playerScript={playerScript}
            mediaProvider={mediaProvider}
            images={images}
            audio={audio}
            defaultConfig={defaultConfig}
            colorScheme={colorScheme}
            uiPalette={uiPalette}
            onClose={handleClose}
          />,
          document.body,
        )}
    </>
  );
}
