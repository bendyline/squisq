import { describe, expect, it } from 'vitest';
import { getBlockAtTime } from '../schemas/Doc';
import type { Block } from '../schemas/Doc';

const blocks: Block[] = [
  { id: 'a', startTime: 0, duration: 7.4015734, audioSegment: 0 },
  { id: 'b', startTime: 7.4015734, duration: 11.9, audioSegment: 0 },
];

describe('getBlockAtTime', () => {
  it('returns the block containing the time', () => {
    expect(getBlockAtTime(blocks, 3)?.id).toBe('a');
    expect(getBlockAtTime(blocks, 10)?.id).toBe('b');
  });

  it('lands on a block when a seek to its start reads back a hair early', () => {
    // HTMLMediaElement.currentTime reports microseconds: 7.4015734 → 7.401573.
    expect(getBlockAtTime(blocks, 7.401573)?.id).toBe('b');
  });

  it('keeps the earlier block until just before the boundary', () => {
    expect(getBlockAtTime(blocks, 7.39)?.id).toBe('a');
  });
});
