import { describe, it, expect } from 'vitest';
import { buildNarrationTimingJson, parseNarrationTimingJson } from '../narration/sidecar';
import { alignNarration } from '../narration/align';
import { scriptFromMarkdown, takeFromScript } from './narrationTestSignals';

const script = scriptFromMarkdown('# One\n\nAlpha beta gamma.\n\n# Two\n\nDelta epsilon zeta.');

/** The legacy v1 gate from audioMapping.parseTimingJson. */
function passesLegacyGate(payload: unknown): boolean {
  const p = payload as { sourceText?: unknown; duration?: unknown };
  return typeof p.sourceText === 'string' && typeof p.duration === 'number';
}

describe('narration sidecar v3', () => {
  const take = takeFromScript(script, 150, 48000, 31);
  const alignment = alignNarration({ pcm: take.pcm, sampleRate: 48000, script });
  const sidecar = buildNarrationTimingJson(script, alignment, take.durationSec, { baseWpm: 150 });

  it('build → parse round-trips', () => {
    const parsed = parseNarrationTimingJson(JSON.stringify(sidecar));
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(3);
    expect(parsed!.sourceText).toBe(script.sourceText);
    expect(parsed!.bookmarks.length).toBe(script.tokens.length);
    expect(parsed!.blocks.length).toBe(script.blocks.length);
    expect(parsed!.generator?.method).toBe('dsp-align');
  });

  it('fills bookmarks with real char offsets and monotonic times', () => {
    for (let i = 0; i < sidecar.bookmarks.length; i++) {
      const bookmark = sidecar.bookmarks[i];
      expect(bookmark.charOffset).toBe(script.tokens[i].charOffset);
      expect(bookmark.textFragment).toBe(script.tokens[i].text);
      if (i > 0) expect(bookmark.time).toBeGreaterThanOrEqual(sidecar.bookmarks[i - 1].time);
    }
  });

  it('v3 payloads still pass the legacy v1 parser gate (superset contract)', () => {
    expect(passesLegacyGate(JSON.parse(JSON.stringify(sidecar)))).toBe(true);
  });

  it('parses v1 payloads with empty blocks', () => {
    const v1 = { sourceText: 'hello world', duration: 12.5, bookmarks: [] };
    const parsed = parseNarrationTimingJson(JSON.stringify(v1));
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(3);
    expect(parsed!.blocks).toEqual([]);
    expect(parsed!.duration).toBe(12.5);
  });

  it('rejects malformed payloads', () => {
    expect(parseNarrationTimingJson('not json')).toBeNull();
    expect(parseNarrationTimingJson('{"duration": 3}')).toBeNull();
    expect(parseNarrationTimingJson('{"sourceText": "x", "duration": "3"}')).toBeNull();
    expect(parseNarrationTimingJson('null')).toBeNull();
  });

  it('sorts and clamps hand-edited block ranges defensively', () => {
    const messy = {
      sourceText: 'a b c',
      duration: 10,
      blocks: [
        { blockIndex: 1, charStart: 2, charEnd: 4, startSec: 6, endSec: 5 },
        { blockIndex: 0, charStart: 0, charEnd: 2, startSec: 2, endSec: 4 },
        { blockIndex: 2, charStart: 4, charEnd: 5, startSec: 'bad', endSec: 9 },
      ],
    };
    const parsed = parseNarrationTimingJson(JSON.stringify(messy));
    expect(parsed).not.toBeNull();
    expect(parsed!.blocks.length).toBe(2); // the malformed one is dropped
    expect(parsed!.blocks[0].startSec).toBe(2);
    expect(parsed!.blocks[1].startSec).toBe(6);
    expect(parsed!.blocks[1].endSec).toBe(6); // endSec clamped to startSec
  });

  it('drops non-finite bookmark entries instead of failing the file', () => {
    const payload = {
      sourceText: 'a b',
      duration: 5,
      bookmarks: [
        { id: 'w0', time: 0.5, charOffset: 0 },
        { id: 'bad', time: Number.NaN, charOffset: 2 },
      ],
    };
    const parsed = parseNarrationTimingJson(JSON.stringify(payload));
    expect(parsed!.bookmarks.length).toBe(1);
  });

  /**
   * `cameraOffsetSec` is a start SKEW (`cameraStart - audioStart`), not a
   * duration, and it is genuinely signed: the camera and mic are independent
   * `MediaRecorder` pipelines whose `onstart` events fire asynchronously, so an
   * already-warm camera can begin BEFORE the mic. Validating it as
   * non-negative silently discarded those takes' offsets on reload, and the
   * inline camera video then played with uncorrected skew.
   */
  describe('cameraOffsetSec round-trips as a signed skew', () => {
    const build = (offset: number): string =>
      JSON.stringify(
        buildNarrationTimingJson(script, alignment, take.durationSec, {
          cameraOffsetSec: offset,
        }),
      );

    it.each([
      ['camera started after the mic', 0.42],
      ['camera started before the mic', -0.42],
      ['no skew', 0],
    ])('%s', (_name, offset) => {
      const parsed = parseNarrationTimingJson(build(offset));
      expect(parsed?.cameraOffsetSec).toBe(offset);
    });

    it('omits a non-finite offset rather than emitting a field that parses away', () => {
      // JSON has no NaN — it would serialize to `null` and be dropped on read.
      const json = buildNarrationTimingJson(script, alignment, take.durationSec, {
        cameraOffsetSec: Number.NaN,
      });
      expect(json.cameraOffsetSec).toBeUndefined();
      expect(JSON.stringify(json)).not.toContain('cameraOffsetSec');
    });

    it('ignores a non-numeric offset in a hand-edited file', () => {
      const parsed = parseNarrationTimingJson(
        JSON.stringify({ sourceText: 'a b', duration: 5, cameraOffsetSec: 'soon' }),
      );
      expect(parsed).not.toBeNull();
      expect(parsed!.cameraOffsetSec).toBeUndefined();
    });
  });
});
