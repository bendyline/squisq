/**
 * RecorderModal — configure-and-capture dialog for browser-based audio,
 * camera, and screen recording.
 *
 * States: configure (pick mode + optional script) → previewing (acquired
 * stream, not yet recording) → recording → review (blob in hand) → saved
 * | error. The user can cancel from any state.
 *
 * Selecting BOTH Camera and Screen records them as two files at once
 * (`'screen+camera'`): the microphone rides the camera file, system audio
 * rides the screen file. On save the host inserts the screen clip plus a
 * camera picture-in-picture clip (see {@link RecorderSaveResult.camera}).
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

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Doc, MediaProvider, Theme } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useMediaRecorder, type RecorderSource } from './hooks/useMediaRecorder.js';
import { useStreamPreview } from './hooks/useStreamPreview.js';
import { requestCameraStream } from './sources/cameraStream.js';
import {
  buildFilename,
  supportsSystemAudioCapture,
  type RecordingFilenameSeed,
} from './formats.js';
import { buildTimingJson, encodeTimingJson, timingPathFor } from './timingJson.js';
import { useModalDialog } from '../modal/useModalDialog.js';
import {
  useNarrationStage,
  type TeleprompterRecordingDeps,
} from '../teleprompter/useNarrationStage.js';
import { NarrationStage } from '../teleprompter/NarrationStage.js';
import {
  closeNeedsConfirm,
  escapeClosesDialog,
  narrationCaptureSummary,
  narrationQuiescent,
  narrationToggleLocked,
} from './narrationModePolicy.js';

// ── Types ──────────────────────────────────────────────────────────

export type RecorderColorScheme = 'light' | 'dark';

/**
 * Everything narration mode needs beyond the base recorder props. Supplying
 * this (with non-null `recording`) surfaces the "Show narration mode"
 * checkbox; when checked, the dialog expands and mounts the teleprompter
 * beside the capture preview, and mic recording switches to the narration
 * pipeline (voice-aligned v3 timing sidecar + document preamble insertion).
 */
export interface RecorderNarrationOptions {
  /** Parsed document the prompter script is built from. */
  doc: Doc | null;
  /** Theme for the prompter surface (colors/fonts). */
  theme: Theme;
  /** Editor plumbing for the narration save pipeline; null hides the checkbox. */
  recording: TeleprompterRecordingDeps | null;
}

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
   *
   * NOT fired for narration-mode saves: the narration pipeline writes its
   * own `{[audio …]}` document preamble (via `executeNarrationSave`), so a
   * host insertion here would double up.
   */
  onSave?: (result: RecorderSaveResult) => void;
  /** Enables the "Show narration mode" checkbox. Omit for the classic dialog. */
  narration?: RecorderNarrationOptions | null;
}

/**
 * The camera companion of a `'screen+camera'` save. Present only on that
 * source's {@link RecorderSaveResult}; describes the picture-in-picture file
 * that pairs with the screen recording in {@link RecorderSaveResult}.
 */
export interface RecorderCameraSaveResult {
  /** Path returned by `mediaProvider.addMedia()` for the camera file. */
  relativePath: string;
  /** Filename the modal chose for the camera file. */
  filename: string;
  /** MIME type of the saved camera blob. */
  mimeType: string;
  /** Camera recording length in seconds. */
  duration: number;
  /**
   * Camera start minus screen start, in seconds (may be negative). Drives the
   * PiP clip's `startAt`/`clipStart` so the bubble lines up with the screen.
   */
  offsetSec: number;
}

/** Payload handed to {@link RecorderModalProps.onSave} on a successful save. */
export interface RecorderSaveResult {
  /** Path returned by `mediaProvider.addMedia()` — what the doc should reference.
   * For `'screen+camera'` this is the SCREEN file (see {@link RecorderSaveResult.camera}). */
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
  /** The paired camera file — present only for `source === 'screen+camera'`. */
  camera?: RecorderCameraSaveResult;
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

const btnRecord: CSSProperties = {
  ...btnPrimary,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const recordDotFrameStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  padding: 2,
  border: '1px solid #9ca3af',
  borderRadius: '50%',
  background: '#000',
};

const recordDotStyle: CSSProperties = {
  display: 'block',
  width: 9,
  height: 9,
  borderRadius: '50%',
  background: 'var(--squisq-recorder-danger)',
};

const toggleRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 16,
  flexWrap: 'wrap',
  alignItems: 'center',
};

/** A pill cluster (mic+camera, or system-audio+screen) inside the toggle row. */
const toggleGroupStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
};

