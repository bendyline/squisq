import { describe, expect, it } from 'vitest';
import { buildTimingJson, encodeTimingJson, timingPathFor } from '../timingJson.js';

describe('buildTimingJson', () => {
  it('returns a payload matching what resolveAudioMapping() expects', () => {
    const timing = buildTimingJson('Hello world.', 12.5);
    expect(timing).toEqual({
      sourceText: 'Hello world.',
      duration: 12.5,
      bookmarks: [],
    });
  });

  it('coerces missing or negative durations to 0', () => {
    expect(buildTimingJson('script', Number.NaN).duration).toBe(0);
    expect(buildTimingJson('script', -5).duration).toBe(0);
    expect(buildTimingJson('script', Number.POSITIVE_INFINITY).duration).toBe(0);
  });

  it('treats empty sourceText as an empty string, not undefined', () => {
    expect(buildTimingJson('', 1).sourceText).toBe('');
  });
});

describe('encodeTimingJson', () => {
  it('emits valid pretty-printed JSON', () => {
    const bytes = encodeTimingJson(buildTimingJson('Hi.', 3));
    const text = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toEqual({ sourceText: 'Hi.', duration: 3, bookmarks: [] });
    // Pretty-printed means newlines and indentation are present.
    expect(text).toContain('\n');
  });
});

describe('timingPathFor', () => {
  it('appends .timing.json to the audio path verbatim', () => {
    expect(timingPathFor('audio/narration.webm')).toBe('audio/narration.webm.timing.json');
    expect(timingPathFor('intro.mp3')).toBe('intro.mp3.timing.json');
  });
});
