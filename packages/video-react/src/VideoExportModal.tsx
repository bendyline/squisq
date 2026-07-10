/**
 * VideoExportModal — Modal dialog for configuring and monitoring video export.
 *
 * States:
 *   configure → exporting (capturing + encoding) → complete | error
 *
 * Hosts may supply a resolved color scheme so this portaled dialog matches
 * the surface that opened it.
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
  /**
   * Player IIFE bundle source. Unused by the browser export path (frames
   * are captured from a live in-page DocPlayer); only forwarded for
   * CLI/Playwright-style pipelines that render standalone HTML.
   */
  playerScript?: string;
  /** Optional media provider for resolving images/audio */
  mediaProvider?: MediaProvider;
  /** Pre-collected images map (alternative to mediaProvider) */
  images?: Map<string, ArrayBuffer>;
  /** Pre-collected audio map */
  audio?: Map<string, ArrayBuffer>;
  /**
   * Seeds the modal's initial quality/fps/orientation/captionMode selections
   * and is merged (as a base) into the config passed to the export hook, so a
   * host can share one config shape with `useVideoExport`. The individual
   * `images`/`audio`/`mediaProvider`/`playerScript` props still take
   * precedence over any matching key here.
   */
  defaultConfig?: Partial<VideoExportConfig>;
  /** Visual color scheme for the portaled dialog. Defaults to light. */
  colorScheme?: 'light' | 'dark';
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

interface VideoExportPalette {
  overlay: string;
  surface: string;
  control: string;
  border: string;
  text: string;
  heading: string;
  label: string;
  muted: string;
  secondary: string;
  primary: string;
  primaryBorder: string;
  success: string;
  danger: string;
}

