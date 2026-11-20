/**
 * useResolvedMediaSrc — resolve a relative media path through the
 * EditorContext's MediaProvider, mirroring the pattern used by
 * `ImageNodeView`. Returns the resolved URL, or the original `src` when no
 * provider is available or the path is absolute. Used by the Tiptap video /
 * audio NodeViews so a relative `audio/foo.webm` plays from the workspace
 * container instead of 404-ing against the dev server.
 *
 * With a provider, a relative path is never returned as is: the provider owns
 * it, and the raw path would be requested from the page origin and 404. So
 * the hook returns '' while the path resolves, when the provider hands the
 * path back unchanged (it has no such file, as with a dropped clip whose
 * bytes are still being written), and when resolution fails. `useMediaUrl`
 * in squisq-react and the image node treat these cases the same.
 */
import { useEffect, useState } from 'react';
import { useEditorContext } from '../EditorContext.js';

export function useResolvedMediaSrc(src: string): string {
  const { mediaProvider, mediaRevision } = useEditorContext();

  const isRelative =
    !!src &&
    !src.startsWith('blob:') &&
    !src.startsWith('http:') &&
    !src.startsWith('https:') &&
    !src.startsWith('data:') &&
    !src.startsWith('/');
  const [resolved, setResolved] = useState(isRelative && mediaProvider ? '' : src);

  useEffect(() => {
    if (!mediaProvider || !isRelative) {
      setResolved(src);
      return;
    }
    let cancelled = false;
    mediaProvider.resolveUrl(src).then(
      (url) => {
        if (!cancelled) setResolved(url === src ? '' : url);
      },
      () => {
        if (!cancelled) setResolved('');
      },
    );
    return () => {
      cancelled = true;
    };
    // `mediaRevision` bumps after writes — re-resolve so the player picks
    // up the new blob URL after a re-record / edit, or once a dropped
    // clip's bytes land.
  }, [src, isRelative, mediaProvider, mediaRevision]);

  return resolved;
}
