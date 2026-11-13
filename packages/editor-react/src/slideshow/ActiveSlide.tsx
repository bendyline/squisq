/* eslint-disable react-refresh/only-export-components */
/**
 * ActiveSlide
 *
 * Which slide the Slideshow preview is showing, shared between the player
 * (`PreviewPanel`, which knows) and the toolbar (`PreviewToolbarControls`,
 * which acts on it — today the block-type picker).
 *
 * The value and its setter travel in separate contexts: the player reports on
 * every playback-state change, and reading only the setter keeps it from
 * re-rendering each time the slide it just reported lands in state.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export interface ActiveSlide {
  /**
   * Id of the player block on screen. For a section of the document this is
   * the source block's id; a slide the player paced into parts carries a
   * `-split-N` suffix. Null while the managed cover is showing.
   */
  blockId: string | null;
  /** The template the slide on screen was drawn with, when the player knows. */
  template?: string;
  /** The managed cover slide is on screen. */
  isCover: boolean;
  /**
   * The deck was generated from the document (a Summarize style or a designed
   * presentation) instead of showing its sections as written, so a slide does
   * not stand for one authored block.
   */
  generated: boolean;
}

const ActiveSlideContext = createContext<ActiveSlide | null>(null);
const ReportActiveSlideContext = createContext<((slide: ActiveSlide | null) => void) | null>(null);

function sameSlide(left: ActiveSlide | null, right: ActiveSlide | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.blockId === right.blockId &&
    left.template === right.template &&
    left.isCover === right.isCover &&
    left.generated === right.generated
  );
}

export function ActiveSlideProvider({ children }: { children: ReactNode }) {
  const [slide, setSlide] = useState<ActiveSlide | null>(null);
  const report = useCallback((next: ActiveSlide | null) => {
    setSlide((previous) => (sameSlide(previous, next) ? previous : next));
  }, []);
  return (
    <ReportActiveSlideContext.Provider value={report}>
      <ActiveSlideContext.Provider value={slide}>{children}</ActiveSlideContext.Provider>
    </ReportActiveSlideContext.Provider>
  );
}

/** The slide the Slideshow preview is showing, or null when none is known. */
export function useActiveSlide(): ActiveSlide | null {
  return useContext(ActiveSlideContext);
}

/**
 * Report the slide on screen (null when the slideshow is not showing). A no-op
 * outside an {@link ActiveSlideProvider}, so the preview works unwrapped.
 */
export function useReportActiveSlide(): (slide: ActiveSlide | null) => void {
  const report = useContext(ReportActiveSlideContext);
  return report ?? noop;
}

function noop(): void {}

/** The source block id a player block id stands for (drops a pacing suffix). */
export function sourceBlockIdOf(playerBlockId: string): string {
  return playerBlockId.replace(/-split-\d+$/, '');
}
