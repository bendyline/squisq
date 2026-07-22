/**
 * NarrationStage — the presentational half of the narration stage, extracted
 * from TeleprompterView. Renders the surface docked, portals it into a
 * Document-PiP/popup window, or pumps the canvas rendition for the Safari
 * video-PiP tier; plus the review bar, save notice, record slot, and the
 * full control rail. All state arrives via the NarrationStageHandle from
 * useNarrationStage.
 *
 * Hosts: the Narrate display mode (TeleprompterView) and the Record media
 * dialog (RecorderModal, which turns off the self-view overlay and the
 * record slot's camera checkbox because its own left column provides both).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Theme } from '@bendyline/squisq/schemas';
import { TeleprompterSurface } from './TeleprompterSurface';
import { TeleprompterControls } from './TeleprompterControls';
import { TeleprompterSelfView } from './TeleprompterSelfView';
import { drawPrompterFrame, type CanvasPrompterFrame } from './canvasRenderer';
import { ensureTeleprompterStyles } from './teleprompterTheme';
import type { NarrationStageHandle } from './useNarrationStage';

export interface NarrationStageProps {
  stage: NarrationStageHandle;
  theme: Theme;
  /**
   * Optional audience-window portal owned by the editor's Presentation mode.
   * The main controller remains authoritative; only this live surface is
   * mirrored into the target.
   */
  presentationTarget?: HTMLElement | null;
  /**
   * Camera corner-overlay on the prompter. Hosts that show the camera stream
   * in their own chrome (the recorder dialog's preview box) pass false.
   */
  showSelfView?: boolean;
  /**
   * The record slot's own "camera" checkbox. Hosts whose chrome already owns
   * the camera toggle (the recorder dialog's Camera source button) pass false.
   */
  showCameraToggleInRecordSlot?: boolean;
  /**
   * The whole Record/Stop slot in the control rail. Hosts that surface their
   * own record affordance (the recorder dialog's Start preview → Record flow)
   * pass false; the review bar still renders.
   */
  showRecordSlot?: boolean;
  /**
   * The control rail's Start/Pause transport button. Hosts whose record flow
   * drives the prompter (recording start = prompter start) pass false;
   * Restart and Countdown remain.
   */
  showTransportPlay?: boolean;
  /**
   * The review bar's Save/Retake/Discard buttons. Hosts that render those in
   * their own action row (the recorder dialog) pass false; the take info and
   * the prompter-scrubbing audio playback stay.
   */
  showReviewActions?: boolean;
}

export function NarrationStage(props: NarrationStageProps) {
  const {
    stage,
    theme,
    presentationTarget = null,
    showSelfView = true,
    showCameraToggleInRecordSlot = true,
    showRecordSlot = true,
    showTransportPlay = true,
    showReviewActions = true,
  } = props;
  const { controller, float, recorder, recording } = stage;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const toggleAutoAdvance = useCallback(() => {
    const current = controllerRef.current;
    if (current.transport === 'rolling' || current.transport === 'countdown') current.pause();
    else current.play();
  }, []);

  // The docked chrome (controls, float note) also uses prompter classes.
  useEffect(() => {
    const ownerDoc = rootRef.current?.ownerDocument;
    if (ownerDoc) ensureTeleprompterStyles(ownerDoc);
  }, []);

  useEffect(() => {
    if (presentationTarget) ensureTeleprompterStyles(presentationTarget.ownerDocument);
  }, [presentationTarget]);

  // Narrate shortcuts belong to the active mode, not to DOM focus. Listen on
  // every document that can host the surface so arrows keep working after the
  // user touches ordinary toolbar/transport buttons or a floating window.
  useEffect(() => {
    if (!controller.script) return;
    const documents = new Set<Document>();
    const ownerDocument = rootRef.current?.ownerDocument;
    if (ownerDocument) documents.add(ownerDocument);
    if (float.portalTarget) documents.add(float.portalTarget.ownerDocument);
    if (presentationTarget) documents.add(presentationTarget.ownerDocument);

    const handleKeyDown = (event: KeyboardEvent) => {
      controllerRef.current.handleKeyDown(event);
    };
    for (const targetDocument of documents) {
      targetDocument.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      for (const targetDocument of documents) {
        targetDocument.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [controller.script, float.portalTarget, presentationTarget]);

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
      onNudge: controller.nudge,
      onToggleAutoAdvance: toggleAutoAdvance,
    }),
    [
      controller.wordPos,
      controller.prefs.fontSizePx,
      controller.prefs.mirrored,
      controller.prefs.lineGuide,
      controller.countdownRemaining,
      controller.seekToToken,
      controller.nudge,
      toggleAutoAdvance,
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

  const recordSlot =
    recording && showRecordSlot ? (
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
            {showCameraToggleInRecordSlot ? (
              <label title="Also capture your camera as a separate video file">
                <input
                  type="checkbox"
                  checked={recorder.withCamera}
                  onChange={(e) => recorder.setWithCamera(e.target.checked)}
                />
                camera
              </label>
            ) : null}
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
    <div ref={rootRef} className="squisq-teleprompter-root" data-testid="teleprompter-view">
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
        {showSelfView ? <TeleprompterSelfView stream={recorder.cameraStream} /> : null}
      </div>

      {recorder.state === 'review' && recorder.take ? (
        <div className="squisq-teleprompter-review" data-testid="teleprompter-review">
          <span>
            Take: {recorder.take.durationSec.toFixed(1)}s
            {recorder.take.alignment
              ? ` · ${recorder.take.alignment.detectedSyllables} syllables aligned`
              : ' · timing unavailable (saved without re-timing)'}
          </span>
          {stage.reviewAudioUrl ? (
            <audio
              controls
              src={stage.reviewAudioUrl}
              onTimeUpdate={stage.handleReviewTimeUpdate}
            />
          ) : null}
          {showReviewActions ? (
            <>
              <button type="button" onClick={() => void stage.handleSave()}>
                ✓ Save narration
              </button>
              <button type="button" onClick={stage.handleRetake}>
                ↺ Retake
              </button>
              <button type="button" onClick={stage.handleDiscard}>
                ✕ Discard
              </button>
            </>
          ) : null}
          {recorder.error ? <span>⚠ {recorder.error.message}</span> : null}
        </div>
      ) : null}
      {stage.saveNotice ? (
        <div className="squisq-teleprompter-review" data-testid="teleprompter-save-notice">
          <span>{stage.saveNotice}</span>
          <button type="button" onClick={stage.dismissSaveNotice}>
            Dismiss
          </button>
        </div>
      ) : null}

      <TeleprompterControls
        controller={controller}
        float={float}
        recordSlot={recordSlot}
        showPlayPause={showTransportPlay}
      />
    </div>
  );
}
