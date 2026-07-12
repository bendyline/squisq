/**
 * TeleprompterView — the Narrate display-mode root mounted by
 * PreviewPanel. Owns the controller (single source of truth in the main
 * window) and the floating-window handle; renders the surface docked,
 * portals it into a Document-PiP/popup window, or pumps the canvas
 * rendition for the Safari video-PiP tier.
 *
 * Recording (scenario 1) is prop-gated: PreviewPanel passes
 * `recording` deps (media provider + markdown writers) when the host
 * allows it; without them this is a pure prompter (scenario 2) with
 * zero capture code paths.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Doc, MediaProvider, Theme } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { wordIndexAtTime } from '@bendyline/squisq/narration';
import { useTeleprompter } from './useTeleprompter';
import { useFloatingWindow } from './useFloatingWindow';
import { TeleprompterSurface } from './TeleprompterSurface';
import { TeleprompterControls } from './TeleprompterControls';
import { TeleprompterSelfView } from './TeleprompterSelfView';
import { drawPrompterFrame, type CanvasPrompterFrame } from './canvasRenderer';
import { ensureTeleprompterStyles, TELEPROMPTER_CSS } from './teleprompterTheme';
import { useNarrationRecorder } from './recording/useNarrationRecorder';
import { buildNarrationSavePlan, executeNarrationSave } from './recording/narrationSave';

/** Editor plumbing the recording flow needs; omit for prompter-only use. */
export interface TeleprompterRecordingDeps {
  mediaProvider: MediaProvider;
  container: ContentContainer | null;
  markdownSource: string;
  setMarkdownSource: (next: string) => void;
  bumpMediaRevision: () => void;
}

export interface TeleprompterViewProps {
  doc: Doc | null;
  theme: Theme;
  /** Kept for API symmetry with PreviewPanel; recording uses `recording.container`. */
  workspaceContainer?: ContentContainer | null;
  /** Media base path (reserved for future preview integrations). */
  basePath?: string;
  /**
   * Optional audience-window portal owned by the editor's Presentation mode.
   * The main controller remains authoritative; only this live surface is
   * mirrored into the target.
   */
  presentationTarget?: HTMLElement | null;
  /** Recording deps; null/omitted disables the Record affordance. */
  recording?: TeleprompterRecordingDeps | null;
}

