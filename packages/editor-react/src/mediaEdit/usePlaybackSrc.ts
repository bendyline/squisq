/**
 * The source an inline media player should play: the processed render when an
 * `fx` recipe has one, else the original. Lets an author hear their cleanup
 * right where the clip sits in the document.
 */

import { useMemo } from 'react';
import { parseMediaFx } from '@bendyline/squisq/mediaEdit';
import type { MediaClip } from '@bendyline/squisq/schemas';
import { useProcessedAudio } from '@bendyline/squisq-video-react/media-edit';
import { useEditorContextOptional } from '../EditorContext';

/**
 * A stand-in clip for a node view's `src` + `fx` recipe. Renders are keyed by
 * source and recipe alone, so it answers the render manager exactly as the
 * document's own clip would.
 */
export function useFxClip(
  src: string,
  kind: 'audio' | 'video',
  fx: string | null | undefined,
): MediaClip | null {
  return useMemo<MediaClip | null>(() => {
    const chain = fx ? parseMediaFx(fx) : null;
    return chain && src
      ? { id: src, src, kind, startAt: 0, anchor: 'block', edits: { fx: chain } }
      : null;
  }, [src, kind, fx]);
}

export function usePlaybackSrc(src: string, kind: 'audio' | 'video', fx: string | null): string {
  const editor = useEditorContextOptional();
  const processedAudio = useProcessedAudio(editor?.mediaEditRenders);
  const clip = useFxClip(src, kind, fx);
  return (clip && processedAudio(clip)) ?? src;
}
