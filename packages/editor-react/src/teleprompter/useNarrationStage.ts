/**
 * useNarrationStage — the state/orchestration half of the narration stage,
 * extracted from TeleprompterView so other hosts (the Record media dialog)
 * can mount the same prompter + recorder + save pipeline.
 *
 * Owns the teleprompter controller (single source of truth in the main
 * window), the floating-window handle, the narration recorder, and the
 * retry-idempotent save flow. Pair with <NarrationStage> for the DOM.
 *
 * Recording is prop-gated: pass `recording` deps (media provider + markdown
 * writers) to enable capture; without them this is a pure prompter with zero
 * capture code paths.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { wordIndexAtTime } from '@bendyline/squisq/narration';
import { useTeleprompter, type TeleprompterController } from './useTeleprompter';
import { useFloatingWindow, type FloatingWindowHandle } from './useFloatingWindow';
import { TELEPROMPTER_CSS } from './teleprompterTheme';
import {
  useNarrationRecorder,
  type NarrationMediaRecorderOptions,
  type NarrationRecorderController,
} from './recording/useNarrationRecorder';
import {
  buildNarrationSavePlan,
  discardNarrationSaveProgress,
  executeNarrationSave,
  type NarrationSaveProgress,
} from './recording/narrationSave';

/** Editor plumbing the recording flow needs; omit for prompter-only use. */
export interface TeleprompterRecordingDeps {
  mediaProvider: MediaProvider;
  container: ContentContainer | null;
  markdownSource: string;
  setMarkdownSource: (next: string) => void;
  bumpMediaRevision: () => void;
}

export interface UseNarrationStageOptions {
  doc: Doc | null;
  /** Recording deps; null/omitted disables the Record affordance. */
  recording?: TeleprompterRecordingDeps | null;
  /** Optional user-chosen filename base threaded into the save plan. */
  getAudioBasename?: () => string | undefined;
  /** Microphone constraints shared by voice analysis and audio recording. */
  micConstraints?: MediaTrackConstraints;
  /** Constraints for the optional narration camera lane. */
  cameraConstraints?: MediaTrackConstraints;
  /** MediaRecorder hints for the narration audio file. */
  audioRecorderOptions?: NarrationMediaRecorderOptions;
  /** MediaRecorder hints for the optional narration camera file. */
  cameraRecorderOptions?: NarrationMediaRecorderOptions;
}

export interface NarrationStageHandle {
  controller: TeleprompterController;
  float: FloatingWindowHandle;
  recorder: NarrationRecorderController;
  /** Pass-through so the stage component can gate its record slot. */
  recording: TeleprompterRecordingDeps | null;
  saveNotice: string | null;
  dismissSaveNotice: () => void;
  handleSave: () => Promise<void>;
  handleRetake: () => void;
  handleDiscard: () => void;
  reviewAudioUrl: string | null;
  handleReviewTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => void;
}

export function useNarrationStage(opts: UseNarrationStageOptions): NarrationStageHandle {
  const { doc, recording = null, getAudioBasename } = opts;
  const controller = useTeleprompter({ doc, micConstraints: opts.micConstraints });
  const float = useFloatingWindow(TELEPROMPTER_CSS);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const recorder = useNarrationRecorder({
    mic: controller.mic,
    getScript: () => controllerRef.current.script,
    getWordPos: () => controllerRef.current.wordPos,
    getMicDeviceId: () => controllerRef.current.prefs.micDeviceId,
    cameraConstraints: opts.cameraConstraints,
    audioRecorderOptions: opts.audioRecorderOptions,
    cameraRecorderOptions: opts.cameraRecorderOptions,
    onRecordingStart: () => controllerRef.current.play(),
    onRecordingStop: () => controllerRef.current.pause(),
  });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  // `recording` is re-created every render (it carries the live markdown
  // source), but handleSave's closure freezes whatever it saw at click time.
  // Read through the ref so the preamble composes from the CURRENT source
  // rather than a snapshot taken before the awaited media writes.
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  const getAudioBasenameRef = useRef(getAudioBasename);
  getAudioBasenameRef.current = getAudioBasename;

  // What THIS take's save attempts have already committed. A retry resumes
  // from here instead of writing a second timestamped audio file; a
  // retake/discard cleans the orphans up. Keyed by take identity so a new
  // recording never inherits the previous take's artifacts.
  const saveProgressRef = useRef<{ take: unknown; progress: NarrationSaveProgress } | null>(null);

  const progressForTake = useCallback((take: unknown): NarrationSaveProgress => {
    const existing = saveProgressRef.current;
    if (existing && existing.take === take) return existing.progress;
    const fresh = { take, progress: {} };
    saveProgressRef.current = fresh;
    return fresh.progress;
  }, []);

  /** Drop any half-written artifacts for the take being abandoned. */
  const cleanupAbandonedSave = useCallback(() => {
    const pending = saveProgressRef.current;
    saveProgressRef.current = null;
    const deps = recordingRef.current;
    if (!pending || !deps) return;
    if (pending.progress.audioPath === undefined && pending.progress.sidecarPath === undefined) {
      return;
    }
    void discardNarrationSaveProgress(pending.progress, {
      mediaProvider: deps.mediaProvider,
      container: deps.container,
    });
  }, []);

  const handleRetake = useCallback(() => {
    cleanupAbandonedSave();
    recorderRef.current.retake();
  }, [cleanupAbandonedSave]);

  const handleDiscard = useCallback(() => {
    cleanupAbandonedSave();
    recorderRef.current.discard();
  }, [cleanupAbandonedSave]);

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
      const basename = getAudioBasenameRef.current?.();
      const plan = buildNarrationSavePlan({
        script: take.script,
        alignment: take.alignment,
        durationSec: take.durationSec,
        audioExt: take.audioExt,
        cameraExt: take.cameraExt,
        baseWpm: controllerRef.current.prefs.baseWpm,
        ...(take.cameraOffsetSec !== undefined ? { cameraOffsetSec: take.cameraOffsetSec } : {}),
        ...(basename ? { audioBasename: basename } : {}),
      });
      const result = await executeNarrationSave(
        plan,
        take,
        {
          mediaProvider: recording.mediaProvider,
          container: recording.container,
          getMarkdownSource: () => recordingRef.current?.markdownSource ?? '',
          setMarkdownSource: recording.setMarkdownSource,
          bumpMediaRevision: recording.bumpMediaRevision,
        },
        progressForTake(take),
      );
      // Committed: the markdown now references these paths, so they are no
      // longer orphan candidates.
      saveProgressRef.current = null;
      recorderRef.current.finishSave(true);
      setSaveNotice(
        `Saved ${result.audioPath}${take.alignment ? ' — blocks re-timed to your voice' : ''}`,
      );
    } catch (err: unknown) {
      recorderRef.current.finishSave(false, err instanceof Error ? err : new Error(String(err)));
    }
  }, [recording, progressForTake]);

  const dismissSaveNotice = useCallback(() => setSaveNotice(null), []);

  return {
    controller,
    float,
    recorder,
    recording,
    saveNotice,
    dismissSaveNotice,
    handleSave,
    handleRetake,
    handleDiscard,
    reviewAudioUrl,
    handleReviewTimeUpdate,
  };
}
