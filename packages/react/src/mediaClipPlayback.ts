/**
 * Playback math for media-edit recipes on scheduled clips: the live level
 * (gain × fades) and which elements a cut clip mounts.
 */

import type { ScheduledClip } from '@bendyline/squisq/schemas';

/**
 * Linear level of a clip at a doc-timeline instant: recipe gain times the fade
 * envelope at either end. 1 for an unedited clip.
 */
export function clipLevelAt(
  clip: Pick<ScheduledClip, 'absoluteStart' | 'absoluteEnd' | 'gain' | 'fadeIn' | 'fadeOut'>,
  time: number,
): number {
  let level = clip.gain ? Math.pow(10, clip.gain / 20) : 1;
  if (clip.fadeIn && time < clip.absoluteStart + clip.fadeIn) {
    level *= Math.max(0, (time - clip.absoluteStart) / clip.fadeIn);
  }
  if (clip.fadeOut && time > clip.absoluteEnd - clip.fadeOut) {
    level *= Math.max(0, (clip.absoluteEnd - time) / clip.fadeOut);
  }
  return level;
}

/**
 * The clips to mount. Segments of a cut clip collapse to the one playing (or
 * next up) plus the one after it, keyed by alternating slot so each slot's
 * element — already loaded with the source — is reused rather than remounted.
 */
export function mountedClips(
  clips: readonly ScheduledClip[],
  time: number,
): Array<{ key: string; clip: ScheduledClip }> {
  const out: Array<{ key: string; clip: ScheduledClip }> = [];
  const groups = new Map<string, ScheduledClip[]>();
  for (const clip of clips) {
    if (!clip.segment) {
      out.push({ key: clip.id, clip });
      continue;
    }
    const group = groups.get(clip.segment.groupId) ?? [];
    group.push(clip);
    groups.set(clip.segment.groupId, group);
  }
  for (const [groupId, segments] of groups) {
    segments.sort((a, b) => (a.segment?.index ?? 0) - (b.segment?.index ?? 0));
    let current = segments.findIndex((s) => time < s.absoluteEnd);
    if (current === -1) current = segments.length - 1;
    for (const index of [current, current + 1]) {
      const clip = segments[index];
      if (clip) out.push({ key: `${groupId}#slot${index % 2}`, clip });
    }
  }
  return out;
}