const VIDEO_EXPORT_PALETTES: Record<'light' | 'dark', VideoExportPalette> = {
  light: {
    overlay: 'rgba(0, 0, 0, 0.5)',
    surface: '#FFFDF7',
    control: '#ffffff',
    border: '#c9b98a',
    text: '#4a3c1f',
    heading: '#2d2310',
    label: '#5a4a2a',
    muted: '#8a7a5a',
    secondary: '#E8DFC6',
    primary: '#8B6914',
    primaryBorder: '#7a5c10',
    success: '#2d6a10',
    danger: '#a03020',
  },
  dark: {
    overlay: 'rgba(2, 6, 23, 0.72)',
    surface: '#111827',
    control: '#0f172a',
    border: '#475569',
    text: '#e5e7eb',
    heading: '#f8fafc',
    label: '#cbd5e1',
    muted: '#94a3b8',
    secondary: '#1e293b',
    primary: '#9a7416',
    primaryBorder: '#d1a73b',
    success: '#86efac',
    danger: '#fca5a5',
  },
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: React.CSSProperties = {
  borderRadius: 0,
  padding: '24px 28px',
  minWidth: 380,
  maxWidth: 480,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: 18,
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  borderRadius: 0,
  marginBottom: 12,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  color: '#fff',
  borderRadius: 0,
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  borderRadius: 0,
};

const progressBarOuterStyle: React.CSSProperties = {
  width: '100%',
  height: 8,
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
  defaultConfig,
  colorScheme = 'light',
  onClose,
}: VideoExportModalProps) {
  const [quality, setQuality] = useState<VideoQuality>(defaultConfig?.quality ?? 'normal');
  const [fps, setFps] = useState(defaultConfig?.fps ?? 24);
  const [orientation, setOrientation] = useState<VideoOrientation>(
    defaultConfig?.orientation ?? 'landscape',
  );
  const [captionMode, setCaptionMode] = useState<CaptionMode>(defaultConfig?.captionMode ?? 'off');
  const palette = VIDEO_EXPORT_PALETTES[colorScheme];
  const themedModalStyle: React.CSSProperties = {
    ...modalStyle,
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    color: palette.text,
    colorScheme,
  };
  const themedTitleStyle: React.CSSProperties = { ...titleStyle, color: palette.heading };
  const themedLabelStyle: React.CSSProperties = { ...labelStyle, color: palette.label };
  const themedSelectStyle: React.CSSProperties = {
    ...selectStyle,
    border: `1px solid ${palette.border}`,
    background: palette.control,
    color: palette.text,
    colorScheme,
  };
  const themedPrimaryButtonStyle: React.CSSProperties = {
    ...btnPrimary,
    background: palette.primary,
    border: `1px solid ${palette.primaryBorder}`,
  };
  const themedSecondaryButtonStyle: React.CSSProperties = {
    ...btnSecondary,
    background: palette.secondary,
    color: palette.text,
    border: `1px solid ${palette.border}`,
  };

  const exportHook = useVideoExport();
  const {
    state,
    progress,
    backend,
    downloadUrl,
    fileSize,
    audioIncluded,
    audioSkippedReason,
    error,
    elapsed,
    estimatedRemaining,
    startExport,
    cancel: cancelExport,
    reset: resetExport,
  } = exportHook;

  const handleExport = useCallback(async () => {
    const config: VideoExportConfig = {
      // defaultConfig is the base; explicit props/selections win over it.
      ...defaultConfig,
      quality,
      fps,
      orientation,
      captionMode,
      images,
      audio,
      mediaProvider,
      // Only thread the bundle through when the host actually supplied one.
      ...(playerScript !== undefined ? { playerScript } : {}),
    };
    await startExport(doc, config);
  }, [
    doc,
    quality,
    fps,
    orientation,
    captionMode,
    images,
    audio,
    mediaProvider,
    playerScript,
    defaultConfig,
    startExport,
  ]);

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
    <div
      style={{ ...overlayStyle, background: palette.overlay }}
      data-color-scheme={colorScheme}
      onClick={handleClose}
    >
      <div style={themedModalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={themedTitleStyle}>Export Video</h2>

        {/* ── Configure State ── */}
        {state === 'idle' && (
          <>
            <div>
              <label style={themedLabelStyle}>Quality</label>
              <select
                style={themedSelectStyle}
                value={quality}
                onChange={(e) => setQuality(e.target.value as VideoQuality)}
              >
                <option value="draft">Draft — fast, lower quality</option>
                <option value="normal">Normal — balanced</option>
                <option value="high">High — best quality, slower</option>
              </select>
            </div>

            <div>
              <label style={themedLabelStyle}>Frame Rate</label>
              <select
                style={themedSelectStyle}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              >
                <option value={15}>15 fps — fast export</option>
                <option value={24}>24 fps — cinematic</option>
                <option value={30}>30 fps — smooth</option>
              </select>
            </div>

            <div>
              <label style={themedLabelStyle}>Orientation</label>
              <select
                style={themedSelectStyle}
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as VideoOrientation)}
              >
                <option value="landscape">Landscape (1920 × 1080)</option>
                <option value="portrait">Portrait (1080 × 1920)</option>
              </select>
            </div>

            <div>
              <label style={themedLabelStyle}>Captions</label>
              <select
                style={themedSelectStyle}
                value={captionMode}
                onChange={(e) => setCaptionMode(e.target.value as CaptionMode)}
              >
                <option value="off">None</option>
                <option value="standard">Standard (top bar)</option>
                <option value="social">Social media (large words)</option>
              </select>
            </div>

            <div style={footerStyle}>
              <button style={themedSecondaryButtonStyle} onClick={handleClose}>
                Cancel
              </button>
              <button style={themedPrimaryButtonStyle} onClick={handleExport}>
                Export Video
              </button>
            </div>
          </>
        )}

        {/* ── Exporting State ── */}
        {isExporting && (
          <>
            {backend && (
              <p style={{ fontSize: 12, color: palette.muted, margin: '0 0 8px 0' }}>
                Encoder: WebCodecs (H.264)
              </p>
            )}

            <div style={{ ...progressBarOuterStyle, background: palette.secondary }}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: palette.primary,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            <p style={{ fontSize: 13, margin: '0 0 4px 0' }}>{progress}% complete</p>
            <p style={{ fontSize: 12, color: palette.muted, margin: 0 }}>
              {formatDuration(elapsed)} elapsed
              {estimatedRemaining > 0 && ` · ~${formatDuration(estimatedRemaining)} remaining`}
            </p>

            <div style={footerStyle}>
              <button style={themedSecondaryButtonStyle} onClick={cancelExport}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── Complete State ── */}
        {state === 'complete' && (
          <>
            <p style={{ fontSize: 14, margin: '0 0 8px 0', color: palette.success }}>
              Export complete!
            </p>
            <p style={{ fontSize: 13, color: palette.label, margin: '0 0 4px 0' }}>
              File size: {(fileSize / (1024 * 1024)).toFixed(1)} MB
            </p>
            {audioIncluded ? (
              <p style={{ fontSize: 12, color: palette.success, margin: '0 0 4px 0' }}>
                Audio included ✓
              </p>
            ) : (
              <p style={{ fontSize: 12, color: palette.muted, margin: '0 0 4px 0' }}>
                Video only{audioSkippedReason ? ` — ${audioSkippedReason}` : ''}
              </p>
            )}
            {backend && (
              <p style={{ fontSize: 12, color: palette.muted, margin: '0 0 12px 0' }}>
                Encoded with WebCodecs (H.264)
              </p>
            )}

            <div style={footerStyle}>
              <button style={themedSecondaryButtonStyle} onClick={handleClose}>
                Close
              </button>
              <button style={themedPrimaryButtonStyle} onClick={handleDownload}>
                Download MP4
              </button>
            </div>
          </>
        )}

        {/* ── Error State ── */}
        {state === 'error' && (
          <>
            <p style={{ fontSize: 14, margin: '0 0 8px 0', color: palette.danger }}>
              Export failed
            </p>
            <p
              style={{
                fontSize: 13,
                color: palette.label,
                margin: '0 0 12px 0',
                wordBreak: 'break-word',
              }}
            >
              {error}
            </p>

            <div style={footerStyle}>
              <button style={themedSecondaryButtonStyle} onClick={handleClose}>
                Close
              </button>
              <button style={themedPrimaryButtonStyle} onClick={handleExport}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
