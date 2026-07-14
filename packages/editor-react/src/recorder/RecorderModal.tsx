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
 * video-react`, with inline theme tokens so the body-level portal follows
 * the editor's light/dark chrome scheme.
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useMediaRecorder, type RecorderSource } from './hooks/useMediaRecorder.js';
import { useStreamPreview } from './hooks/useStreamPreview.js';
import { buildFilename } from './formats.js';
import { buildTimingJson, encodeTimingJson, timingPathFor } from './timingJson.js';
import { useModalDialog } from '../modal/useModalDialog.js';

// ── Types ──────────────────────────────────────────────────────────

export type RecorderColorScheme = 'light' | 'dark';

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
  /** Light/dark chrome scheme. Defaults to `'light'`. */
  colorScheme?: RecorderColorScheme;
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

/**
 * The recorder is normally portaled to `document.body`, outside the editor
 * shell's CSS-variable scope. Copy the scheme onto a fresh scope and provide
 * inline fallbacks so the standalone RecorderModal/RecorderButton exports are
 * themed even when a host has not loaded the editor stylesheet.
 */
function recorderThemeStyle(colorScheme: RecorderColorScheme): CSSProperties {
  const dark = colorScheme === 'dark';
  return {
    colorScheme,
    '--squisq-recorder-surface': `var(--squisq-bg, ${dark ? '#1f2937' : '#fffdf7'})`,
    '--squisq-recorder-input': `var(--squisq-input-bg, ${dark ? '#374151' : '#fff'})`,
    '--squisq-recorder-border': `var(--squisq-border, ${dark ? '#4b5563' : '#c9b98a'})`,
    '--squisq-recorder-text': `var(--squisq-text, ${dark ? '#e5e7eb' : '#4a3c1f'})`,
    '--squisq-recorder-muted': `var(--squisq-text-muted, ${dark ? '#9ca3af' : '#5a4a2a'})`,
    '--squisq-recorder-accent': 'var(--squisq-accent, #8b6914)',
    '--squisq-recorder-accent-text': '#fff',
    '--squisq-recorder-danger': dark ? '#dc4c4c' : '#b33a3a',
    '--squisq-recorder-danger-border': dark ? '#ef6a6a' : '#902929',
    '--squisq-recorder-error-bg': dark ? '#3f151b' : '#fceeee',
    '--squisq-recorder-error-border': dark ? '#7f1d1d' : '#d88a8a',
    '--squisq-recorder-error-text': dark ? '#fecdd3' : '#8c2a2a',
  } as CSSProperties;
}

const modalStyle: CSSProperties = {
  background: 'var(--squisq-recorder-surface)',
  border: '1px solid var(--squisq-recorder-border)',
  borderRadius: 0,
  padding: '24px 28px',
  width: 'min(560px, calc(100vw - 48px))',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: 'var(--squisq-recorder-text)',
};

const titleStyle: CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--squisq-recorder-text)',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
  color: 'var(--squisq-recorder-text)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  border: '1px solid var(--squisq-recorder-border)',
  borderRadius: 0,
  background: 'var(--squisq-recorder-input)',
  color: 'var(--squisq-recorder-text)',
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
  background: 'var(--squisq-recorder-accent)',
  color: 'var(--squisq-recorder-accent-text)',
  border: '1px solid var(--squisq-recorder-accent)',
  borderRadius: 0,
};

const btnSecondary: CSSProperties = {
  padding: '8px 20px',
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  background: 'var(--squisq-recorder-input)',
  color: 'var(--squisq-recorder-text)',
  border: '1px solid var(--squisq-recorder-border)',
  borderRadius: 0,
};

const btnDanger: CSSProperties = {
  ...btnPrimary,
  background: 'var(--squisq-recorder-danger)',
  borderColor: 'var(--squisq-recorder-danger-border)',
};

const toggleRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 16,
};

const toggleBase: CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--squisq-recorder-text)',
  border: '1px solid var(--squisq-recorder-border)',
  borderRadius: 999,
};

const toggleActive: CSSProperties = {
  ...toggleBase,
  color: 'var(--squisq-recorder-accent-text)',
  fontWeight: 600,
  background: 'var(--squisq-recorder-accent)',
  borderColor: 'var(--squisq-recorder-accent)',
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
  background: 'var(--squisq-recorder-input)',
  border: '1px solid var(--squisq-recorder-border)',
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--squisq-recorder-muted)',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};

const errorStyle: CSSProperties = {
  background: 'var(--squisq-recorder-error-bg)',
  border: '1px solid var(--squisq-recorder-error-border)',
  color: 'var(--squisq-recorder-error-text)',
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

const summaryStyle: CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: 12,
  color: 'var(--squisq-recorder-muted)',
};

const recordingStatusStyle: CSSProperties = {
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
  marginBottom: 12,
  color: 'var(--squisq-recorder-accent)',
  fontWeight: 600,
};

// ── Helpers ────────────────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** The two mutually-exclusive video sources, plus "none" (audio-only). */
type VideoSource = 'none' | 'camera' | 'screen';

/**
 * Resolve the toggle state (microphone on/off + which video source) to the
 * recorder's capture mode. Returns null when nothing is selected — there's
 * nothing to capture, so the controls stay disabled.
 *
 * Camera + Screen can't be captured together (no compositing), so the two
 * are mutually exclusive; the microphone composes with either, or stands
 * alone as narration.
 */
function deriveSource(micOn: boolean, video: VideoSource): RecorderSource | null {
  if (video === 'camera') return 'camera'; // mic handled via includeMicrophone
  if (video === 'screen') return micOn ? 'screen+mic' : 'screen';
  return micOn ? 'mic' : null;
}

/** Initial toggle state for a given starting capture mode. */
function toggleStateFromMode(mode: RecorderSource): { micOn: boolean; video: VideoSource } {
  switch (mode) {
    case 'mic':
      return { micOn: true, video: 'none' };
    case 'camera':
      return { micOn: true, video: 'camera' };
    case 'screen':
      return { micOn: false, video: 'screen' };
    case 'screen+mic':
      return { micOn: true, video: 'screen' };
  }
}

const TOGGLES: Array<{ key: 'mic' | 'camera' | 'screen'; label: string }> = [
  { key: 'mic', label: 'Microphone' },
  { key: 'camera', label: 'Camera' },
  { key: 'screen', label: 'Screen' },
];

/** One-line summary of what the current toggle combination will capture. */
function captureSummary(micOn: boolean, video: VideoSource): string {
  if (video === 'camera') {
    return micOn
      ? 'Camera video with your microphone. Saved as a video clip.'
      : 'Camera video only (no microphone). Saved as a video clip.';
  }
  if (video === 'screen') {
    return micOn
      ? 'Screen capture with your microphone mixed in. System audio when available.'
      : 'Screen capture (no microphone). System audio when available.';
  }
  return micOn
    ? 'Voice-only audio. Pairs with a written script for auto-mapping to blocks.'
    : 'Pick at least one source to record.';
}

// ── Component ──────────────────────────────────────────────────────

export function RecorderModal({
  mediaProvider,
  container = null,
  initialMode = 'mic',
  colorScheme = 'light',
  onClose,
  onSave,
}: RecorderModalProps) {
  const initialToggles = toggleStateFromMode(initialMode);
  const [micOn, setMicOn] = useState(initialToggles.micOn);
  const [video, setVideo] = useState<VideoSource>(initialToggles.video);
  const [sourceText, setSourceText] = useState('');
  const [basename, setBasename] = useState('');
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const previewRef = useRef<HTMLVideoElement | null>(null);

  // Toggle state → the recorder's capture mode. `source` is null when nothing
  // is selected; we feed the hook a harmless default and gate the controls on
  // `canCapture` instead.
  const derivedSource = deriveSource(micOn, video);
  const canCapture = derivedSource !== null;
  const source: RecorderSource = derivedSource ?? 'mic';

  const recorder = useMediaRecorder({
    source,
    includeMicrophone: video === 'camera' ? micOn : undefined,
    systemAudio: video === 'screen' ? includeSystemAudio : false,
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

  // Switching capture config mid-session: tear down whatever stream/
  // recorder we had so the new mode acquires a fresh one. We key on a
  // signature of everything that changes the acquired stream — including
  // the camera microphone and screen system-audio flags, which don't
  // change `source` on their own. The hook handles its own teardown on
  // unmount; cancel() here covers in-place changes.
  const captureKey = `${source}:${video === 'camera' ? micOn : ''}:${includeSystemAudio}`;
  const previousKeyRef = useRef(captureKey);
  useEffect(() => {
    if (previousKeyRef.current !== captureKey) {
      previousKeyRef.current = captureKey;
      recorder.cancel();
    }
  }, [captureKey, recorder]);

  // Make sure tearing down the modal always releases the camera /
  // screen-capture indicator. The hook's own unmount effect handles
  // this, but we also kill the stream eagerly on close so a slow
  // unmount doesn't leave the indicator lit between renders.
  const handleClose = useCallback(() => {
    recorder.cancel();
    onClose();
  }, [recorder, onClose]);
  useModalDialog({ rootRef: overlayRef, dialogRef, onClose: handleClose });

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

  // Toggles lock while a stream is live (acquiring or recording) — changing
  // the capture config then would tear down the in-progress take.
  const togglesLocked = recorder.state === 'recording' || recorder.state === 'requesting';
  const toggleActiveFor = (key: 'mic' | 'camera' | 'screen') =>
    key === 'mic' ? micOn : video === key;
  const onToggle = (key: 'mic' | 'camera' | 'screen') => {
    if (key === 'mic') {
      setMicOn((on) => !on);
    } else {
      // Camera and Screen are mutually exclusive — turning one on clears the
      // other (no camera+screen compositing).
      setVideo((v) => (v === key ? 'none' : key));
    }
  };

  return (
    <div
      ref={overlayRef}
      className="squisq-editor-shell squisq-recorder-overlay"
      data-theme={colorScheme}
      style={{ ...overlayStyle, ...recorderThemeStyle(colorScheme) }}
    >
      <div
        ref={dialogRef}
        className="squisq-editor-shell"
        data-theme={colorScheme}
        style={{ ...modalStyle, ...recorderThemeStyle(colorScheme) }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <h2 id={headingId} style={titleStyle}>
          Record media
        </h2>

        <div style={toggleRowStyle} role="group" aria-label="Capture sources">
          {TOGGLES.map((t) => {
            const active = toggleActiveFor(t.key);
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                style={active ? toggleActive : toggleBase}
                onClick={() => onToggle(t.key)}
                disabled={togglesLocked}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <p style={summaryStyle}>{captureSummary(micOn, video)}</p>

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
        {video === 'screen' && (
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
              style={{ accentColor: 'var(--squisq-recorder-accent)' }}
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
          <div style={recordingStatusStyle}>
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
            <button
              type="button"
              style={btnPrimary}
              onClick={handleRequest}
              disabled={isBusy || !canCapture}
            >
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
