import { describe, expect, it } from 'vitest';
import { resolveMediaSchedule, getDocPlaybackDuration } from '../schemas/Media.js';
import type { Doc, Block } from '../schemas/Doc.js';

function block(partial: Partial<Block>): Block {
  return {
    id: partial.id ?? 'b',
    startTime: partial.startTime ?? 0,
    duration: partial.duration ?? 10,
    audioSegment: 0,
    ...partial,
  };
}

function doc(blocks: Block[], extra?: Partial<Doc>): Doc {
  const lastEnd = blocks.reduce((m, b) => Math.max(m, b.startTime + b.duration), 0);
  return { articleId: 't', duration: lastEnd, blocks, audio: { segments: [] }, ...extra };
}

describe('resolveMediaSchedule', () => {
  it('offsets a block clip by startAt relative to the block start', () => {
    // Block #2 starts at 30s; a clip with startAt=5 plays at 35s.
    const d = doc([
      block({ id: 'one', startTime: 0, duration: 30 }),
      block({
        id: 'two',
        startTime: 30,
        duration: 20,
        media: [{ id: 'm1', src: 'a.mp3', kind: 'audio', startAt: 5, clipEnd: 8, anchor: 'block' }],
      }),
    ]);
    const [clip] = resolveMediaSchedule(d);
    expect(clip.absoluteStart).toBe(35);
    expect(clip.absoluteEnd).toBe(43); // 35 + (clipEnd 8 - clipStart 0)
    expect(clip.sourceIn).toBe(0);
    expect(clip.blockId).toBe('two');
  });

  it('clamps a non-spillover clip to the block end', () => {
    const d = doc([
      block({
        id: 'b',
        startTime: 0,
        duration: 10,
        media: [
          { id: 'm', src: 'a.mp3', kind: 'audio', startAt: 2, clipEnd: 100, anchor: 'block' },
        ],
      }),
    ]);
    const [clip] = resolveMediaSchedule(d);
    expect(clip.absoluteEnd).toBe(10); // clamped to block end, not 2 + 100
  });

  it('lets a spillover clip run past the block end', () => {
    const d = doc([
      block({
        id: 'b',
        startTime: 0,
        duration: 10,
        media: [
          {
            id: 'm',
            src: 'a.mp3',
            kind: 'audio',
            startAt: 2,
            clipEnd: 100,
            spillover: true,
            anchor: 'block',
          },
        ],
      }),
      block({ id: 'b2', startTime: 10, duration: 10 }),
    ]);
    const [clip] = resolveMediaSchedule(d);
    expect(clip.absoluteEnd).toBe(102); // 2 + 100, past the block end
  });

  it('spans the whole document for an anchor=document clip', () => {
    const d = doc([block({ id: 'b', startTime: 0, duration: 40 })], {
      documentMedia: [
        { id: 'narr', src: 'voice.mp3', kind: 'audio', startAt: 0, anchor: 'document' },
      ],
    });
    const [clip] = resolveMediaSchedule(d);
    expect(clip.absoluteStart).toBe(0);
    expect(clip.absoluteEnd).toBe(40);
    expect(clip.anchor).toBe('document');
  });

  describe('intrinsic-duration capping (unlocked videos)', () => {
    it('caps an unlocked document video to its probed length instead of the doc end', () => {
      // A 20s recording placed on a 187s document: without capping it would be
      // scheduled across the whole timeline and freeze on its last frame.
      const d = doc([block({ id: 'b', startTime: 0, duration: 187 })], {
        documentMedia: [
          {
            id: 'v',
            src: 'rec.webm',
            kind: 'video',
            startAt: 0,
            anchor: 'document',
            lockToBlock: false,
          },
        ],
      });
      const [clip] = resolveMediaSchedule(d, { intrinsicDuration: () => 20 });
      expect(clip.absoluteEnd).toBe(20);
    });

    it('never extends a clip past the timeline when the file is longer than the doc', () => {
      const d = doc([block({ id: 'b', startTime: 0, duration: 40 })], {
        documentMedia: [{ id: 'v', src: 'long.webm', kind: 'video', startAt: 0, anchor: 'document' }],
      });
      const [clip] = resolveMediaSchedule(d, { intrinsicDuration: () => 300 });
      expect(clip.absoluteEnd).toBe(40); // capped at the doc end, never extended
    });

    it('lets an authored clipEnd win over the probed duration', () => {
      const d = doc([block({ id: 'b', startTime: 0, duration: 100 })], {
        documentMedia: [
          { id: 'v', src: 'rec.webm', kind: 'video', startAt: 0, clipEnd: 8, anchor: 'document' },
        ],
      });
      const [clip] = resolveMediaSchedule(d, { intrinsicDuration: () => 20 });
      expect(clip.absoluteEnd).toBe(8);
    });

    it('ignores the probe for a video locked to its block (fills the block)', () => {
      const d = doc([
        block({
          id: 'b',
          startTime: 0,
          duration: 30,
          media: [
            {
              id: 'v',
              src: 'clip.webm',
              kind: 'video',
              startAt: 0,
              anchor: 'block',
              lockToBlock: true,
              placement: 'overlay',
            },
          ],
        }),
      ]);
      const [clip] = resolveMediaSchedule(d, { intrinsicDuration: () => 5 });
      expect(clip.absoluteEnd).toBe(30);
    });

    it('caps a non-spillover block clip below the block end', () => {
      const d = doc([
        block({
          id: 'b',
          startTime: 10,
          duration: 30, // block ends at 40
          media: [{ id: 'v', src: 'clip.webm', kind: 'video', startAt: 2, anchor: 'block' }],
        }),
      ]);
      const [clip] = resolveMediaSchedule(d, { intrinsicDuration: () => 6 });
      expect(clip.absoluteStart).toBe(12); // 10 + 2
      expect(clip.absoluteEnd).toBe(18); // 12 + 6, well within the block
    });

    it('measures the natural length past the clip in-point', () => {
      const d = doc([block({ id: 'b', startTime: 0, duration: 100 })], {
        documentMedia: [
          { id: 'v', src: 'rec.webm', kind: 'video', startAt: 0, clipStart: 5, anchor: 'document' },
        ],
      });
      const [clip] = resolveMediaSchedule(d, { intrinsicDuration: () => 20 });
      expect(clip.sourceIn).toBe(5);
      expect(clip.absoluteEnd).toBe(15); // 0 + (20 - 5) of playable content
    });

    it('does not cap when the probe has no duration for the clip', () => {
      const d = doc([block({ id: 'b', startTime: 0, duration: 40 })], {
        documentMedia: [{ id: 'v', src: 'rec.webm', kind: 'video', startAt: 0, anchor: 'document' }],
      });
      const [clip] = resolveMediaSchedule(d, { intrinsicDuration: () => undefined });
      expect(clip.absoluteEnd).toBe(40);
    });
  });
});

describe('getDocPlaybackDuration', () => {
  it('extends total duration to include media spillover', () => {
    const d = doc([
      block({
        id: 'b',
        startTime: 0,
        duration: 10,
        media: [
          {
            id: 'm',
            src: 'a.mp3',
            kind: 'audio',
            startAt: 0,
            clipEnd: 25,
            spillover: true,
            anchor: 'block',
          },
        ],
      }),
    ]);
    expect(getDocPlaybackDuration(d)).toBe(25);
  });

  it('falls back to the block timeline when there is no media', () => {
    const d = doc([block({ id: 'b', startTime: 0, duration: 12 })]);
    expect(getDocPlaybackDuration(d)).toBe(12);
  });

  it('is unchanged when capping a short unlocked video (cap never extends)', () => {
    const d = doc([block({ id: 'b', startTime: 0, duration: 60 })], {
      documentMedia: [{ id: 'v', src: 'rec.webm', kind: 'video', startAt: 0, anchor: 'document' }],
    });
    expect(getDocPlaybackDuration(d, { intrinsicDuration: () => 12 })).toBe(60);
  });
});
