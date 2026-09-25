import { describe, expect, it } from 'vitest';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { timelineBars } from '../timelineBars';

const plain: ScheduledClip = {
  id: 'music',
  src: 'music.mp3',
  kind: 'audio',
  absoluteStart: 0,
  absoluteEnd: 30,
  sourceIn: 0,
  anchor: 'document',
};

function seg(index: number, start: number, end: number, sourceIn: number): ScheduledClip {
  return {
    id: `take#${index}`,
    src: 'take.webm',
    kind: 'video',
    absoluteStart: start,
    absoluteEnd: end,
    sourceIn,
    anchor: 'document',
    sourceLine: 3,
    segment: { groupId: 'take', index, count: 3 },
  };
}

describe('timelineBars', () => {
  it('merges a cut clip into one bar with a mark at each cut, in schedule order', () => {
    const companion: ScheduledClip = {
      ...seg(0, 0, 4, 0),
      id: 'take#0~audio',
      kind: 'audio',
      derivedFrom: 'take',
    };
    const bars = timelineBars([
      plain,
      seg(0, 2, 6, 0),
      companion,
      seg(1, 6, 9, 5),
      seg(2, 9, 12, 10),
    ]);
    expect(bars.map((b) => b.clip.id)).toEqual(['music', 'take']);
    const take = bars[1];
    expect(take.clip).toMatchObject({
      absoluteStart: 2,
      absoluteEnd: 12,
      sourceIn: 0,
      sourceLine: 3,
    });
    expect(take.clip.segment).toBeUndefined();
    expect(take.cutMarks).toEqual([6, 9]);
  });

  it('passes ordinary clips through unchanged', () => {
    expect(timelineBars([plain])).toEqual([{ clip: plain, cutMarks: [] }]);
  });
});