/** Thin vertical rule separating the two toggle groups. */
const groupDividerStyle: CSSProperties = {
  alignSelf: 'stretch',
  width: 1,
  background: 'var(--squisq-recorder-border)',
  margin: '0 4px',
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

const playbackTimeStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  padding: '3px 7px',
  background: 'rgba(0, 0, 0, 0.72)',
  color: '#fff',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.4,
  pointerEvents: 'none',
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

/**
 * Narration mode expands the dialog to fill the viewport and turns the body
 * into a two-column flex row: the classic capture controls on the left, the
 * teleprompter stage on the right. The body must NOT scroll in this mode —
 * the prompter needs a bounded flex height, so only the left column scrolls.
 */
const modalExpandedStyle: CSSProperties = {
  ...modalStyle,
  width: 'calc(100vw - 48px)',
  height: 'calc(100vh - 48px)',
  maxHeight: 'none',
  overflowY: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const bodyRowStyle: CSSProperties = {
  display: 'flex',
  gap: 24,
  flex: '1 1 auto',
  minHeight: 0,
};

const leftColStyle: CSSProperties = {
  flex: '0 0 min(420px, 38vw)',
  overflowY: 'auto',
  minHeight: 0,
  paddingRight: 4,
};

const rightColStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--squisq-recorder-border)',
};

const checkboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 12,
  fontSize: 13,
};

const meterLevelStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  background: 'var(--squisq-recorder-accent)',
  opacity: 0.25,
  transition: 'width 80ms linear',
};

// ── Helpers ────────────────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Which of the four capture sources a toggle controls. */
type ToggleKey = 'mic' | 'camera' | 'screen' | 'systemAudio';

/** The capture-source toggle state driving the recorder mode. */
interface CaptureToggles {
  micOn: boolean;
  cameraOn: boolean;
  screenOn: boolean;
}

/**
 * Resolve the toggle state to the recorder's capture mode. Returns null when
 * no source is selected — there's nothing to capture, so the controls stay
 * disabled.
 *
 * Camera and Screen can be captured TOGETHER (`'screen+camera'`), each written
 * to its own file: the microphone rides the camera file, system audio rides
 * the screen file. With only one video source on, the microphone composes with
 * it (or stands alone as narration).
 */
function deriveSource({ micOn, cameraOn, screenOn }: CaptureToggles): RecorderSource | null {
  if (cameraOn && screenOn) return 'screen+camera';
  if (cameraOn) return 'camera'; // mic handled via includeMicrophone
  if (screenOn) return micOn ? 'screen+mic' : 'screen';
  return micOn ? 'mic' : null;
}

/** Initial toggle state for a given starting capture mode. */
function toggleStateFromMode(mode: RecorderSource): CaptureToggles {
  switch (mode) {
    case 'mic':
      return { micOn: true, cameraOn: false, screenOn: false };
    case 'camera':
      return { micOn: true, cameraOn: true, screenOn: false };
    case 'screen':
      return { micOn: false, cameraOn: false, screenOn: true };
    case 'screen+mic':
      return { micOn: true, cameraOn: false, screenOn: true };
    case 'screen+camera':
      return { micOn: true, cameraOn: true, screenOn: true };
  }
}

/**
 * Capture-source pills, grouped so the presenter inputs (mic + camera) read
 * as a pair distinct from the screen inputs (system audio + screen). System
 * audio is only offered when the platform can honor it.
 */
const TOGGLE_GROUPS: Array<{ label: string; toggles: Array<{ key: ToggleKey; label: string }> }> = [
  {
    label: 'Voice and camera',
    toggles: [
      { key: 'mic', label: 'Microphone' },
      { key: 'camera', label: 'Camera' },
    ],
  },
  {
    label: 'Screen capture',
    toggles: [
      { key: 'systemAudio', label: 'System audio' },
      { key: 'screen', label: 'Screen' },
    ],
  },
];

/** One-line summary of what the current toggle combination will capture. */
function captureSummary(micOn: boolean, cameraOn: boolean, screenOn: boolean): string {
  if (cameraOn && screenOn) {
    return micOn
      ? 'Screen capture plus your camera as picture-in-picture; microphone on the camera clip, system audio on the screen clip when available. Saved as two video clips.'
      : 'Screen capture plus your camera as picture-in-picture (no microphone). Saved as two video clips.';
  }
  if (cameraOn) {
    return micOn
      ? 'Camera video with your microphone. Saved as a video clip.'
      : 'Camera video only (no microphone). Saved as a video clip.';
  }
  if (screenOn) {
    return micOn
      ? 'Screen capture with your microphone mixed in. System audio when available.'
      : 'Screen capture (no microphone). System audio when available.';
  }
  return micOn
    ? 'Voice-only audio. Pairs with a written script for auto-mapping to blocks.'
    : 'Pick at least one source to record.';
}

/**
 * Describe the tracks that made it into the acquired stream. This deliberately
 * reads the result instead of trusting the requested toggles: display capture
 * may accept an audio request while returning video only.
 */
