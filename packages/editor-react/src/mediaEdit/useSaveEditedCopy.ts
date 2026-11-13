/**
 * "Save edited copy": bake a clip — its source with the recipe on screen
 * applied — and hand the file to the host's save flow, or download it.
 *
 * The copy is made from the recipe as the dialog shows it, applied or not, so
 * what is saved is what was just previewed. Baking is cached by recipe, so
 * saving again without changing anything is immediate.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaBakeCopyName } from '@bendyline/squisq/mediaEdit';
import type { MediaClip } from '@bendyline/squisq/schemas';
import type { MediaEditRenderManager } from '@bendyline/squisq-video-react/media-edit';
import type { MediaEditSaveOutput } from '../EditorContext';

export type SaveEditedCopyState =
  | { status: 'idle' }
  | { status: 'working'; progress: number }
  | { status: 'saved'; filename: string }
  | { status: 'failed'; error: string };

const MIME_BY_EXTENSION: Record<string, { audio: string; video: string }> = {
  mp4: { audio: 'audio/mp4', video: 'video/mp4' },
  m4a: { audio: 'audio/mp4', video: 'audio/mp4' },
  webm: { audio: 'audio/webm', video: 'video/webm' },
  wav: { audio: 'audio/wav', video: 'audio/wav' },
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download reads the URL after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useSaveEditedCopy(
  manager: MediaEditRenderManager | null | undefined,
  saveOutput: MediaEditSaveOutput | undefined,
): { state: SaveEditedCopyState; save: (clip: MediaClip) => Promise<void> } {
  const [state, setState] = useState<SaveEditedCopyState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  // Leaving the dialog abandons a copy nobody is waiting to save.
  useEffect(() => () => abortRef.current?.abort(), []);

  const save = useCallback(
    async (clip: MediaClip) => {
      if (!manager) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ status: 'working', progress: 0 });
      try {
        const path = await manager.bake(clip, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) setState({ status: 'working', progress });
          },
        });
        const stored = await manager.loadSource(path);
        if (controller.signal.aborted) return;
        const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        const type = MIME_BY_EXTENSION[extension]?.[clip.kind] ?? stored.type;
        const filename = mediaBakeCopyName(clip.src, extension);
        const blob = new Blob([stored], { type });
        const saved = await (saveOutput
          ? saveOutput(blob, filename)
          : downloadBlob(blob, filename));
        if (controller.signal.aborted) return;
        // `false` is the host saying the user backed out of its save prompt.
        setState(saved === false ? { status: 'idle' } : { status: 'saved', filename });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setState({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [manager, saveOutput],
  );

  return { state, save };
}
