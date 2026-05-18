/**
 * RecorderModal — configure-and-capture dialog for browser-based audio,
 * camera, and screen recording.
 *
 * States: configure (pick mode + optional script) → previewing (acquired
 * stream, not yet recording) → recording → review (blob in hand) → saved
 * | error. The user can cancel from any state.
 *
 * Persists the captured `Blob` into the supplied `MediaProvider` and,
 * for narration mode, writes a `.timing.json` sidecar so
 * `resolveAudioMapping()` in `@bendyline/squisq` picks it up at the next
 * doc parse.
 *
 * Visual conventions match `VideoExportModal` from `@bendyline/squisq-
 * video-react` (cream / gold palette, inline styles, no external CSS).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useMediaRecorder, type RecorderSource } from './hooks/useMediaRecorder.js';
import { useStreamPreview } from './hooks/useStreamPreview.js';
import { buildFilename } from './formats.js';
import { buildTimingJson, encodeTimingJson, timingPathFor } from './timingJson.js';

// ── Types ──────────────────────────────────────────────────────────

export interface RecorderModalProps {
  /** Required — recordings are written here. */
  mediaProvider: MediaProvider;
  /**
   * Optional — when provided, narration-mode recordings drop a
   * `.timing.json` sidecar at the matching container path so
   * `resolveAudioMapping()` can auto-link them. Without it, only the
   * raw recording is saved.
   */
  container?: ContentContainer | null;
  /** Initial capture source. Defaults to `'mic'` (narration). */
  initialMode?: RecorderSource;
  /** Called after the modal is dismissed (save or cancel). */
  onClose: () => void;
  /**
   * Fired after a successful save. Hosts typically use this to insert a
   * markdown reference at the cursor — see {@link RecorderSaveResult}
   * for the fields a host needs to build that reference.
   */
  onSave?: (result: RecorderSaveResult) => void;
}

/** Payload handed to {@link RecorderModalProps.onSave} on a successful save. */
export interface RecorderSaveResult {
  /** Path returned by `mediaProvider.addMedia()` — what the doc should reference. */
  relativePath: string;
  /** Filename the modal chose (e.g. `narration-20260516-091200.webm`). */
  filename: string;
  /** Capture source the user picked. */
  source: RecorderSource;
  /** MIME type of the saved blob. */
  mimeType: string;
  /** Recording length in seconds. */
  duration: number;
  /** Whether a narration sidecar was written. Always `false` for video sources. */
  hasTimingSidecar: boolean;
  /** Script text the user typed (narration only). */
  sourceText?: string;
}

// ── Styles ─────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: CSSProperties = {
  background: '#FFFDF7',
  border: '1px solid #c9b98a',
  borderRadius: 0,
  padding: '24px 28px',
  width: 'min(560px, calc(100vw - 48px))',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#4a3c1f',
};

const titleStyle: CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: 18,
  fontWeight: 600,
  color: '#2d2310',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
  color: '#5a4a2a',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: '1px solid #c9b98a',
  borderRadius: 0,
  background: '#fff',
  color: '#4a3c1f',
  marginBottom: 12,
  boxSizing: 'border-box',
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 72,
};

const btnPrimary: CSSProperties = {
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

const btnSecondary: CSSProperties = {
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

const btnDanger: CSSProperties = {
  ...btnPrimary,
  background: '#B33A3A',
  borderColor: '#902929',
};

const tabRowStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  marginBottom: 16,
  borderBottom: '1px solid #c9b98a',
};

const tabBase: CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'transparent',
  color: '#5a4a2a',
  border: 'none',
  borderBottom: '2px solid transparent',
  marginBottom: -1,
};

const tabActive: CSSProperties = {
  ...tabBase,
  color: '#2d2310',
  fontWeight: 600,
  // Use the `borderBottom` shorthand (not `borderBottomColor` longhand)
  // so React's style diff cleanly resets the underline when this tab
  // goes inactive — mixing shorthand + longhand can leave the old
  // color stuck on a previously-active tab between renders.
  borderBottom: '2px solid #8B6914',
};

const previewBoxStyle: CSSProperties = {
  width: '100%',
  background: '#000',
  borderRadius: 0,
  marginBottom: 12,
  overflow: 'hidden',
  aspectRatio: '16 / 9',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#888',
  fontSize: 13,
};

const audioMeterStyle: CSSProperties = {
  width: '100%',
  height: 56,
  background: '#F2EBD9',
  border: '1px solid #c9b98a',
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#5a4a2a',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};

const errorStyle: CSSProperties = {
  background: '#FCEEEE',
  border: '1px solid #D88A8A',
  color: '#8C2A2A',
  padding: '8px 10px',
  fontSize: 13,
  marginBottom: 12,
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 8,
};

// ── Helpers ────────────────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const TABS: Array<{ id: RecorderSource; label: string; description: string }> = [
  {
    id: 'mic',
    label: 'Narration',
    description: 'Voice-only audio. Pairs with a written script for auto-mapping to blocks.',
  },
  { id: 'camera', label: 'Camera', description: 'Camera + microphone. Saved as a video clip.' },
  { id: 'screen', label: 'Screen', description: 'Screen capture. System audio when available.' },
  { id: 'screen+mic', label: 'Screen + Mic', description: 'Screen with your microphone mixed in.' },
];

