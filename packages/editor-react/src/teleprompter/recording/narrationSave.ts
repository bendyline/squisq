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
  markdownSource: string;
  setMarkdownSource: (next: string) => void;
  bumpMediaRevision: () => void;
}

export interface NarrationSaveResult {
  audioPath: string;
  cameraPath: string | null;
  sidecarPath: string;
}

/** Execute a save plan: media writes, sidecar, then the single markdown write. */
export async function executeNarrationSave(
  plan: NarrationSavePlan,
  take: { audioBlob: Blob; audioMime: string; cameraBlob: Blob | null; cameraMime: string | null },
  deps: ExecuteNarrationSaveDeps,
): Promise<NarrationSaveResult> {
  const audioPath = await deps.mediaProvider.addMedia(
    plan.audioRelativeName,
    take.audioBlob,
    take.audioMime,
  );

  const sidecarPath = plan.sidecarPathFor(audioPath);
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

  let cameraPath: string | null = null;
  if (plan.cameraRelativeName && take.cameraBlob && take.cameraMime) {
    cameraPath = await deps.mediaProvider.addMedia(
      plan.cameraRelativeName,
      take.cameraBlob,
      take.cameraMime,
    );
  }

  deps.setMarkdownSource(plan.nextMarkdown(deps.markdownSource, audioPath, cameraPath));
  deps.bumpMediaRevision();
  return { audioPath, cameraPath, sidecarPath };
}
