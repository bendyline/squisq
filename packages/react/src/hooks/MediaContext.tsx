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

import { createContext, useContext, useState, useEffect } from 'react';
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

  // For absolute/http URLs, skip resolution entirely
  const isAbsolute = relativePath.startsWith('http') || relativePath.startsWith('/') || relativePath.startsWith('data:') || relativePath.startsWith('blob:');

  const fallback = isAbsolute ? relativePath : `${basePath}/${relativePath}`;

  const [url, setUrl] = useState(fallback);

  useEffect(() => {
    if (isAbsolute || !provider) {
      setUrl(fallback);
      return;
    }

    let cancelled = false;
    provider.resolveUrl(relativePath).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });

    return () => { cancelled = true; };
  }, [provider, relativePath, basePath, isAbsolute, fallback]);

  return url;
}