// ── Component ──────────────────────────────────────────────────────

export function RecorderModal({
  mediaProvider,
  container = null,
  initialMode = 'mic',
  onClose,
  onSave,
}: RecorderModalProps) {
  const [source, setSource] = useState<RecorderSource>(initialMode);
  const [sourceText, setSourceText] = useState('');
  const [basename, setBasename] = useState('');
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  const previewRef = useRef<HTMLVideoElement | null>(null);

  const recorder = useMediaRecorder({
    source,
    systemAudio: source === 'screen' || source === 'screen+mic' ? includeSystemAudio : false,
  });

  useStreamPreview(previewRef, recorder.state === 'stopped' ? null : recorder.stream);

  // Generate (and later revoke) a blob URL for the recorded clip so the
  // playback element has something to point at. The dependency on the
  // blob identity means a new URL is created every time a fresh
  // recording lands, and the cleanup callback revokes the previous one.
  useEffect(() => {
    if (!recorder.blob) {
      setPlaybackUrl(null);
      return;
    }
    const url = URL.createObjectURL(recorder.blob);
    setPlaybackUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [recorder.blob]);

  // Switching capture source mid-session: tear down whatever stream/
  // recorder we had so the new mode acquires a fresh one. The hook
  // already handles its own internal teardown on unmount; cancel()
  // here covers in-place source changes.
  const previousSourceRef = useRef(source);
  useEffect(() => {
    if (previousSourceRef.current !== source) {
      previousSourceRef.current = source;
      recorder.cancel();
    }
  }, [source, recorder]);

  // Make sure tearing down the modal always releases the camera /
  // screen-capture indicator. The hook's own unmount effect handles
  // this, but we also kill the stream eagerly on close so a slow
  // unmount doesn't leave the indicator lit between renders.
  const handleClose = useCallback(() => {
    recorder.cancel();
    onClose();
  }, [recorder, onClose]);

  const handleRequest = useCallback(async () => {
    setSaveError(null);
    try {
      await recorder.request();
    } catch {
      // Already surfaced via recorder.error.
    }
  }, [recorder]);

  const handleStart = useCallback(() => {
    setSaveError(null);
    recorder.start();
  }, [recorder]);

  const handleStop = useCallback(async () => {
    setSaveError(null);
    await recorder.stop();
  }, [recorder]);

  const handleSave = useCallback(async () => {
    if (!recorder.blob || !recorder.mimeType || !recorder.extension || !recorder.directory) {
      setSaveError('Nothing to save yet — record something first.');
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const filename = buildFilename(
        source === 'mic' ? 'audio' : 'video',
        recorder.extension,
        basename,
      );
      const relativeName = `${recorder.directory}/${filename}`;
      const relativePath = await mediaProvider.addMedia(
        relativeName,
        recorder.blob,
        recorder.mimeType,
      );

      let hasTimingSidecar = false;
      if (source === 'mic') {
        const timing = buildTimingJson(sourceText, recorder.durationMs / 1000);
        const encoded = encodeTimingJson(timing);
        const sidecarPath = timingPathFor(relativePath);
        // Prefer direct container write so the sidecar lands at the
        // exact path the audio-mapping pipeline expects. Fall back to
        // addMedia(), which may rename — log if so.
        if (container) {
          await container.writeFile(sidecarPath, encoded, 'application/json');
          hasTimingSidecar = true;
        } else {
          const written = await mediaProvider.addMedia(sidecarPath, encoded, 'application/json');
          hasTimingSidecar = written === sidecarPath;
          if (!hasTimingSidecar) {
            console.warn(
              `[squisq-recorder] timing.json was saved as "${written}" instead of "${sidecarPath}" — auto-mapping may not pick it up.`,
            );
          }
        }
      }

      const result: RecorderSaveResult = {
        relativePath,
        filename,
        source,
        mimeType: recorder.mimeType,
        duration: recorder.durationMs / 1000,
        hasTimingSidecar,
      };
      if (source === 'mic') {
        result.sourceText = sourceText;
      }
      onSave?.(result);
      handleClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recording');
    } finally {
      setIsSaving(false);
    }
  }, [recorder, source, basename, sourceText, mediaProvider, container, onSave, handleClose]);

  const handleDiscard = useCallback(() => {
    recorder.reset();
  }, [recorder]);

  const isAudioOnly = source === 'mic';
  const showPreview = recorder.state !== 'idle' && recorder.state !== 'error';
  const canRecord = recorder.state === 'ready';
  const canStop = recorder.state === 'recording';
  const canSave = recorder.state === 'stopped' && recorder.blob !== null;
  const isBusy = recorder.state === 'requesting' || recorder.state === 'stopping' || isSaving;

  const activeTabDescription = TABS.find((t) => t.id === source)?.description;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Record media">
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={titleStyle}>Record media</h2>

        <div style={tabRowStyle} role="tablist">
          {TABS.map((tab) => {
            const active = tab.id === source;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                type="button"
                style={active ? tabActive : tabBase}
                onClick={() => setSource(tab.id)}
                disabled={recorder.state === 'recording' || recorder.state === 'requesting'}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTabDescription && (
          <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#5a4a2a' }}>
            {activeTabDescription}
          </p>
        )}

        {recorder.error && <div style={errorStyle}>{recorder.error.message}</div>}
        {saveError && <div style={errorStyle}>{saveError}</div>}

        {/* Preview surface. Three modes:
            - Pre-acquisition (idle / error): a static prompt.
            - Live (ready / recording / requesting / stopping): the stream
              piped into a muted <video>, or a recording meter for mic.
            - Playback (stopped): the captured blob bound to a <video>/<audio>
              with native controls so the user can audition before saving.
          */}
        {!showPreview && (
          <div style={previewBoxStyle}>
            <span>Click Start Preview to start a recording.</span>
          </div>
        )}
        {showPreview && recorder.state !== 'stopped' && !isAudioOnly && (
          <div style={previewBoxStyle}>
            <video
              ref={previewRef}
              autoPlay
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        )}
        {showPreview && recorder.state !== 'stopped' && isAudioOnly && (
          <div style={audioMeterStyle}>
            {recorder.state === 'recording' ? (
              <>● Recording {formatDurationMs(recorder.durationMs)}</>
            ) : (
              <>Microphone ready</>
            )}
          </div>
        )}
        {recorder.state === 'stopped' && playbackUrl && !isAudioOnly && (
          <div style={previewBoxStyle}>
            <video
              src={playbackUrl}
              controls
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        )}
        {recorder.state === 'stopped' && playbackUrl && isAudioOnly && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...audioMeterStyle, marginBottom: 8 }}>
              ✓ Recorded {formatDurationMs(recorder.durationMs)}
            </div>
            <audio src={playbackUrl} controls style={{ width: '100%' }} />
          </div>
        )}

        {/* Mode-specific fields */}
        {source === 'mic' && (
          <>
            <label style={labelStyle} htmlFor="recorder-source-text">
              Script (used to auto-match this narration to a block)
            </label>
            <textarea
              id="recorder-source-text"
              style={textareaStyle}
              placeholder="Type the text you're going to read aloud."
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              disabled={recorder.state === 'recording'}
            />
          </>
        )}
        {(source === 'screen' || source === 'screen+mic') && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={includeSystemAudio}
              onChange={(e) => setIncludeSystemAudio(e.target.checked)}
              disabled={recorder.state === 'recording' || recorder.state === 'requesting'}
            />
            Include system audio (Chrome only)
          </label>
        )}

        <label style={labelStyle} htmlFor="recorder-basename">
          Filename (optional)
        </label>
        <input
          id="recorder-basename"
          type="text"
          style={inputStyle}
          placeholder={source === 'mic' ? 'narration' : 'recording'}
          value={basename}
          onChange={(e) => setBasename(e.target.value)}
          disabled={recorder.state === 'recording'}
        />

        {/* Live duration during recording */}
        {recorder.state === 'recording' && !isAudioOnly && (
          <div
            style={{
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
              marginBottom: 12,
              color: '#8B6914',
              fontWeight: 600,
            }}
          >
            ● Recording {formatDurationMs(recorder.durationMs)}
          </div>
        )}

        {/* Action buttons. Layout depends on state. */}
        <div style={buttonRowStyle}>
          <button type="button" style={btnSecondary} onClick={handleClose} disabled={isBusy}>
            Close
          </button>

          {(recorder.state === 'idle' ||
            recorder.state === 'error' ||
            recorder.state === 'requesting') && (
            <button type="button" style={btnPrimary} onClick={handleRequest} disabled={isBusy}>
              {recorder.state === 'requesting' ? 'Requesting…' : 'Start preview'}
            </button>
          )}

          {canRecord && (
            <button type="button" style={btnPrimary} onClick={handleStart} disabled={isBusy}>
              Record
            </button>
          )}

          {canStop && (
            <button type="button" style={btnDanger} onClick={handleStop} disabled={isBusy}>
              Stop
            </button>
          )}

          {canSave && (
            <>
              <button type="button" style={btnSecondary} onClick={handleDiscard} disabled={isBusy}>
                Discard & re-record
              </button>
              <button type="button" style={btnPrimary} onClick={handleSave} disabled={isBusy}>
                {isSaving ? 'Saving…' : 'Save to document'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