function recordingFilenameSeed(
  source: RecorderSource,
  stream: MediaStream | null,
  audioRequested: boolean,
): RecordingFilenameSeed {
  if (source === 'mic') return 'audio';
  // Before preview, make the filename hint reflect the selected sources. Once
  // acquired, the stream is authoritative because browsers may omit requested
  // display audio.
  const hasAudio = stream ? stream.getAudioTracks().length > 0 : audioRequested;
  if (source === 'camera') return hasAudio ? 'camera+audio' : 'camera';
  return hasAudio ? 'screen+audio' : 'screen';
}

/**
 * The two filename seeds for a `'screen+camera'` save — one per file. Each
 * reads its own acquired stream's audio tracks so the name reflects what the
 * file actually contains (browsers may drop a requested display-audio track).
 */
function dualFilenameSeeds(
  screenStream: MediaStream | null,
  cameraStream: MediaStream | null,
  systemAudioRequested: boolean,
  micRequested: boolean,
): { screen: RecordingFilenameSeed; camera: RecordingFilenameSeed } {
  const screenHasAudio = screenStream
    ? screenStream.getAudioTracks().length > 0
    : systemAudioRequested;
  const cameraHasAudio = cameraStream
    ? cameraStream.getAudioTracks().length > 0
    : micRequested;
  return {
    screen: screenHasAudio ? 'screen+audio' : 'screen',
    camera: cameraHasAudio ? 'camera+audio' : 'camera',
  };
}

// ── Component ──────────────────────────────────────────────────────

