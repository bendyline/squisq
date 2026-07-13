import { describe, it, expect } from 'vitest';
import {
  ffmpegVideoQualityArgs,
  audioBitrateArg,
  ffmpegAudioMuxArgs,
  ffmpegGifFilterGraph,
  ffmpegGifOutputArgs,
} from '../ffmpegArgs.js';
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

describe('animated GIF arguments', () => {
  it('builds a global diff palette and changed-rectangle palette application', () => {
    const graph = ffmpegGifFilterGraph({ width: 960, height: 540 });
    expect(graph).toContain('scale=960:540:force_original_aspect_ratio=decrease:flags=lanczos');
    expect(graph).toContain('palettegen=stats_mode=diff:max_colors=256:reserve_transparent=0');
    expect(graph).toContain('paletteuse=dither=sierra2_4a:diff_mode=rectangle');
  });

  it('supports deterministic Bayer dithering and finite looping', () => {
    const args = ffmpegGifOutputArgs({
      width: 640,
      height: 360,
      maxColors: 128,
      dither: 'bayer',
      bayerScale: 4,
      loop: 3,
    });
    expect(args).toContain('[gif_out]');
    expect(args).toContain('3');
    expect(args.join(' ')).toContain('max_colors=128');
    expect(args.join(' ')).toContain('dither=bayer:bayer_scale=4');
  });

  it('rejects invalid palette and loop settings before launching FFmpeg', () => {
    expect(() => ffmpegGifFilterGraph({ width: 0, height: 540 })).toThrow('GIF width');
    expect(() => ffmpegGifFilterGraph({ width: 960, height: 540, maxColors: 257 })).toThrow(
      'maxColors',
    );
    expect(() => ffmpegGifOutputArgs({ width: 960, height: 540, loop: -2 })).toThrow('GIF loop');
  });
});
