/**
 * useMediaSchedule
 *
 * Pure follower of the playback clock for the media-clip model. Given the
 * resolved {@link ScheduledClip}s and the current time, it returns the clips
 * the player should mount and which of them are active right now.
 * {@link MediaClipLayer} consumes this to drive one hidden `<audio>` /
 * full-bleed `<video>` element per clip. (Annotation-authored clips all render
 * at the player level; template-produced `VideoLayer`s are a separate path and
 * are not part of the schedule.)
 *
 * It owns no clock: `currentTime`/`isPlaying` come from the existing
 * `useAudioSync` provider via `DocPlayer`. With an empty schedule it returns
 * empty lists, so documents without the new media model are unaffected.
 */

import { useMemo } from 'react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';

export interface MediaScheduleController {
  /** Clips the player mounts (every scheduled clip). */
  renderClips: ScheduledClip[];
  /** Ids of clips whose [absoluteStart, absoluteEnd) contains currentTime. */
  activeIds: Set<string>;
}

export function useMediaSchedule(
  schedule: ScheduledClip[],
  currentTime: number,
): MediaScheduleController {
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of schedule) {
      if (currentTime >= c.absoluteStart && currentTime < c.absoluteEnd) ids.add(c.id);
    }
    return ids;
  }, [schedule, currentTime]);
  return { renderClips: schedule, activeIds };
}
