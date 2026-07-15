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
import {
  DEFAULT_INTERACTIVE_RESOURCE_POLICY,
  isResourceUrlAllowed,
  type ResourcePolicy,
} from '@bendyline/squisq/markdown';

/**
 * React context holding the current MediaProvider (or null if none provided).
 */
export const MediaContext = createContext<MediaProvider | null>(null);

/**
 * Policy for document-controlled media URLs. Hosts rendering untrusted
 * documents can provide `LOCAL_ONLY_RESOURCE_POLICY` or an explicit host
 * allow-list without changing their MediaProvider.
 */
export const ResourcePolicyContext = createContext<ResourcePolicy>(
  DEFAULT_INTERACTIVE_RESOURCE_POLICY,
);

export function useResourcePolicy(): ResourcePolicy {
  return useContext(ResourcePolicyContext);
}

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
  const resourcePolicy = useResourcePolicy();

  // Defensive: callers (esp. preview surfaces like InlinePreviewGutter)
  // sometimes feed in template-generated layers whose `content.src` is
  // undefined while the user is still authoring the block. Treat that
  // as an empty string rather than crashing the whole React tree.
  const safePath = typeof relativePath === 'string' ? relativePath : '';

  // For absolute/http URLs, skip resolution entirely
  const isAbsolute = !safePath || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(safePath);

  // Memoize fallback to avoid recalculating on every render
  const fallback = useMemo(() => {
    const candidate = isAbsolute ? safePath : `${basePath.replace(/\/$/, '')}/${safePath}`;
    return isResourceUrlAllowed(candidate, resourcePolicy) ? candidate : '';
  }, [isAbsolute, safePath, basePath, resourcePolicy]);

  // Fast path: no provider or absolute URL — return synchronously, skip effect entirely
  const needsProvider = !isAbsolute && !!provider;

  const [url, setUrl] = useState(fallback);

  useEffect(() => {
    if (!needsProvider) {
      setUrl(fallback);
      return;
    }

    let cancelled = false;
    // Never show the prior asset while a new provider/path is resolving.
    setUrl(fallback);
    provider!.resolveUrl(safePath).then(
      (resolved) => {
        if (!cancelled) {
          setUrl(isResourceUrlAllowed(resolved, resourcePolicy) ? resolved : '');
        }
      },
      () => {
        // Resolution failures should be non-fatal and must not become
        // unhandled promise rejections in rendering surfaces.
        if (!cancelled) setUrl(fallback);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [needsProvider, provider, safePath, fallback, resourcePolicy]);

  // When provider is not needed, return fallback directly to avoid
  // the one-frame delay from the initial useState → useEffect cycle
  return needsProvider ? url : fallback;
}
