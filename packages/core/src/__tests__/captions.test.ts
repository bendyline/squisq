/**
 * Caption construction contract tests.
 *
 * These exercise both precise bookmark timing and the text-estimation fallback
 * so host applications do not need to maintain their own caption algorithms.
 */

import { describe, expect, it } from 'vitest';
import type { AudioSegment } from '../schemas/Doc.js';
import { buildCaptionTrack } from '../timing/index.js';

const segment: AudioSegment = {
  src: 'intro.mp3',
  name: 'intro',
  duration: 8,
  startTime: 12,
};

describe('buildCaptionTrack', () => {
  it('builds word-timed phrases from narration bookmarks', () => {
    const track = buildCaptionTrack([
      {
        segment,
        timing: {
          sourceText: 'One two three four. Five six.',
          duration: 8,
          bookmarks: [
            { id: 'w0', time: 0, charOffset: 0, textFragment: 'One' },
            { id: 'w1', time: 1, charOffset: 4, textFragment: 'two' },
            { id: 'w2', time: 2, charOffset: 8, textFragment: 'three' },
            { id: 'w3', time: 3, charOffset: 14, textFragment: 'four.' },
            { id: 'w4', time: 5, charOffset: 20, textFragment: 'Five' },
            { id: 'w5', time: 6, charOffset: 25, textFragment: 'six.' },
          ],
        },
      },
    ]);

    expect(track.phrases).toHaveLength(2);
    expect(track.phrases[0]).toMatchObject({
      text: 'One two three four.',
      startTime: 12,
      endTime: 17,
      audioSegment: 0,
    });
    expect(track.phrases[0].words).toHaveLength(4);
    expect(track.phrases[1].endTime).toBe(20);
  });

  it('falls back to estimated text timing and includes the spoken prefix', () => {
    const track = buildCaptionTrack(
      [
        {
          segment,
          spokenPrefix: 'A title\n\n',
          text: 'A first sentence. A second sentence with more words.',
        },
      ],
      { version: 4, generatedAt: '2026-09-17T00:00:00.000Z' },
    );

    expect(track.version).toBe(4);
    expect(track.generatedAt).toBe('2026-09-17T00:00:00.000Z');
    expect(track.phrases[0].text).toBe('A title');
    expect(track.phrases[0].startTime).toBe(12);
    expect(track.phrases[track.phrases.length - 1]?.endTime).toBe(19.95);
  });

  it('omits generatedAt unless the caller supplies a deterministic value', () => {
    const track = buildCaptionTrack([{ segment, text: 'Short narration.' }]);
    expect(track).not.toHaveProperty('generatedAt');
  });

  it('clamps prefixes and bookmark timing to the narration segment', () => {
    const prefixed = buildCaptionTrack([
      {
        segment: { ...segment, duration: 1 },
        spokenPrefix: 'A deliberately long spoken heading that exceeds its segment',
        text: 'Body text.',
      },
    ]);
    expect(prefixed.phrases.every((phrase) => phrase.endTime <= 13)).toBe(true);

    const timed = buildCaptionTrack([
      {
        segment,
        timing: {
          sourceText: 'Late word.',
          duration: 40,
          bookmarks: [{ id: 'late', time: 7, charOffset: 0, textFragment: 'word.' }],
        },
      },
    ]);
    expect(timed.phrases[0].endTime).toBe(20);
    expect(timed.phrases[0].words?.[0].endTime).toBe(20);
  });

  it('rejects invalid phrase construction options', () => {
    expect(() => buildCaptionTrack([{ segment, text: 'Text.' }], { wordsPerSecond: 0 })).toThrow(
      'wordsPerSecond',
    );
    expect(() =>
      buildCaptionTrack([{ segment, text: 'Text.' }], {
        minPhraseDuration: 5,
        maxPhraseDuration: 2,
      }),
    ).toThrow('durations');
  });
});
