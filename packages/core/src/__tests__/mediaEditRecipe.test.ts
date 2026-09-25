import { describe, expect, it } from 'vitest';
import {
  formatMediaNumber,
  mediaEditHtmlAttribute,
  mediaEditValuesFromAttributes,
  mediaEditValuesFromParams,
  mediaRenderKey,
  normalizeMediaCrop,
  normalizeMediaCuts,
  parseMediaCrop,
  parseMediaCuts,
  parseMediaEdits,
  parseMediaFx,
  serializeMediaEdits,
  serializeMediaFx,
} from '../mediaEdit/recipe.js';

describe('parseMediaFx', () => {
  it('orders ops into the fixed chain and fills defaults', () => {
    const chain = parseMediaFx('loudness denoise highpass:100');
    expect(chain?.ops).toEqual([
      { id: 'highpass', value: 100 },
      { id: 'denoise', value: 0.8 },
      { id: 'loudness', value: -16 },
    ]);
    expect(chain?.unknown).toEqual([]);
  });

  it('clamps values into range and reads debreath as attenuation', () => {
    const chain = parseMediaFx('highpass:5 denoise:3 debreath:15 loudness:-60');
    expect(chain?.ops).toEqual([
      { id: 'highpass', value: 20 },
      { id: 'denoise', value: 1 },
      { id: 'debreath', value: -15 },
      { id: 'loudness', value: -31 },
    ]);
  });

  it('keeps unknown ops and unparseable values verbatim instead of guessing', () => {
    const chain = parseMediaFx('deess:4 denoise:lots, loudness:-14');
    expect(chain?.ops).toEqual([{ id: 'loudness', value: -14 }]);
    expect(chain?.unknown).toEqual(['deess:4', 'denoise:lots']);
  });

  it('lets the last duplicate win', () => {
    expect(parseMediaFx('denoise:0.2 denoise:0.6')?.ops).toEqual([{ id: 'denoise', value: 0.6 }]);
  });

  it('returns null for an empty value', () => {
    expect(parseMediaFx('  ')).toBeNull();
    expect(parseMediaFx(undefined)).toBeNull();
  });

  it('serializes canonically with explicit values, unknown tokens last', () => {
    const chain = parseMediaFx('deess:4 loudness denoise:0.50')!;
    expect(serializeMediaFx(chain)).toBe('denoise:0.5 loudness:-16 deess:4');
  });
});

describe('cuts', () => {
  it('parses seconds, mm:ss and ms forms, sorted and merged', () => {
    expect(parseMediaCuts('40.2-41 12.4-13.1,13-13.5 1:02-1:03.5 900ms-1000ms')).toEqual([
      { start: 0.9, end: 1 },
      { start: 12.4, end: 13.5 },
      { start: 40.2, end: 41 },
      { start: 62, end: 63.5 },
    ]);
  });

  it('drops invalid and empty ranges', () => {
    expect(parseMediaCuts('5-4 abc 3-3')).toBeNull();
    expect(parseMediaCuts('5-4 1-2')).toEqual([{ start: 1, end: 2 }]);
  });

  it('clamps to a trim window', () => {
    expect(
      normalizeMediaCuts(
        [
          { start: 0, end: 2 },
          { start: 9, end: 30 },
        ],
        1,
        10,
      ),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 9, end: 10 },
    ]);
  });
});

describe('crop', () => {
  it('parses a normalized rectangle', () => {
    expect(parseMediaCrop('0.1 0.05 0.8 0.9')).toEqual({ x: 0.1, y: 0.05, w: 0.8, h: 0.9 });
  });

  it('clamps inside the frame and treats full frame as no crop', () => {
    expect(normalizeMediaCrop({ x: 0.5, y: 0, w: 0.9, h: 1 })).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 1,
    });
    expect(parseMediaCrop('0 0 1 1')).toBeNull();
    expect(parseMediaCrop('0 0 1')).toBeNull();
  });
});

describe('parseMediaEdits / serializeMediaEdits', () => {
  it('round-trips a full recipe through annotation params', () => {
    const edits = parseMediaEdits(
      mediaEditValuesFromParams({
        src: 'x.webm',
        fx: 'denoise:0.8 loudness:-16',
        cuts: '1-2',
        gain: '-2.5',
        fadeIn: '0.3',
        fadeOut: '0.5',
        crop: '0.1 0.1 0.8 0.8',
        group: 'rec-a1',
      }),
    );
    expect(edits).toEqual({
      fx: {
        ops: [
          { id: 'denoise', value: 0.8 },
          { id: 'loudness', value: -16 },
        ],
        unknown: [],
      },
      cuts: [{ start: 1, end: 2 }],
      gain: -2.5,
      fadeIn: 0.3,
      fadeOut: 0.5,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      group: 'rec-a1',
    });
    expect(serializeMediaEdits(edits)).toEqual({
      fx: 'denoise:0.8 loudness:-16',
      cuts: '1-2',
      gain: '-2.5',
      fadeIn: '0.3',
      fadeOut: '0.5',
      crop: '0.1 0.1 0.8 0.8',
      group: 'rec-a1',
    });
  });

  it('drops neutral and invalid values, returning undefined when nothing remains', () => {
    expect(parseMediaEdits({ gain: '0', fadeIn: '0', crop: '0 0 1 1', group: 'bad id!' })).toBe(
      undefined,
    );
  });

  it('maps every key to null for an absent recipe (so writers can clear attributes)', () => {
    expect(Object.values(serializeMediaEdits(undefined)).every((v) => v === null)).toBe(true);
  });

  it('reads the HTML attribute spelling', () => {
    expect(mediaEditHtmlAttribute('video', 'fadeIn')).toBe('data-squisq-video-fade-in');
    const values = mediaEditValuesFromAttributes('audio', {
      'data-squisq-audio-fx': 'loudness',
      'data-squisq-audio-fade-out': '1',
      'data-squisq-video-fx': 'denoise',
    });
    expect(values).toEqual({ fx: 'loudness', fadeOut: '1' });
  });
});

describe('mediaRenderKey', () => {
  it('is stable, 12 hex digits, and ignores token order and unknown ops', () => {
    const a = mediaRenderKey('take.webm', parseMediaFx('denoise loudness')!);
    const b = mediaRenderKey('take.webm', parseMediaFx('loudness:-16 deess denoise:0.8')!);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).toBe(b);
  });

  it('changes with the source or any op value', () => {
    const base = mediaRenderKey('take.webm', parseMediaFx('denoise:0.8')!);
    expect(mediaRenderKey('other.webm', parseMediaFx('denoise:0.8')!)).not.toBe(base);
    expect(mediaRenderKey('take.webm', parseMediaFx('denoise:0.7')!)).not.toBe(base);
  });
});

describe('formatMediaNumber', () => {
  it('is compact and never negative zero', () => {
    expect(formatMediaNumber(1.23456)).toBe('1.235');
    expect(formatMediaNumber(2)).toBe('2');
    expect(formatMediaNumber(-0.0001)).toBe('0');
  });
});
