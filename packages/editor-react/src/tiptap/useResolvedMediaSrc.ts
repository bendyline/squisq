/**
 * useResolvedMediaSrc — resolve a relative media path through the
 * EditorContext's MediaProvider, mirroring the pattern used by
 * `ImageNodeView`. Returns the resolved URL (or the original `src`
 * when no provider is available, the path is absolute, or resolution
 * fails). Used by the Tiptap video / audio NodeViews so a relative
 * `audio/foo.webm` plays from the workspace container instead of
 * 404-ing against the dev server.
 */
import { useEffect, useState } from 'react';
import { useEditorContext } from '../EditorContext.js';

export function useResolvedMediaSrc(src: string): string {
  const { mediaProvider, mediaRevision } = useEditorContext();
  const [resolved, setResolved] = useState(src);

  const isRelative =
    !!src &&
    !src.startsWith('blob:') &&
    !src.startsWith('http:') &&
    !src.startsWith('https:') &&
    !src.startsWith('data:') &&
    !src.startsWith('/');

  useEffect(() => {
    if (!mediaProvider || !isRelative) {
      setResolved(src);
      return;
    }
    let cancelled = false;
    mediaProvider.resolveUrl(src).then(
      (url) => {
        if (!cancelled) setResolved(url);
      },
      () => {
        if (!cancelled) setResolved(src);
      },
    );
    return () => {
      cancelled = true;
    };
    // `mediaRevision` bumps after writes — re-resolve so the player
    // picks up the new blob URL after a re-record / edit.
  }, [src, isRelative, mediaProvider, mediaRevision]);

  return resolved;
}
