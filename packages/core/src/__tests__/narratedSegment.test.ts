import { describe, expect, it } from 'vitest';
import { transformNarratedSegment } from '../transform/narratedSegment.js';

describe('transformNarratedSegment', () => {
  it('creates a deterministic, audio-timed Doc from narration text', () => {
    const input = {
      articleId: 'volcano',
      segmentId: 'intro',
      title: 'Volcano',
      text: 'The crater rises 4,000 feet above the coast. It last erupted in 1984.',
      duration: 24,
      audioSrc: 'intro.mp3',
      includeTitleBlock: true,
      images: [{ src: 'crater.jpg', alt: 'The volcanic crater' }],
    };
    const first = transformNarratedSegment(input, { seed: 7 });
    const second = transformNarratedSegment(input, { seed: 7 });

    expect(first.seed).toBe(7);
    expect(first.doc.blocks).toEqual(second.doc.blocks);
    expect(first.doc.audio.segments[0].src).toBe('intro.mp3');
    expect(first.doc.blocks[0].startTime).toBe(0);
    const end = first.doc.blocks[first.doc.blocks.length - 1]!;
    expect(end.startTime + end.duration).toBeCloseTo(24);
  });

  it('interleaves generic video clips into the transformed sequence', () => {
    const result = transformNarratedSegment({
      articleId: 'harbor',
      segmentId: 'history',
      title: 'History',
      text: 'The harbor grew rapidly after the railway arrived in 1901.',
      duration: 16,
      audioSrc: 'history.mp3',
      videos: [{ src: 'harbor.mp4', clipStart: 10, clipEnd: 18, alt: 'Historic harbor' }],
    });
    expect(result.doc.blocks.some((block) => block.template === 'videoWithCaption')).toBe(true);
  });
});
