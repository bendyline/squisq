import { describe, it, expect } from 'vitest';
import { ffmpegVideoQualityArgs, audioBitrateArg, ffmpegAudioMuxArgs } from '../ffmpegArgs.js';
import { QUALITY_PRESETS, type VideoQuality } from '../types.js';

const LEVELS: VideoQuality[] = ['draft', 'normal', 'high'];

describe('ffmpegVideoQualityArgs', () => {
  it('derives -preset/-crf from QUALITY_PRESETS for every quality', () => {
    for (const level of LEVELS) {
      const preset = QUALITY_PRESETS[level];
      expect(ffmpegVideoQualityArgs(level)).toEqual([
        '-preset',
        preset.preset,
        '-crf',
        String(preset.crf),
      ]);
    }
  });

  it('pins the exact historical preset/crf pairs', () => {
    expect(ffmpegVideoQualityArgs('draft')).toEqual(['-preset', 'ultrafast', '-crf', '28']);
    expect(ffmpegVideoQualityArgs('normal')).toEqual(['-preset', 'medium', '-crf', '23']);
    expect(ffmpegVideoQualityArgs('high')).toEqual(['-preset', 'slow', '-crf', '18']);
  });
});

describe('audioBitrateArg', () => {
  it('derives the AAC bitrate flag from QUALITY_PRESETS.audioBitrate', () => {
    for (const level of LEVELS) {
      expect(audioBitrateArg(level)).toBe(`${QUALITY_PRESETS[level].audioBitrate / 1000}k`);
    }
  });

  it('yields 96k / 128k / 192k for draft / normal / high', () => {
    expect(audioBitrateArg('draft')).toBe('96k');
    expect(audioBitrateArg('normal')).toBe('128k');
    expect(audioBitrateArg('high')).toBe('192k');
  });
});

describe('ffmpegAudioMuxArgs', () => {
  it('pads short audio before using -shortest so video is never truncated', () => {
    expect(ffmpegAudioMuxArgs('128k')).toEqual([
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-af',
      'apad',
      '-shortest',
    ]);
  });

  it('accepts the numeric bitrates used by the browser audio path', () => {
    expect(ffmpegAudioMuxArgs(192000)).toContain('192000');
  });
});
