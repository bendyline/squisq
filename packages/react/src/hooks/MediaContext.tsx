/**
 * MediaContext — React context for providing a MediaProvider to layer components.
 *
 * When a MediaProvider is available in context, layer components (ImageLayer,
 * VideoLayer) will use it to resolve media URLs instead of the basePath prop.
 * This enables slot-based media storage where binary assets are served from
 * IndexedDB as blob URLs.
 *
 * Usage:
 *   const provider = createSlotMediaProvider(slotId);
 *   <MediaContext.Provider value={provider}>
 *     <DocPlayer doc={doc} basePath="/" />
 *   </MediaContext.Provider>
 */

import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { MediaProvider } from '@bendyline/squisq/schemas';

/**
 * React context holding the current MediaProvider (or null if none provided).
 */
export const MediaContext = createContext<MediaProvider | null>(null);

/**
 * Hook to access the current MediaProvider from context.
 * Returns null if no provider is set.
 */
export function useMediaProvider(): MediaProvider | null {
  return useContext(MediaContext);
}

/**
 * Hook to resolve a media URL via the MediaProvider (if available),
 * falling back to basePath-based resolution.
 *
 * Returns the resolved URL string. Updates when the provider or path changes.
 *
 * @param relativePath - Relative media path from the document (e.g., 'hero.jpg')
 * @param basePath - Fallback base path for URL construction
 */
export function useMediaUrl(relativePath: string, basePath: string): string {
  const provider = useMediaProvider();

  // Defensive: callers (esp. preview surfaces like InlinePreviewGutter)
  // sometimes feed in template-generated layers whose `content.src` is
  // undefined while the user is still authoring the block. Treat that
  // as an empty string rather than crashing the whole React tree.
  const safePath = typeof relativePath === 'string' ? relativePath : '';

  // For absolute/http URLs, skip resolution entirely
  const isAbsolute =
    !safePath ||
    safePath.startsWith('http') ||
    safePath.startsWith('/') ||
    safePath.startsWith('data:') ||
    safePath.startsWith('blob:');

  // Memoize fallback to avoid recalculating on every render
  const fallback = useMemo(
    () => (isAbsolute ? safePath : `${basePath}/${safePath}`),
    [isAbsolute, safePath, basePath],
  );

  // Fast path: no provider or absolute URL — return synchronously, skip effect entirely
  const needsProvider = !isAbsolute && !!provider;

  const [url, setUrl] = useState(fallback);

  useEffect(() => {
    if (!needsProvider) {
      setUrl(fallback);
      return;
    }

    let cancelled = false;
    provider!.resolveUrl(safePath).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [needsProvider, provider, safePath, fallback]);

  // When provider is not needed, return fallback directly to avoid
  // the one-frame delay from the initial useState → useEffect cycle
  return needsProvider ? url : fallback;
}
