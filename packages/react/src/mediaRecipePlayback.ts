/**
 * Applying a media-edit recipe to a playing `<video>` / `<audio>` element.
 *
 * Scheduled clips get their recipe from the schedule (`MediaClipLayer`). The
 * same media also plays in places with no schedule — a video laid out in a
 * slide's body, the inline players of the Write and Document views — and
 * there the element itself has to honor the recipe. These are the pieces
 * those players share: skipping cuts, cropping the frame, and setting a level.
 */

import { useEffect, useMemo, type CSSProperties, type RefObject } from 'react';
import {
  createMediaTimeMap,
  serializeMediaCuts,
  type MediaCrop,
  type MediaCut,
  type MediaTimeMap,
} from '@bendyline/squisq/mediaEdit';
import { isCaptureDrivenVideo } from './docPlayer/renderReadiness';

/** A playing element this far into a cut is moved to the cut's far side. */
const CUT_SKIP_TOLERANCE_SECONDS = 0.01;

/**
 * Source time ↔ played time through a clip's cuts, or null for an uncut clip.
 * Unbounded at the far end: the caller caps a timed clip at its own out-point.
 */
export function useCutTimeMap(
  cuts: readonly MediaCut[] | null | undefined,
  clipStart = 0,
): MediaTimeMap | null {
  const key = cuts?.length ? serializeMediaCuts(cuts) : '';
  return useMemo(
    () => (key && cuts ? createMediaTimeMap({ clipStart, cuts }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `cuts`
    [key, clipStart],
  );
}

/**
 * While the element plays, move it out of any cut it runs into, on the next
 * animation frame. Works whatever drives the element — a doc clock that ticks
 * coarsely, or the viewer's hand on native controls. A paused element is left
 * where it is, and so is one a frame capture is positioning.
 *
 * `source` re-arms the watch when the element is replaced or reloaded.
 */
export function useSkipCuts(
  ref: RefObject<HTMLMediaElement | null>,
  timeMap: MediaTimeMap | null,
  source?: unknown,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !timeMap) return;
    let frame = requestAnimationFrame(function skipCuts() {
      const captured = element instanceof HTMLVideoElement && isCaptureDrivenVideo(element);
      if (!element.paused && !captured) {
        const at = element.currentTime;
        const kept = timeMap.playedToSource(timeMap.snapSourceToPlayed(at));
        if (kept - at > CUT_SKIP_TOLERANCE_SECONDS) element.currentTime = kept;
      }
      frame = requestAnimationFrame(skipCuts);
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, timeMap, source]);
}

/**
 * Crop via CSS `object-view-box` (Chromium): the crop region replaces the
 * frame before object-fit applies, so framing matches the export exactly.
 * Browsers without it show the uncropped frame.
 */
export function mediaCropStyle(crop: MediaCrop | null | undefined): CSSProperties {
  if (!crop) return {};
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  const inset = `inset(${pct(crop.y)} ${pct(1 - crop.x - crop.w)} ${pct(1 - crop.y - crop.h)} ${pct(crop.x)})`;
  return { objectViewBox: inset } as CSSProperties;
}

/**
 * Linear level of a recipe at a played position: its gain times the fade at
 * either end of the played clip. 1 for a clip with neither.
 */
export function recipeLevelAt(
  recipe: { gain?: number; fadeIn?: number; fadeOut?: number },
  played: number,
  playedDuration: number,
): number {
  let level = recipe.gain ? Math.pow(10, recipe.gain / 20) : 1;
  if (recipe.fadeIn && played < recipe.fadeIn) level *= Math.max(0, played / recipe.fadeIn);
  if (recipe.fadeOut && played > playedDuration - recipe.fadeOut) {
    level *= Math.max(0, (playedDuration - played) / recipe.fadeOut);
  }
  return level;
}

/**
 * Boosts above unity need Web Audio (an element's `volume` stops at 1). One
 * lazily created context serves the page; each boosted element is routed
 * through its own GainNode, once — an element can only be captured once.
 */
let boostContext: AudioContext | null = null;
const boostNodes = new WeakMap<HTMLMediaElement, GainNode>();

function boostNodeFor(el: HTMLMediaElement): GainNode | null {
  const existing = boostNodes.get(el);
  if (existing) return existing;
  if (typeof AudioContext === 'undefined') return null;
  try {
    boostContext ??= new AudioContext();
    const gain = boostContext.createGain();
    boostContext.createMediaElementSource(el).connect(gain).connect(boostContext.destination);
    boostNodes.set(el, gain);
    return gain;
  } catch {
    return null;
  }
}

/** Apply a linear level to an element: `volume` for attenuation, a GainNode for boosts. */
export function applyMediaLevel(el: HTMLMediaElement, level: number): void {
  const boost = level > 1 ? boostNodeFor(el) : boostNodes.get(el);
  if (boost) {
    el.volume = 1;
    boost.gain.value = level;
    if (boostContext?.state === 'suspended') void boostContext.resume().catch(() => {});
    return;
  }
  el.volume = Math.min(1, Math.max(0, level));
}
