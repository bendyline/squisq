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

export function usePlaybackSrc(src: string, kind: 'audio' | 'video', fx: string | null): string {
  const editor = useEditorContextOptional();
  const processedAudio = useProcessedAudio(editor?.mediaEditRenders);
  const clip = useMemo<MediaClip | null>(() => {
    const chain = fx ? parseMediaFx(fx) : null;
    return chain && src
      ? { id: src, src, kind, startAt: 0, anchor: 'block', edits: { fx: chain } }
      : null;
  }, [src, kind, fx]);
  return (clip && processedAudio(clip)) ?? src;
}