export function TeleprompterView(props: TeleprompterViewProps) {
  const { doc, theme, presentationTarget = null, recording = null } = props;
  const controller = useTeleprompter({ doc });
  const float = useFloatingWindow(TELEPROMPTER_CSS);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const recorder = useNarrationRecorder({
    mic: controller.mic,
    getScript: () => controllerRef.current.script,
    getWordPos: () => controllerRef.current.wordPos,
    getMicDeviceId: () => controllerRef.current.prefs.micDeviceId,
    onRecordingStart: () => controllerRef.current.play(),
    onRecordingStop: () => controllerRef.current.pause(),
  });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  // The docked chrome (controls, float note) also uses prompter classes.
  useEffect(() => {
    const ownerDoc = rootRef.current?.ownerDocument;
    if (ownerDoc) ensureTeleprompterStyles(ownerDoc);
  }, []);

  useEffect(() => {
    if (presentationTarget) ensureTeleprompterStyles(presentationTarget.ownerDocument);
  }, [presentationTarget]);

  // ── Video-PiP pump: draw on analysis ticks, never rAF ──────────────
  const canvasFrameRef = useRef<Omit<CanvasPrompterFrame, 'wordPos'> | null>(null);
  canvasFrameRef.current = controller.script
    ? {
        script: controller.script,
        fontSizePx: controller.prefs.fontSizePx,
        mirrored: controller.prefs.mirrored,
        colors: {
          bg: theme.colors.background,
          text: theme.colors.text,
          accent: theme.colors.primary,
          muted: theme.colors.textMuted ?? theme.colors.text,
        },
        countdownRemaining: controller.countdownRemaining,
        recording: recorder.state === 'recording',
      }
    : null;

  useEffect(() => {
    const sink = float.canvasSink;
    if (float.tier !== 'video-pip' || !sink) return;
    const draw = (wordPos: number) => {
      const config = canvasFrameRef.current;
      if (!config) return;
      drawPrompterFrame(sink.canvas, { ...config, wordPos });
      sink.requestFrame();
    };
    draw(controllerRef.current.wordPos);
    const unsubscribe = controllerRef.current.subscribeTick(draw);
    // Manual mode has no analysis ticks; a coarse interval keeps the PiP
    // moving (best-effort under occlusion — voice mode is the robust path).
    const interval = setInterval(() => draw(controllerRef.current.wordPos), 200);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [float.tier, float.canvasSink]);

  // ── Review playback: the prompter re-scrolls along the aligned take ──
  const reviewAudioUrl = useMemo(
    () => (recorder.take ? URL.createObjectURL(recorder.take.audioBlob) : null),
    [recorder.take],
  );
  useEffect(() => {
    return () => {
      if (reviewAudioUrl) URL.revokeObjectURL(reviewAudioUrl);
    };
  }, [reviewAudioUrl]);

  const handleReviewTimeUpdate = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    const alignment = recorderRef.current.take?.alignment;
    if (!alignment || alignment.words.length === 0) return;
    controllerRef.current.seekToToken(
      wordIndexAtTime(alignment.words, event.currentTarget.currentTime),
    );
  }, []);

  const handleSave = useCallback(async () => {
    const take = recorderRef.current.take;
    if (!take || !recording) return;
    recorderRef.current.beginSave();
    try {
      const plan = buildNarrationSavePlan({
        script: take.script,
        alignment: take.alignment,
        durationSec: take.durationSec,
        audioExt: take.audioExt,
        cameraExt: take.cameraExt,
        baseWpm: controllerRef.current.prefs.baseWpm,
        ...(take.cameraOffsetSec !== undefined ? { cameraOffsetSec: take.cameraOffsetSec } : {}),
      });
      const result = await executeNarrationSave(plan, take, {
        mediaProvider: recording.mediaProvider,
        container: recording.container,
        markdownSource: recording.markdownSource,
        setMarkdownSource: recording.setMarkdownSource,
        bumpMediaRevision: recording.bumpMediaRevision,
      });
      recorderRef.current.finishSave(true);
      setSaveNotice(
        `Saved ${result.audioPath}${take.alignment ? ' — blocks re-timed to your voice' : ''}`,
      );
    } catch (err: unknown) {
      recorderRef.current.finishSave(false, err instanceof Error ? err : new Error(String(err)));
    }
  }, [recording]);

  const surfaceProps = useMemo(
    () => ({
      wordPos: controller.wordPos,
      fontSizePx: controller.prefs.fontSizePx,
      mirrored: controller.prefs.mirrored,
      lineGuide: controller.prefs.lineGuide,
      countdownRemaining: controller.countdownRemaining,
      recordingIndicator: recorder.state === 'recording',
      theme,
      onSeekToken: controller.seekToToken,
    }),
    [
      controller.wordPos,
      controller.prefs.fontSizePx,
      controller.prefs.mirrored,
      controller.prefs.lineGuide,
      controller.countdownRemaining,
      controller.seekToToken,
      recorder.state,
      theme,
    ],
  );

  if (!controller.script) {
    return (
      <>
        <div ref={rootRef} className="squisq-teleprompter-root" data-testid="teleprompter-view">
          <div className="squisq-teleprompter-float-note">
            <p>Nothing to narrate yet — add some content to the document.</p>
          </div>
        </div>
        {presentationTarget
          ? createPortal(
              <div className="squisq-presentation-teleprompter" aria-label="Audience presentation">
                <div className="squisq-teleprompter-float-note">
                  <p>Nothing to narrate yet — add some content to the document.</p>
                </div>
              </div>,
              presentationTarget,
            )
          : null}
      </>
    );
  }

  const script = controller.script;
  const portalOpen = float.portalTarget !== null;
  const busyRecording = recorder.state === 'recording' || recorder.state === 'starting';

  const recordSlot = recording ? (
    <span className="squisq-teleprompter-group" data-testid="teleprompter-record">
      {recorder.state === 'idle' || recorder.state === 'error' ? (
        <>
          <button
            type="button"
            onClick={() => void recorder.start()}
            title="Record narration while you read"
          >
            ⏺ Record
          </button>
          <label title="Also capture your camera as a separate video file">
            <input
              type="checkbox"
              checked={recorder.withCamera}
              onChange={(e) => recorder.setWithCamera(e.target.checked)}
            />
            camera
          </label>
          {recorder.state === 'error' ? (
            <span title={recorder.error?.message}>⚠ {recorder.error?.message}</span>
          ) : null}
        </>
      ) : busyRecording ? (
        <button type="button" onClick={() => void recorder.stop()}>
          ⏹ Stop
        </button>
      ) : recorder.state === 'processing' ? (
        <span>Aligning take…</span>
      ) : recorder.state === 'saving' ? (
        <span>Saving…</span>
      ) : null}
    </span>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="squisq-teleprompter-root"
      data-testid="teleprompter-view"
      tabIndex={0}
      onKeyDown={controller.handleKeyDown}
    >
      <div className="squisq-teleprompter-stage">
        {portalOpen ? (
          <div className="squisq-teleprompter-float-note">
            <p>The prompter is floating in its own window.</p>
            <button type="button" onClick={float.close}>
              ⇤ Bring it back
            </button>
          </div>
        ) : (
          <TeleprompterSurface key="docked" script={script} {...surfaceProps} />
        )}
        {portalOpen && float.portalTarget
          ? createPortal(
              <TeleprompterSurface
                key={`float-${float.tier}`}
                script={script}
                {...surfaceProps}
                compact
              />,
              float.portalTarget,
            )
          : null}
        {presentationTarget
          ? createPortal(
              <div className="squisq-presentation-teleprompter" aria-label="Audience presentation">
                <TeleprompterSurface
                  key="presentation-audience"
                  script={script}
                  {...surfaceProps}
                />
              </div>,
              presentationTarget,
            )
          : null}
        <TeleprompterSelfView stream={recorder.cameraStream} />
      </div>

      {recorder.state === 'review' && recorder.take ? (
        <div className="squisq-teleprompter-review" data-testid="teleprompter-review">
          <span>
            Take: {recorder.take.durationSec.toFixed(1)}s
            {recorder.take.alignment
              ? ` · ${recorder.take.alignment.detectedSyllables} syllables aligned`
              : ' · timing unavailable (saved without re-timing)'}
          </span>
          {reviewAudioUrl ? (
            <audio controls src={reviewAudioUrl} onTimeUpdate={handleReviewTimeUpdate} />
          ) : null}
          <button type="button" onClick={() => void handleSave()}>
            ✓ Save narration
          </button>
          <button type="button" onClick={recorder.retake}>
            ↺ Retake
          </button>
          <button type="button" onClick={recorder.discard}>
            ✕ Discard
          </button>
          {recorder.error ? <span>⚠ {recorder.error.message}</span> : null}
        </div>
      ) : null}
      {saveNotice ? (
        <div className="squisq-teleprompter-review" data-testid="teleprompter-save-notice">
          <span>{saveNotice}</span>
          <button type="button" onClick={() => setSaveNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <TeleprompterControls controller={controller} float={float} recordSlot={recordSlot} />
    </div>
  );
}
