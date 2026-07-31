/**
 * Ambient host fence-renderer registry — the context companion to the
 * explicit `fenceRenderers` prop on `MarkdownRenderer` / `LinearDocView`.
 *
 * Wrap a subtree once and every markdown surface inside it (including
 * indirect ones like `JsonView`'s rich-text viewer) renders claimed
 * fences through the host's widgets. The prop, when supplied, always
 * wins over the context so a specific surface can override or opt out
 * (pass `{}` to disable).
 */

import { createContext, useContext } from 'react';
import type { FenceRendererMap } from '@bendyline/squisq/fence';

export const FenceRendererContext = createContext<FenceRendererMap | null>(null);

/** The ambient registry, or null when no provider wraps this subtree. */
export function useFenceRenderers(): FenceRendererMap | null {
  return useContext(FenceRendererContext);
}
