/**
 * Pure save-plan builder for a narration take, plus its executor.
 *
 * Follows the recorder's conventions (`RecorderModal.handleSave`):
 * audio at `audio/<narration-…>` via `MediaProvider.addMedia` (the
 * RETURNED path is authoritative — providers may rename), the timing
 * sidecar at `<audio>.timing.json` via `container.writeFile` (falling
 * back to `addMedia` with a warning), and ONE `setMarkdownSource` write
 * composing every markdown edit from a single snapshot (the single-write
 * rule — successive writes each derive from stale source and clobber
 * each other).
 *
 * Block timings deliberately do NOT get baked into heading `duration=`
 * pins: pins outrank narration in `applyNarrationTiming`, so baking
 * them would shadow every retake. The sidecar owns the timing.
 */

import {
  buildNarrationTimingJson,
  type NarrationAlignment,
  type NarrationScript,
  type NarrationTimingJsonV3,
} from '@bendyline/squisq/narration';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { buildFilename } from '../../recorder/formats';
import { encodeTimingJson, timingPathFor } from '../../recorder/timingJson';
import { insertNarrationPreamble } from './insertPreamble';

export interface NarrationSavePlanArgs {
  script: NarrationScript;
  /** Null when decode/alignment failed — the sidecar still saves (empty timing). */
  alignment: NarrationAlignment | null;
  durationSec: number;
  audioExt: string;
  cameraExt: string | null;
  baseWpm: number;
  cameraOffsetSec?: number;
}

export interface NarrationSavePlan {
  audioRelativeName: string;
  cameraRelativeName: string | null;
  sidecarPayload: NarrationTimingJsonV3;
  /** Sidecar path for a given (possibly renamed) saved audio path. */
  sidecarPathFor: (savedAudioPath: string) => string;
  /** Compose ALL markdown edits from one source snapshot. */
  nextMarkdown: (
    currentSource: string,
    savedAudioPath: string,
    savedCameraPath: string | null,
  ) => string;
}

export function buildNarrationSavePlan(args: NarrationSavePlanArgs): NarrationSavePlan {
  const sidecarPayload: NarrationTimingJsonV3 = args.alignment
    ? buildNarrationTimingJson(args.script, args.alignment, args.durationSec, {
        baseWpm: args.baseWpm,
        ...(args.cameraOffsetSec !== undefined ? { cameraOffsetSec: args.cameraOffsetSec } : {}),
      })
    : {
        version: 3,
        sourceText: args.script.sourceText,
        duration: args.durationSec,
        bookmarks: [],
        blocks: [],
        generator: { name: 'squisq-teleprompter', method: 'dsp-align', baseWpm: args.baseWpm },
      };

  return {
    audioRelativeName: `audio/${buildFilename('audio', args.audioExt)}`,
    cameraRelativeName: args.cameraExt
      ? `video/${buildFilename('video', args.cameraExt, 'narration-cam')}`
      : null,
    sidecarPayload,
    sidecarPathFor: (savedAudioPath) => timingPathFor(savedAudioPath),
    nextMarkdown: (currentSource, savedAudioPath, savedCameraPath) =>
      insertNarrationPreamble(currentSource, savedAudioPath, savedCameraPath),
  };
}

export interface ExecuteNarrationSaveDeps {
  mediaProvider: MediaProvider;
  container: ContentContainer | null;
  /**
   * Read the LIVE markdown source at write time. Deliberately a getter, not
   * a snapshot: the media writes above are async, and a value captured before
   * them would compose the preamble from a stale source and clobber anything
   * that landed in between.
   */
  getMarkdownSource: () => string;
  setMarkdownSource: (next: string) => void;
  bumpMediaRevision: () => void;
}

/**
 * What a save attempt has already committed. Passed back in on a retry so a
 * second attempt REUSES the audio it already wrote instead of writing another
 * timestamped file (and orphaning the first).
 *
 * Mutated in place by {@link executeNarrationSave} as each step lands, which
 * is what makes the record survive the throw that aborted the attempt.
 */
export interface NarrationSaveProgress {
  audioPath?: string;
  cameraPath?: string | null;
  sidecarPath?: string;
}

export interface NarrationSaveResult {
  audioPath: string;
  cameraPath: string | null;
  sidecarPath: string;
}

/**
 * Execute a save plan: media writes, sidecar, then the single markdown write.
 *
 * Every step is idempotent against `progress`. A failed attempt leaves its
 * completed steps recorded there, so retrying with the SAME progress object
 * resumes rather than restarts — no duplicate audio, no second sidecar.
 */
export async function executeNarrationSave(
  plan: NarrationSavePlan,
  take: { audioBlob: Blob; audioMime: string; cameraBlob: Blob | null; cameraMime: string | null },
  deps: ExecuteNarrationSaveDeps,
  progress: NarrationSaveProgress = {},
): Promise<NarrationSaveResult> {
  const audioPath =
    progress.audioPath ??
    (await deps.mediaProvider.addMedia(plan.audioRelativeName, take.audioBlob, take.audioMime));
  progress.audioPath = audioPath;

  const sidecarPath = progress.sidecarPath ?? plan.sidecarPathFor(audioPath);
  if (progress.sidecarPath === undefined) {
    const encoded = encodeTimingJson(plan.sidecarPayload);
    if (deps.container) {
      await deps.container.writeFile(sidecarPath, encoded, 'application/json');
    } else {
      const storedAt = await deps.mediaProvider.addMedia(sidecarPath, encoded, 'application/json');
      if (storedAt !== sidecarPath) {
        console.warn(
          `Narration timing sidecar stored at "${storedAt}" instead of "${sidecarPath}"; ` +
            'narration timing will not be discovered until it sits next to the audio file.',
        );
      }
    }
    progress.sidecarPath = sidecarPath;
  }

  let cameraPath: string | null = progress.cameraPath ?? null;
  if (progress.cameraPath === undefined) {
    if (plan.cameraRelativeName && take.cameraBlob && take.cameraMime) {
      cameraPath = await deps.mediaProvider.addMedia(
        plan.cameraRelativeName,
        take.cameraBlob,
        take.cameraMime,
      );
    }
    progress.cameraPath = cameraPath;
  }

  deps.setMarkdownSource(plan.nextMarkdown(deps.getMarkdownSource(), audioPath, cameraPath));
  deps.bumpMediaRevision();
  return { audioPath, cameraPath, sidecarPath };
}

/**
 * Best-effort removal of media a failed/abandoned save left behind. Called
 * when the user retakes or discards after a save error — at that point the
 * written audio is unreferenced (no markdown ever pointed at it) and would
 * otherwise sit in the container forever.
 */
export async function discardNarrationSaveProgress(
  progress: NarrationSaveProgress,
  deps: Pick<ExecuteNarrationSaveDeps, 'mediaProvider' | 'container'>,
): Promise<void> {
  const paths = [progress.audioPath, progress.cameraPath ?? undefined].filter(
    (p): p is string => typeof p === 'string',
  );
  for (const path of paths) {
    try {
      await deps.mediaProvider.removeMedia(path);
    } catch (err: unknown) {
      console.warn(
        `Could not remove orphaned narration media "${path}": ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  if (progress.sidecarPath !== undefined && deps.container) {
    try {
      await deps.container.removeFile(progress.sidecarPath);
    } catch (err: unknown) {
      console.warn(
        `Could not remove orphaned narration sidecar "${progress.sidecarPath}": ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  delete progress.audioPath;
  delete progress.cameraPath;
  delete progress.sidecarPath;
}
