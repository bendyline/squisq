import { describe, expect, it } from 'vitest';
import {
  calculateKeywordAffinity,
  extractKeywords,
  matchByKeywordAffinity,
  selectSafeZoneClips,
  selectTranscriptClips,
} from '../generate/mediaMatching.js';

describe('media matching', () => {
  it('extracts words and weighted bigrams', () => {
    const keywords = extractKeywords('A volcanic crater above the coastal city.');
    expect(keywords).toContain('volcanic_crater');
    expect(keywords).not.toContain('the');
    expect(calculateKeywordAffinity(keywords, ['volcanic_crater'])).toBe(1);
  });

  it('greedily assigns media once while respecting target capacity', () => {
    const result = matchByKeywordAffinity(
      [['harbor'], ['mountain'], ['harbor']],
      [
        { key: 'coast', keywords: ['harbor'], capacity: 1 },
        { key: 'summit', keywords: ['mountain'], capacity: 1 },
      ],
    );
    expect(result.assignments.map((item) => item.targetKey)).toEqual(['coast', 'summit']);
    expect(result.unmatchedMedia).toEqual([2]);
  });

  it('selects deterministic clips inside a safe zone', () => {
    const clips = selectSafeZoneClips({ src: 'video.mp4', duration: 100 }, { seed: 7 });
    expect(clips).toHaveLength(3);
    expect(clips).toEqual(selectSafeZoneClips({ src: 'video.mp4', duration: 100 }, { seed: 7 }));
    expect(clips.every((clip) => clip.clipStart >= 10 && clip.clipEnd <= 90)).toBe(true);
  });

  it('centers a clip on the best transcript match', () => {
    const clips = selectTranscriptClips(
      { src: 'video.mp4', duration: 100 },
      [
        { startTime: 20, endTime: 24, text: 'city traffic' },
        { startTime: 55, endTime: 60, text: 'volcanic crater summit' },
      ],
      'The volcanic crater',
      { clipCount: 1 },
    );
    expect(clips[0].clipStart).toBeGreaterThanOrEqual(49);
    expect(clips[0].clipEnd).toBeLessThanOrEqual(66);
  });
});
