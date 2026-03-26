/**
 * VideoExportModal — Modal dialog for configuring and monitoring video export.
 *
 * States:
 *   configure → exporting (capturing + encoding) → complete | error
 *
 * Inline styles match the site's cream/gold palette (from FileToolbar).
 */

import { useState, useCallback } from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
import type { CaptionMode } from '@bendyline/squisq-react';
import { useVideoExport, type VideoExportConfig } from './hooks/useVideoExport.js';

// ── Types ──────────────────────────────────────────────────────────

export interface VideoExportModalProps {
  /** The document to export */
  doc: Doc;
  /** Player IIFE bundle source */
  playerScript: string;
  /** Optional media provider for resolving images/audio */
  mediaProvider?: MediaProvider;
  /** Pre-collected images map (alternative to mediaProvider) */
  images?: Map<string, ArrayBuffer>;
  /** Pre-collected audio map */
  audio?: Map<string, ArrayBuffer>;
  /** Called when the modal should close */
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ── Styles ─────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: React.CSSProperties = {
  background: '#FFFDF7',
  border: '1px solid #c9b98a',
  borderRadius: 0,
  padding: '24px 28px',
  minWidth: 380,
  maxWidth: 480,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#4a3c1f',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: 18,
  fontWeight: 600,
  color: '#2d2310',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
  color: '#5a4a2a',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: '1px solid #c9b98a',
  borderRadius: 0,
  background: '#fff',
  color: '#4a3c1f',
  marginBottom: 12,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  background: '#8B6914',
  color: '#fff',
  border: '1px solid #7a5c10',
  borderRadius: 0,
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  background: '#E8DFC6',
  color: '#4a3c1f',
  border: '1px solid #c9b98a',
  borderRadius: 0,
};

const progressBarOuterStyle: React.CSSProperties = {
  width: '100%',
  height: 8,
  background: '#E8DFC6',
  borderRadius: 0,
  overflow: 'hidden',
  marginBottom: 8,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 20,
};

// ── Component ──────────────────────────────────────────────────────

export function VideoExportModal({
  doc,
  playerScript,
  mediaProvider,
  images,
  audio,
  onClose,
}: VideoExportModalProps) {
  const [quality, setQuality] = useState<VideoQuality>('normal');
  const [fps, setFps] = useState(24);
  const [orientation, setOrientation] = useState<VideoOrientation>('landscape');
  const [captionMode, setCaptionMode] = useState<CaptionMode>('off');

  const exportHook = useVideoExport();
  const { state, progress, backend, downloadUrl, fileSize, error, elapsed, estimatedRemaining,
    startExport, cancel: cancelExport, reset: resetExport } = exportHook;

  const handleExport = useCallback(async () => {
    const config: VideoExportConfig = {
      quality,
      fps,
      orientation,
      captionMode,
      images,
      audio,
      mediaProvider,
      playerScript,
    };
    await startExport(doc, config);
  }, [doc, quality, fps, orientation, captionMode, images, audio, mediaProvider, playerScript, startExport]);

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement('a');
    a.href = downloadUrl;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `document-${ts}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [downloadUrl]);

  const handleClose = useCallback(() => {
    if (state === 'capturing' || state === 'encoding' || state === 'preparing') {
      cancelExport();
    }
    resetExport();
    onClose();
  }, [state, cancelExport, resetExport, onClose]);

  const isExporting = state === 'preparing' || state === 'capturing' || state === 'encoding';

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={titleStyle}>Export Video</h2>

        {/* ── Configure State ── */}
        {state === 'idle' && (
          <>
            <div>
              <label style={labelStyle}>Quality</label>
              <select
                style={selectStyle}
                value={quality}
                onChange={(e) => setQuality(e.target.value as VideoQuality)}
              >
                <option value="draft">Draft — fast, lower quality</option>
                <option value="normal">Normal — balanced</option>
                <option value="high">High — best quality, slower</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Frame Rate</label>
              <select
                style={selectStyle}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              >
                <option value={15}>15 fps — fast export</option>
                <option value={24}>24 fps — cinematic</option>
                <option value={30}>30 fps — smooth</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Orientation</label>
              <select
                style={selectStyle}
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as VideoOrientation)}
              >
                <option value="landscape">Landscape (1920 × 1080)</option>
                <option value="portrait">Portrait (1080 × 1920)</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Captions</label>
              <select
                style={selectStyle}
                value={captionMode}
                onChange={(e) => setCaptionMode(e.target.value as CaptionMode)}
              >
                <option value="off">None</option>
                <option value="standard">Standard (top bar)</option>
                <option value="social">Social media (large words)</option>
              </select>
            </div>

            <div style={footerStyle}>
              <button style={btnSecondary} onClick={handleClose}>
                Cancel
              </button>
              <button style={btnPrimary} onClick={handleExport}>
                Export Video
              </button>
            </div>
          </>
        )}

        {/* ── Exporting State ── */}
        {isExporting && (
          <>
            {backend && (
              <p style={{ fontSize: 12, color: '#8a7a5a', margin: '0 0 8px 0' }}>
                Encoder: WebCodecs (H.264)
              </p>
            )}

            <div style={progressBarOuterStyle}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: '#8B6914',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            <p style={{ fontSize: 13, margin: '0 0 4px 0' }}>{progress}% complete</p>
            <p style={{ fontSize: 12, color: '#8a7a5a', margin: 0 }}>
              {formatDuration(elapsed)} elapsed
              {estimatedRemaining > 0 && ` · ~${formatDuration(estimatedRemaining)} remaining`}
            </p>

            <div style={footerStyle}>
              <button style={btnSecondary} onClick={cancelExport}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── Complete State ── */}
        {state === 'complete' && (
          <>
            <p style={{ fontSize: 14, margin: '0 0 8px 0', color: '#2d6a10' }}>
              Export complete!
            </p>
            <p style={{ fontSize: 13, color: '#5a4a2a', margin: '0 0 4px 0' }}>
              File size: {(fileSize / (1024 * 1024)).toFixed(1)} MB
            </p>
            {backend && (
              <p style={{ fontSize: 12, color: '#8a7a5a', margin: '0 0 12px 0' }}>
                Encoded with WebCodecs (H.264)
              </p>
            )}

            <div style={footerStyle}>
              <button style={btnSecondary} onClick={handleClose}>
                Close
              </button>
              <button style={btnPrimary} onClick={handleDownload}>
                Download MP4
              </button>
            </div>
          </>
        )}

        {/* ── Error State ── */}
        {state === 'error' && (
          <>
            <p style={{ fontSize: 14, margin: '0 0 8px 0', color: '#a03020' }}>Export failed</p>
            <p
              style={{
                fontSize: 13,
                color: '#5a4a2a',
                margin: '0 0 12px 0',
                wordBreak: 'break-word',
              }}
            >
              {error}
            </p>

            <div style={footerStyle}>
              <button style={btnSecondary} onClick={handleClose}>
                Close
              </button>
              <button style={btnPrimary} onClick={handleExport}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