export function RecorderModal({
  mediaProvider,
  container = null,
  initialMode = 'mic',
  colorScheme = 'light',
  onClose,
  onSave,
  narration = null,
}: RecorderModalProps) {
  const initialToggles = toggleStateFromMode(initialMode);
  const [micOn, setMicOn] = useState(initialToggles.micOn);
  const [cameraOn, setCameraOn] = useState(initialToggles.cameraOn);
  const [screenOn, setScreenOn] = useState(initialToggles.screenOn);
  const [sourceText, setSourceText] = useState('');
  const [basename, setBasename] = useState('');
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [cameraPlaybackUrl, setCameraPlaybackUrl] = useState<string | null>(null);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [narrationOn, setNarrationOn] = useState(false);
  const [narrationRequesting, setNarrationRequesting] = useState(false);
  const [narrationPreview, setNarrationPreview] = useState<MediaStream | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);

  // Toggle state → the recorder's capture mode. `source` is null when nothing
  // is selected; we feed the hook a harmless default and gate the controls on
  // `canCapture` instead.
  const derivedSource = deriveSource({ micOn, cameraOn, screenOn });
  const canCapture = derivedSource !== null;
  const source: RecorderSource = derivedSource ?? 'mic';
  const isDual = source === 'screen+camera';
  const canIncludeSystemAudio = supportsSystemAudioCapture();

  const recorder = useMediaRecorder({
    source,
    includeMicrophone: cameraOn ? micOn : undefined,
    systemAudio: screenOn && canIncludeSystemAudio ? includeSystemAudio : false,
  });
  const filenameSeed = recordingFilenameSeed(
    source,
    recorder.stream,
    micOn || (screenOn && includeSystemAudio),
  );

  // ── Narration mode ─────────────────────────────────────────────────
  // Called unconditionally (rules of hooks); the stage hooks are idle-cheap
  // — no mic until play/record, no float window until opened.
  const narrationAvailable = Boolean(narration && narration.recording);
  const basenameRef = useRef(basename);
  basenameRef.current = basename;
  const stage = useNarrationStage({
    doc: narration?.doc ?? null,
    recording: narration?.recording ?? null,
    getAudioBasename: () => basenameRef.current.trim() || undefined,
  });
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Mode edges. Entering narration releases the simple recorder's stream
  // (no double mic capture); leaving quiets the prompter and its mic/float.
  // Deliberately NOT part of `captureKey` below — the checkbox lock rules
  // guarantee neither side has a take in flight when the mode flips.
  const prevNarrationOnRef = useRef(narrationOn);
  useEffect(() => {
    const was = prevNarrationOnRef.current;
    prevNarrationOnRef.current = narrationOn;
    if (was === narrationOn) return;
    if (narrationOn) {
      recorder.cancel();
    } else {
      const s = stageRef.current;
      s.controller.pause();
      if (s.controller.mic.status === 'live' || s.controller.mic.status === 'starting') {
        s.controller.mic.stop();
      }
      if (s.float.isOpen) s.float.close();
    }
  }, [narrationOn, recorder]);

  // While the prompter rolls, Escape means "pause", not "close". useModalDialog
  // swallows Escape via stopPropagation during the DOCUMENT CAPTURE phase, so a
  // bubble listener would never see it — this must be a capture listener on the
  // same node (same-node listeners still run after stopPropagation; only
  // stopImmediatePropagation — which the hook doesn't use — would block us).
  useEffect(() => {
    if (!narrationOn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const c = stageRef.current.controller;
      if (c.transport === 'rolling' || c.transport === 'countdown') c.pause();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [narrationOn]);

  // Narration camera preview: the dialog owns a video-only stream between
  // "Start preview" and the recorder's own camera acquisition, so the user
  // grants permission and frames the shot BEFORE the take starts. The
  // narration recorder acquires its own stream at start(); ours is released
  // as soon as that one exists (a brief overlap beats a black gap).
  const narrationMicLive = stage.controller.mic.status === 'live';
  const narrationPreviewWanted =
    narrationOn &&
    stage.recorder.withCamera &&
    narrationMicLive &&
    stage.recorder.cameraStream === null &&
    stage.recorder.state !== 'processing' &&
    stage.recorder.state !== 'review' &&
    stage.recorder.state !== 'saving';
  const narrationPreviewRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (!narrationPreviewWanted) {
      const existing = narrationPreviewRef.current;
      if (existing) {
        for (const track of existing.getTracks()) track.stop();
        narrationPreviewRef.current = null;
        setNarrationPreview(null);
      }
      return;
    }
    if (narrationPreviewRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const stream = await requestCameraStream({ video: true, audio: false });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        narrationPreviewRef.current = stream;
        setNarrationPreview(stream);
      } catch {
        // Denied / no camera: the recorder surfaces its own error at start();
        // until then the mic meter fallback still renders.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [narrationPreviewWanted]);
  useEffect(() => {
    return () => {
      const existing = narrationPreviewRef.current;
      if (existing) for (const track of existing.getTracks()) track.stop();
    };
  }, []);

  // "Start preview" in narration mode = turn the mic analysis on (permission
  // prompt + level meter); the camera-preview effect above follows suit when
  // the Camera toggle is armed. Recording proper starts via the Record button.
  const handleNarrationPreview = useCallback(async () => {
    setNarrationRequesting(true);
    try {
      const controller = stageRef.current.controller;
      await controller.mic.start(controller.prefs.micDeviceId);
    } finally {
      setNarrationRequesting(false);
    }
  }, []);

  const handleNarrationRecord = useCallback(() => {
    void stageRef.current.recorder.start();
  }, []);

  const narrationCameraStream = narrationOn
    ? (stage.recorder.cameraStream ?? narrationPreview)
    : null;
  useStreamPreview(
    previewRef,
    narrationOn ? narrationCameraStream : recorder.state === 'stopped' ? null : recorder.stream,
  );
  // The dual-take camera thumbnail (mirrors where the PiP bubble will land).
  // Only live before stop; the review players read the recorded blobs instead.
  useStreamPreview(
    cameraPreviewRef,
    !narrationOn && isDual && recorder.state !== 'stopped'
      ? (recorder.camera?.stream ?? null)
      : null,
  );

  // Generate (and later revoke) a blob URL for the recorded clip so the
  // playback element has something to point at. The dependency on the
  // blob identity means a new URL is created every time a fresh
  // recording lands, and the cleanup callback revokes the previous one.
  useEffect(() => {
    setPlaybackPositionMs(0);
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

  // Sibling blob URL for the dual-take camera file, auditioned in review.
  const cameraBlob = recorder.camera?.blob ?? null;
  useEffect(() => {
    if (!cameraBlob) {
      setCameraPlaybackUrl(null);
      return;
    }
    const url = URL.createObjectURL(cameraBlob);
    setCameraPlaybackUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [cameraBlob]);

  // Switching capture config mid-session: tear down whatever stream/
  // recorder we had so the new mode acquires a fresh one. We key on a
  // signature of everything that changes the acquired stream — including
  // the camera microphone and screen system-audio flags, which don't
  // change `source` on their own. The hook handles its own teardown on
  // unmount; cancel() here covers in-place changes.
  const captureKey = `${source}:${cameraOn ? micOn : ''}:${includeSystemAudio}`;
  const previousKeyRef = useRef(captureKey);
  // Retry-safe record of which dual files have already been written this save,
  // so a second `addMedia` that fails doesn't re-upload (and orphan) the first.
  const dualSaveProgressRef = useRef<{ screenPath?: string; cameraPath?: string }>({});
  useEffect(() => {
    if (previousKeyRef.current !== captureKey) {
      previousKeyRef.current = captureKey;
      dualSaveProgressRef.current = {};
      recorder.cancel();
    }
  }, [captureKey, recorder]);

  // Make sure tearing down the modal always releases the camera /
  // screen-capture indicator. The hook's own unmount effect handles
  // this, but we also kill the stream eagerly on close so a slow
  // unmount doesn't leave the indicator lit between renders. A narration
  // take in flight (or unsaved in review) must be confirmed away first —
  // unmounting mid-take silently drops it.
  const handleClose = useCallback(() => {
    const s = stageRef.current;
    if (closeNeedsConfirm(narrationOn, s.recorder.state, s.recorder.take !== null)) {
      if (!window.confirm('Discard the current narration take?')) return;
      s.handleDiscard();
    }
    if (narrationOn) {
      s.controller.pause();
      if (s.controller.mic.status === 'live' || s.controller.mic.status === 'starting') {
        s.controller.mic.stop();
      }
    }
    recorder.cancel();
    onClose();
  }, [narrationOn, recorder, onClose]);
  useModalDialog({
    rootRef: overlayRef,
    dialogRef,
    onClose: handleClose,
    closeOnEscape: escapeClosesDialog(
      narrationOn,
      stage.recorder.state,
      stage.controller.transport,
    ),
  });

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
    dualSaveProgressRef.current = {};
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

    // Dual (screen + camera): two files, retry-safe via the progress ref, then
    // one save-result carrying both paths + the measured skew for PiP timing.
    if (isDual) {
      const cam = recorder.camera;
      if (!cam?.blob || !cam.mimeType || !cam.extension) {
        setSaveError('Nothing to save yet — record something first.');
        return;
      }
      setIsSaving(true);
      setSaveError(null);
      try {
        const seeds = dualFilenameSeeds(
          recorder.stream,
          cam.stream,
          screenOn && includeSystemAudio,
          micOn,
        );
        const trimmed = basename.trim();
        const screenFilename = buildFilename(
          'video',
          recorder.extension,
          trimmed ? `${trimmed}-screen` : undefined,
          seeds.screen,
        );
        const cameraFilename = buildFilename(
          'video',
          cam.extension,
          trimmed ? `${trimmed}-camera` : undefined,
          seeds.camera,
        );
        const progress = dualSaveProgressRef.current;
        const screenPath =
          progress.screenPath ??
          (await mediaProvider.addMedia(
            `${recorder.directory}/${screenFilename}`,
            recorder.blob,
            recorder.mimeType,
          ));
        progress.screenPath = screenPath;
        const cameraPath =
          progress.cameraPath ??
          (await mediaProvider.addMedia(
            `${recorder.directory}/${cameraFilename}`,
            cam.blob,
            cam.mimeType,
          ));
        progress.cameraPath = cameraPath;

        const duration = recorder.durationMs / 1000;
        const offsetSec = recorder.cameraOffsetSec ?? 0;
        const result: RecorderSaveResult = {
          relativePath: screenPath,
          filename: screenFilename,
          source,
          mimeType: recorder.mimeType,
          duration,
          hasTimingSidecar: false,
          camera: {
            relativePath: cameraPath,
            filename: cameraFilename,
            mimeType: cam.mimeType,
            duration: Math.max(0, duration - offsetSec),
            offsetSec,
          },
        };
        dualSaveProgressRef.current = {};
        onSave?.(result);
        handleClose();
      } catch (err: unknown) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save recording');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const filename = buildFilename(
        source === 'mic' ? 'audio' : 'video',
        recorder.extension,
        basename,
        filenameSeed,
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
  }, [
    recorder,
    source,
    isDual,
    micOn,
    screenOn,
    includeSystemAudio,
    basename,
    filenameSeed,
    sourceText,
    mediaProvider,
    container,
    onSave,
    handleClose,
  ]);

  const handleDiscard = useCallback(() => {
    dualSaveProgressRef.current = {};
    recorder.reset();
  }, [recorder]);

  const handlePlaybackTimeUpdate = useCallback(
    (media: HTMLMediaElement) => {
      const currentMs = Number.isFinite(media.currentTime) ? media.currentTime * 1000 : 0;
      setPlaybackPositionMs(Math.min(recorder.durationMs, Math.max(0, currentMs)));
    },
    [recorder.durationMs],
  );

  const isAudioOnly = source === 'mic';
  const showPreview = recorder.state !== 'idle' && recorder.state !== 'error';
  const canRecord = recorder.state === 'ready';
  const canStop = recorder.state === 'recording';
  const canSave = recorder.state === 'stopped' && recorder.blob !== null;
  const isBusy = recorder.state === 'requesting' || recorder.state === 'stopping' || isSaving;

  // Toggles lock while a stream is live (acquiring or recording) — changing
  // the capture config then would tear down the in-progress take.
  //
  // They also lock in review while an UNSAVED take is in hand: flipping any
  // source rewrites `captureKey`, and that effect calls `recorder.cancel()`,
  // which drops the blob. Silently destroying a recording the user has not
  // saved is unrecoverable, so reconfiguring goes through the explicit
  // "Discard & re-record" button (already the affordance in this state),
  // which clears the take and re-enables these toggles.
  const togglesLocked =
    recorder.state === 'recording' || recorder.state === 'requesting' || canSave;
  const toggleLockReason = canSave
    ? 'Save or discard this recording before changing sources'
    : undefined;
  // The non-narration capture pills. System audio depends on Screen being on
  // (it can only be captured as part of a display capture) and is filtered out
  // entirely when the platform can't honor it. Camera and Screen are no longer
  // mutually exclusive — both on = `'screen+camera'` dual capture.
  const simpleToggleProps = (key: ToggleKey) => {
    const active =
      key === 'mic'
        ? micOn
        : key === 'camera'
          ? cameraOn
          : key === 'screen'
            ? screenOn
            : includeSystemAudio;
    if (key === 'systemAudio') {
      return {
        active,
        disabled: togglesLocked || !screenOn,
        title: togglesLocked
          ? toggleLockReason
          : screenOn
            ? 'Capture tab or system audio with the screen recording'
            : 'Turn on Screen to capture system audio',
        onClick: () => setIncludeSystemAudio((on) => !on),
      };
    }
    return {
      active,
      disabled: togglesLocked,
      title: toggleLockReason,
      onClick: () => {
        if (key === 'mic') setMicOn((on) => !on);
        else if (key === 'camera') setCameraOn((on) => !on);
        else setScreenOn((on) => !on);
      },
    };
  };

  // Narration-mode remaps of the same three toggles: mic is always on (the
  // analysis stream IS the recording), Camera drives the narration recorder's
  // separate camera track, Screen has no narration equivalent.
  const narrationRecorderIdle = narrationQuiescent(stage.recorder.state);
  // A take exists (or is being aligned/saved): the preview box reports it
  // instead of hinting about camera/mic startup.
  const narrationTakeDone =
    stage.recorder.state === 'processing' ||
    stage.recorder.state === 'review' ||
    stage.recorder.state === 'saving';
  const narrationToggleDisabled = narrationToggleLocked(
    recorder.state,
    recorder.blob !== null || recorder.camera?.blob != null,
    stage.recorder.state,
  );
  const narrationToggleFor = (key: ToggleKey) => {
    switch (key) {
      case 'mic':
        return {
          active: true,
          disabled: true,
          title: 'Narration always records your microphone',
          onClick: () => {},
        };
      case 'camera':
        return {
          active: stage.recorder.withCamera,
          disabled: !narrationRecorderIdle,
          title: 'Also capture your camera as a separate video file',
          onClick: () => stage.recorder.setWithCamera(!stage.recorder.withCamera),
        };
      case 'screen':
        return {
          active: false,
          disabled: true,
          title: "Screen capture isn't available in narration mode — uncheck Show narration mode",
          onClick: () => {},
        };
      case 'systemAudio':
        return {
          active: false,
          disabled: true,
          title: "System audio isn't available in narration mode",
          onClick: () => {},
        };
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
        data-narration={narrationOn ? 'true' : undefined}
        style={{
          ...(narrationOn ? modalExpandedStyle : modalStyle),
          ...recorderThemeStyle(colorScheme),
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <h2 id={headingId} style={titleStyle}>
          Record media
        </h2>

        <div style={narrationOn ? bodyRowStyle : undefined}>
          <div style={narrationOn ? leftColStyle : undefined}>
            <div style={toggleRowStyle} role="group" aria-label="Capture sources">
              {TOGGLE_GROUPS.map((group, groupIndex) => (
                <Fragment key={group.label}>
                  {groupIndex > 0 && <div aria-hidden="true" style={groupDividerStyle} />}
                  <div style={toggleGroupStyle}>
                    {group.toggles.map((t) => {
                      // System audio has no meaning without a display capture,
                      // and no platform outside desktop Chromium offers it.
                      if (t.key === 'systemAudio' && !canIncludeSystemAudio) return null;
                      const props = narrationOn
                        ? narrationToggleFor(t.key)
                        : simpleToggleProps(t.key);
                      return (
                        <button
                          key={t.key}
                          type="button"
                          aria-pressed={props.active}
                          style={props.active ? toggleActive : toggleBase}
                          onClick={props.onClick}
                          disabled={props.disabled}
                          title={props.title}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </Fragment>
              ))}
            </div>

            <p style={summaryStyle}>
              {narrationOn
                ? narrationCaptureSummary(stage.recorder.withCamera)
                : captureSummary(micOn, cameraOn, screenOn)}
            </p>

            {narrationAvailable && (
              <label style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  style={{ accentColor: 'var(--squisq-recorder-accent)' }}
                  checked={narrationOn}
                  onChange={(e) => setNarrationOn(e.target.checked)}
                  disabled={narrationToggleDisabled}
                  title={
                    narrationToggleDisabled
                      ? narrationOn
                        ? 'Finish or discard the narration take first'
                        : 'Save or discard this recording before switching modes'
                      : undefined
                  }
                />
                Show narration mode
              </label>
            )}

            {!narrationOn && recorder.error && (
              <div style={errorStyle}>{recorder.error.message}</div>
            )}
            {!narrationOn && saveError && <div style={errorStyle}>{saveError}</div>}
            {narrationOn && (stage.recorder.error ?? stage.controller.mic.error) && (
              <div style={errorStyle}>
                {(stage.recorder.error ?? stage.controller.mic.error)?.message}
              </div>
            )}

            {/* Narration-mode preview: the live camera (dialog preview stream
            before the take, recorder stream during it), a recorded-take
            status after stopping, a hint while the camera is armed but not
            yet previewing, or a mic meter. */}
            {narrationOn && narrationCameraStream && (
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
            {narrationOn && !narrationCameraStream && narrationTakeDone && (
              <div style={audioMeterStyle}>
                {stage.recorder.take
                  ? `✓ Recorded ${formatDurationMs(stage.recorder.take.durationSec * 1000)}`
                  : '● Processing take…'}
              </div>
            )}
            {narrationOn &&
              !narrationCameraStream &&
              !narrationTakeDone &&
              stage.recorder.withCamera && (
                <div style={previewBoxStyle}>
                  <span>
                    {narrationPreviewWanted
                      ? 'Camera starting…'
                      : 'Click Start preview to turn on your camera.'}
                  </span>
                </div>
              )}
            {narrationOn &&
              !narrationCameraStream &&
              !narrationTakeDone &&
              !stage.recorder.withCamera && (
                <div style={{ ...audioMeterStyle, position: 'relative', overflow: 'hidden' }}>
                  <div
                    aria-hidden="true"
                    style={{
                      ...meterLevelStyle,
                      width: `${Math.round(Math.min(1, Math.max(0, stage.controller.micLevel)) * 100)}%`,
                    }}
                  />
                  <span style={{ position: 'relative' }}>
                    {stage.recorder.state === 'recording'
                      ? '● Recording narration'
                      : narrationMicLive
                        ? stage.controller.voiceActive
                          ? 'Voice detected'
                          : 'Microphone ready'
                        : 'Click Start preview to check your mic.'}
                  </span>
                </div>
              )}

            {/* Preview surface. Three modes:
            - Pre-acquisition (idle / error): a static prompt.
            - Live (ready / recording / requesting / stopping): the stream
              piped into a muted <video>, or a recording meter for mic.
            - Playback (stopped): the captured blob bound to a <video>/<audio>
              with native controls so the user can audition before saving.
          */}
            {!narrationOn && !showPreview && (
              <div style={previewBoxStyle}>
                <span>Click Start Preview to start a recording.</span>
              </div>
            )}
            {!narrationOn && showPreview && recorder.state !== 'stopped' && !isAudioOnly && (
              <div style={isDual ? { ...previewBoxStyle, position: 'relative' } : previewBoxStyle}>
                <video
                  ref={previewRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                {isDual && (
                  <video
                    ref={cameraPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    aria-label="Camera preview"
                    style={{
                      position: 'absolute',
                      right: '3%',
                      bottom: '6%',
                      width: '22%',
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      background: '#000',
                      border: '1px solid rgba(255,255,255,0.6)',
                    }}
                  />
                )}
              </div>
            )}
            {!narrationOn && showPreview && recorder.state !== 'stopped' && isAudioOnly && (
              <div style={audioMeterStyle}>
                {recorder.state === 'recording' ? (
                  <>● Recording {formatDurationMs(recorder.durationMs)}</>
                ) : (
                  <>Microphone ready</>
                )}
              </div>
            )}
            {!narrationOn && recorder.state === 'stopped' && playbackUrl && !isAudioOnly && (
              <div style={{ ...previewBoxStyle, position: 'relative' }}>
                <video
                  src={playbackUrl}
                  controls
                  playsInline
                  onTimeUpdate={(event) => handlePlaybackTimeUpdate(event.currentTarget)}
                  onSeeking={(event) => handlePlaybackTimeUpdate(event.currentTarget)}
                  onEnded={() => setPlaybackPositionMs(recorder.durationMs)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                <div
                  role="timer"
                  aria-label={`Playback time: ${formatDurationMs(playbackPositionMs)} of ${formatDurationMs(recorder.durationMs)}`}
                  style={playbackTimeStyle}
                >
                  {formatDurationMs(playbackPositionMs)} / {formatDurationMs(recorder.durationMs)}
                </div>
              </div>
            )}
            {!narrationOn &&
              recorder.state === 'stopped' &&
              isDual &&
              cameraPlaybackUrl && (
                <div style={{ marginBottom: 12 }}>
                  <div style={summaryStyle}>Camera (picture-in-picture)</div>
                  <video
                    src={cameraPlaybackUrl}
                    controls
                    playsInline
                    aria-label="Camera recording"
                    style={{
                      width: '48%',
                      display: 'block',
                      marginLeft: 'auto',
                      background: '#000',
                    }}
                  />
                </div>
              )}
            {!narrationOn && recorder.state === 'stopped' && playbackUrl && isAudioOnly && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ ...audioMeterStyle, marginBottom: 8 }}>
                  ✓ Recorded {formatDurationMs(recorder.durationMs)}
                </div>
                <audio src={playbackUrl} controls style={{ width: '100%' }} />
              </div>
            )}

            {/* Mode-specific fields. Narration mode prompts from the document, so
            the free-text script is hidden. */}
            {!narrationOn && source === 'mic' && (
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
            <label style={labelStyle} htmlFor="recorder-basename">
              Filename (optional)
            </label>
            <input
              id="recorder-basename"
              type="text"
              style={inputStyle}
              placeholder={narrationOn ? 'narration' : isDual ? 'screen + camera' : filenameSeed}
              value={basename}
              onChange={(e) => setBasename(e.target.value)}
              disabled={narrationOn ? !narrationRecorderIdle : recorder.state === 'recording'}
            />

            {/* Live duration during recording */}
            {!narrationOn && recorder.state === 'recording' && !isAudioOnly && (
              <div style={recordingStatusStyle}>
                ● Recording {formatDurationMs(recorder.durationMs)}
              </div>
            )}

            {/* Action buttons. Layout depends on state. Narration mode keeps
            the classic Start preview → Record flow here as the source of
            truth (recording start = prompter start); review save/retake/
            discard live in the stage's review bar on the right. */}
            <div style={buttonRowStyle}>
              <button
                type="button"
                style={btnSecondary}
                onClick={handleClose}
                disabled={!narrationOn && isBusy}
              >
                Close
              </button>

              {narrationOn && (
                <>
                  {narrationRecorderIdle && !narrationMicLive && (
                    <button
                      type="button"
                      style={btnPrimary}
                      onClick={() => void handleNarrationPreview()}
                      disabled={narrationRequesting}
                    >
                      {narrationRequesting ? 'Requesting…' : 'Start preview'}
                    </button>
                  )}
                  {narrationRecorderIdle && narrationMicLive && (
                    <button type="button" style={btnRecord} onClick={handleNarrationRecord}>
                      <span
                        className="squisq-recorder-record-dot"
                        style={recordDotFrameStyle}
                        aria-hidden="true"
                      >
                        <span
                          className="squisq-recorder-record-dot-center"
                          style={recordDotStyle}
                        />
                      </span>
                      Record
                    </button>
                  )}
                  {(stage.recorder.state === 'recording' ||
                    stage.recorder.state === 'starting') && (
                    <button
                      type="button"
                      style={btnDanger}
                      onClick={() => void stage.recorder.stop()}
                    >
                      Stop
                    </button>
                  )}
                  {stage.recorder.state === 'processing' && (
                    <span style={recordingStatusStyle}>Aligning take…</span>
                  )}
                  {stage.recorder.state === 'saving' && (
                    <span style={recordingStatusStyle}>Saving…</span>
                  )}
                  {stage.recorder.state === 'review' && stage.recorder.take && (
                    <>
                      <button type="button" style={btnSecondary} onClick={stage.handleRetake}>
                        Discard & re-record
                      </button>
                      <button
                        type="button"
                        style={btnPrimary}
                        onClick={() => void stage.handleSave()}
                      >
                        Save to document
                      </button>
                    </>
                  )}
                </>
              )}

              {!narrationOn && (
                <>
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
                    <button type="button" style={btnRecord} onClick={handleStart} disabled={isBusy}>
                      <span
                        className="squisq-recorder-record-dot"
                        style={recordDotFrameStyle}
                        aria-hidden="true"
                      >
                        <span
                          className="squisq-recorder-record-dot-center"
                          style={recordDotStyle}
                        />
                      </span>
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
                      <button
                        type="button"
                        style={btnSecondary}
                        onClick={handleDiscard}
                        disabled={isBusy}
                      >
                        Discard & re-record
                      </button>
                      <button
                        type="button"
                        style={btnPrimary}
                        onClick={handleSave}
                        disabled={isBusy}
                      >
                        {isSaving ? 'Saving…' : 'Save to document'}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {narrationOn && narration && (
            <div style={rightColStyle}>
              <NarrationStage
                stage={stage}
                theme={narration.theme}
                showSelfView={false}
                showCameraToggleInRecordSlot={false}
                showRecordSlot={false}
                showTransportPlay={false}
                showReviewActions={false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
