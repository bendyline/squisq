/**
 * audioTimeline — pure scheduling math.
 *
 * This is the core regression guard: a doc with narration (or timed media
 * audio) must never silently lose audio in the export schedule. It also pins
 * the exact placement math the CLI mix path relies on (sequential narration +
 * absolute media clips, all shifted by the cover pre-roll).
 */

import { describe, it, expect } from 'vitest';
import type { Doc, Block } from '@bendyline/squisq/schemas';
import { computeAudioTimeline } from '../audioTimeline.js';

function block(over: Partial<Block> & Pick<Block, 'id' | 'startTime' | 'duration'>): Block {
  return { audioSegment: 0, layers: [], ...over };
}

function docWith(over: Partial<Doc>): Doc {
  return {
    articleId: 'a',
    duration: 0,
    blocks: [],
    audio: { segments: [] },
    ...over,
  };
}

describe('computeAudioTimeline', () => {
  it('returns [] for a doc with no audio', () => {
    expect(computeAudioTimeline(docWith({}))).toEqual([]);
  });

  it('lays narration segments sequentially', () => {
    const doc = docWith({
      duration: 6,
      audio: {
        segments: [
          { src: 'audio/a.mp3', name: 'intro', duration: 2, startTime: 0 },
          { src: 'audio/b.mp3', name: 'mid', duration: 3, startTime: 2 },
          { src: 'audio/c.mp3', name: 'end', duration: 1, startTime: 5 },
        ],
      },
    });
    expect(computeAudioTimeline(doc)).toEqual([
      { src: 'audio/a.mp3', startSec: 0, sourceInSec: 0, durationSec: 2 },
      { src: 'audio/b.mp3', startSec: 2, sourceInSec: 0, durationSec: 3 },
      { src: 'audio/c.mp3', startSec: 5, sourceInSec: 0, durationSec: 1 },
    ]);
  });

  it('places block-anchored media clips at absolute times with trim windows', () => {
    const doc = docWith({
      duration: 20,
      blocks: [
        block({
          id: 'b1',
          startTime: 10,
          duration: 8,
          media: [
            {
              id: 'clip-1',
              src: 'audio/sfx.mp3',
              kind: 'audio',
              startAt: 2, // 2s into block → absolute 12s
              clipStart: 1.5, // seek 1.5s into the source
              clipEnd: 4.5, // 3s window
              anchor: 'block',
            },
          ],
        }),
      ],
    });
    expect(computeAudioTimeline(doc)).toEqual([
      { src: 'audio/sfx.mp3', startSec: 12, sourceInSec: 1.5, durationSec: 3 },
    ]);
  });

  it('places document-anchored media clips at their absolute start', () => {
    const doc = docWith({
      duration: 30,
      documentMedia: [
        {
          id: 'bg',
          src: 'audio/bed.mp3',
          kind: 'audio',
          startAt: 0,
          clipStart: 0,
          clipEnd: 12,
          anchor: 'document',
        },
      ],
    });
    expect(computeAudioTimeline(doc)).toEqual([
      { src: 'audio/bed.mp3', startSec: 0, sourceInSec: 0, durationSec: 12 },
    ]);
  });

  it('shifts every clip by the cover pre-roll', () => {
    const doc = docWith({
      duration: 4,
      audio: {
        segments: [
          { src: 'audio/a.mp3', name: 'intro', duration: 2, startTime: 0 },
          { src: 'audio/b.mp3', name: 'mid', duration: 2, startTime: 2 },
        ],
      },
      blocks: [
        block({
          id: 'b1',
          startTime: 0,
          duration: 4,
          media: [
            {
              id: 'clip',
              src: 'audio/sfx.mp3',
              kind: 'audio',
              startAt: 1,
              clipEnd: 1, // 1s window
              anchor: 'block',
            },
          ],
        }),
      ],
    });
    const preRoll = 2.5;
    const timeline = computeAudioTimeline(doc, preRoll);
    expect(timeline).toEqual([
      { src: 'audio/a.mp3', startSec: 2.5, sourceInSec: 0, durationSec: 2 },
      { src: 'audio/b.mp3', startSec: 4.5, sourceInSec: 0, durationSec: 2 },
      { src: 'audio/sfx.mp3', startSec: 3.5, sourceInSec: 0, durationSec: 1 },
    ]);
  });

  it('ignores video clips and zero-length audio', () => {
    const doc = docWith({
      duration: 10,
      blocks: [
        block({
          id: 'b1',
          startTime: 0,
          duration: 10,
          media: [
            { id: 'v', src: 'video/clip.mp4', kind: 'video', startAt: 0, anchor: 'block' },
            {
              id: 'z',
              src: 'audio/zero.mp3',
              kind: 'audio',
              startAt: 3,
              clipStart: 2,
              clipEnd: 2, // zero-length window
              anchor: 'block',
            },
          ],
        }),
      ],
    });
    expect(computeAudioTimeline(doc)).toEqual([]);
  });

  it('combines narration and media in one timeline', () => {
    const doc = docWith({
      duration: 5,
      audio: { segments: [{ src: 'audio/n.mp3', name: 'n', duration: 5, startTime: 0 }] },
      documentMedia: [
        {
          id: 'bed',
          src: 'audio/bed.mp3',
          kind: 'audio',
          startAt: 0,
          clipEnd: 5,
          anchor: 'document',
        },
      ],
    });
    const timeline = computeAudioTimeline(doc);
    expect(timeline).toContainEqual({
      src: 'audio/n.mp3',
      startSec: 0,
      sourceInSec: 0,
      durationSec: 5,
    });
    expect(timeline).toContainEqual({
      src: 'audio/bed.mp3',
      startSec: 0,
      sourceInSec: 0,
      durationSec: 5,
    });
  });
});
