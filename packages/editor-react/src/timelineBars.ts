/**
 * Timeline bar model: which scheduled entries the track draws as clip bars.
 */

import type { ScheduledClip } from '@bendyline/squisq/schemas';

/**
 * The bars the track draws: one per authored clip. Processed-audio companions
 * are dropped, and the contiguous segments of a cut clip merge into one bar
 * (id = the authored clip's id) carrying the doc times of its cuts.
 */
export function timelineBars(
  clips: readonly ScheduledClip[],
): Array<{ clip: ScheduledClip; cutMarks: number[] }> {
  const bars: Array<{ clip: ScheduledClip; cutMarks: number[] }> = [];
  const groups = new Map<string, ScheduledClip[]>();
  for (const clip of clips) {
    if (clip.derivedFrom) continue;
    if (!clip.segment) {
      bars.push({ clip, cutMarks: [] });
      continue;
    }
    const group = groups.get(clip.segment.groupId);
    if (group) group.push(clip);
    else {
      const members = [clip];
      groups.set(clip.segment.groupId, members);
      // Placeholder keeps the bar in schedule order; filled in below.
      bars.push({ clip, cutMarks: [] });
    }
  }
  return bars.map((bar) => {
    const segment = bar.clip.segment;
    if (!segment) return bar;
    const members = (groups.get(segment.groupId) ?? [bar.clip]).sort(
      (a, b) => (a.segment?.index ?? 0) - (b.segment?.index ?? 0),
    );
    const first = members[0];
    const last = members[members.length - 1];
    const merged: ScheduledClip = {
      ...first,
      id: segment.groupId,
      absoluteEnd: last.absoluteEnd,
    };
    delete merged.segment;
    return { clip: merged, cutMarks: members.slice(1).map((m) => m.absoluteStart) };
  });
}
