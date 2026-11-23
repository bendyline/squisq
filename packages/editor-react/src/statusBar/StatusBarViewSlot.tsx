/**
 * The status bar's view region.
 *
 * The status bar shows what belongs to the view on screen: Slideshow's slide
 * navigation, the Blocks and Timeline views' block navigation. Each view
 * renders those controls itself, through a portal into this region, so their
 * state stays with the view and nothing has to be lifted into the bar.
 *
 * The region exists only while a status bar is showing. When the person hides
 * it, a host renders none, or a presentation hides the editor chrome, the
 * target is null and each view draws its controls where it always has (the
 * slideshow's overlay pill, the block card's footer). The hooks views and
 * the status bar read it through live in statusBarViewTarget.ts.
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StatusBarViewSlotContext, useStatusBarViewTarget } from './statusBarViewTarget';

/** Shares the status bar's view region with the views. `EditorProvider` mounts one. */
export function StatusBarViewSlotProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return (
    <StatusBarViewSlotContext.Provider value={value}>{children}</StatusBarViewSlotContext.Provider>
  );
}

/**
 * Portals its children into the status bar's view region. Renders nothing
 * when no status bar is showing — callers that need a fallback check
 * {@link useStatusBarViewTarget} first.
 */
export function StatusBarViewContent({ children }: { children: ReactNode }) {
  const target = useStatusBarViewTarget();
  return target ? createPortal(children, target) : null;
}
