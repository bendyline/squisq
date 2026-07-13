/**
 * CLI format registry.
 *
 * The CLI extends the formats package's default registry with `mp4` and `gif`
 * formats so `convert()` can produce rendered media like DOCX/PDF/HTML. These
 * exports are Node-only (Playwright + FFmpeg), which is why they live here
 * rather than in the browser-pure formats package.
 */

import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRegistry } from '@bendyline/squisq-formats';
import type {
  ConversionResult,
  ConvertOptions,
  FormatDefinition,
  FormatRegistry,
  NormalizedInput,
} from '@bendyline/squisq-formats';
import type { GifDither, VideoOrientation, VideoQuality } from '@bendyline/squisq-video';

export interface Mp4FormatOptions {
  onProgress?: (phase: string, percent: number) => void;
  fps?: number;
  quality?: VideoQuality;
  orientation?: VideoOrientation;
  width?: number;
  height?: number;
  captionStyle?: 'standard' | 'social';
  coverPreRoll?: number;
  animationsEnabled?: boolean;
}

/** Per-export options for `convert(..., 'gif')`. */
export interface GifFormatOptions {
  onProgress?: (phase: string, percent: number) => void;
  fps?: number;
  orientation?: VideoOrientation;
  width?: number;
  height?: number;
  captionStyle?: 'standard' | 'social';
  coverPreRoll?: number;
  animationsEnabled?: boolean;
  loop?: number;
  maxColors?: number;
  dither?: GifDither;
  bayerScale?: number;
}

/** Sensible defaults for `convert(..., 'mp4')` — a full-quality landscape clip. */
const MP4_DEFAULTS = {
  fps: 30,
  quality: 'normal' as VideoQuality,
  orientation: 'landscape' as VideoOrientation,
  coverPreRoll: 0,
  animationsEnabled: true,
} as const;

/** Compression-friendly defaults for `convert(..., 'gif')`. */
const GIF_DEFAULTS = {
  fps: 10,
  orientation: 'landscape' as VideoOrientation,
  width: 960,
  height: 540,
  coverPreRoll: 0,
  animationsEnabled: false,
  loop: 0,
  maxColors: 256,
  dither: 'sierra2_4a' as GifDither,
} as const;

/**
 * The `mp4` {@link FormatDefinition}.
 *
 * Export-only: it renders the normalized Doc to a temporary MP4 on disk via
 * {@link renderDocToMp4}, reads the produced file back into a `Uint8Array`, and
 * always deletes the temp file (even on failure). Per-render knobs (fps,
 * quality, orientation, coverPreRoll) can be supplied through
 * `options.formatOptions.mp4`; otherwise {@link MP4_DEFAULTS} apply.
 */
function mp4Format(): FormatDefinition {
  return {
    id: 'mp4',
    label: 'MP4 Video',
    mimeType: 'video/mp4',
    extensions: ['.mp4'],
    async exportDoc(input: NormalizedInput, options: ConvertOptions): Promise<ConversionResult> {
      options.signal?.throwIfAborted();
      // The renderer is lazy-loaded below so api.ts can create this registry
      // without an eager ES-module initialization cycle.
      const mp4Opts = (options.formatOptions?.mp4 ?? {}) as Mp4FormatOptions;
      const fps = typeof mp4Opts.fps === 'number' ? mp4Opts.fps : MP4_DEFAULTS.fps;
      const quality =
        typeof mp4Opts.quality === 'string'
          ? (mp4Opts.quality as VideoQuality)
          : MP4_DEFAULTS.quality;
      const orientation =
        typeof mp4Opts.orientation === 'string'
          ? (mp4Opts.orientation as VideoOrientation)
          : MP4_DEFAULTS.orientation;
      const coverPreRoll =
        typeof mp4Opts.coverPreRoll === 'number' ? mp4Opts.coverPreRoll : MP4_DEFAULTS.coverPreRoll;
      const animationsEnabled =
        typeof mp4Opts.animationsEnabled === 'boolean'
          ? mp4Opts.animationsEnabled
          : MP4_DEFAULTS.animationsEnabled;

      const outputPath = join(tmpdir(), `squisq-mp4-${randomBytes(8).toString('hex')}.mp4`);
      try {
        const { renderDocToMp4 } = await import('./api.js');
        await renderDocToMp4(input.doc, input.container, {
          outputPath,
          fps,
          quality,
          orientation,
          width: mp4Opts.width,
          height: mp4Opts.height,
          captionStyle: mp4Opts.captionStyle,
          coverPreRoll,
          animationsEnabled,
          signal: options.signal,
          onProgress: mp4Opts.onProgress,
        });
        options.signal?.throwIfAborted();
        const data = await readFile(outputPath, { signal: options.signal });
        options.signal?.throwIfAborted();
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return { bytes, mimeType: 'video/mp4', suggestedFilename: '', warnings: [] };
      } finally {
        await rm(outputPath, { force: true });
      }
    },
  };
}

/** The CLI-only animated GIF format definition. */
function gifFormat(): FormatDefinition {
  return {
    id: 'gif',
    label: 'Animated GIF',
    mimeType: 'image/gif',
    extensions: ['.gif'],
    async exportDoc(input: NormalizedInput, options: ConvertOptions): Promise<ConversionResult> {
      options.signal?.throwIfAborted();
      const gifOpts = (options.formatOptions?.gif ?? {}) as GifFormatOptions;
      const orientation =
        typeof gifOpts.orientation === 'string'
          ? (gifOpts.orientation as VideoOrientation)
          : GIF_DEFAULTS.orientation;
      const portrait = orientation === 'portrait';
      const defaultWidth = portrait ? GIF_DEFAULTS.height : GIF_DEFAULTS.width;
      const defaultHeight = portrait ? GIF_DEFAULTS.width : GIF_DEFAULTS.height;
      const outputPath = join(tmpdir(), `squisq-gif-${randomBytes(8).toString('hex')}.gif`);
      try {
        const { renderDocToGif } = await import('./api.js');
        const result = await renderDocToGif(input.doc, input.container, {
          outputPath,
          fps: typeof gifOpts.fps === 'number' ? gifOpts.fps : GIF_DEFAULTS.fps,
          orientation,
          width: typeof gifOpts.width === 'number' ? gifOpts.width : defaultWidth,
          height: typeof gifOpts.height === 'number' ? gifOpts.height : defaultHeight,
          captionStyle: gifOpts.captionStyle,
          coverPreRoll:
            typeof gifOpts.coverPreRoll === 'number'
              ? gifOpts.coverPreRoll
              : GIF_DEFAULTS.coverPreRoll,
          animationsEnabled:
            typeof gifOpts.animationsEnabled === 'boolean'
              ? gifOpts.animationsEnabled
              : GIF_DEFAULTS.animationsEnabled,
          loop: typeof gifOpts.loop === 'number' ? gifOpts.loop : GIF_DEFAULTS.loop,
          maxColors:
            typeof gifOpts.maxColors === 'number' ? gifOpts.maxColors : GIF_DEFAULTS.maxColors,
          dither: gifOpts.dither ?? GIF_DEFAULTS.dither,
          bayerScale: gifOpts.bayerScale,
          signal: options.signal,
          onProgress: gifOpts.onProgress,
        });
        options.signal?.throwIfAborted();
        const data = await readFile(outputPath, { signal: options.signal });
        options.signal?.throwIfAborted();
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return {
          bytes,
          mimeType: 'image/gif',
          suggestedFilename: '',
          warnings: result.warnings,
        };
      } finally {
        await rm(outputPath, { force: true });
      }
    },
  };
}

/**
 * Build the CLI's format registry: every built-in format from
 * `@bendyline/squisq-formats` plus the CLI-only rendered-media exporters.
 */
export function createCliRegistry(): FormatRegistry {
  const registry = defaultRegistry();
  registry.register(mp4Format());
  registry.register(gifFormat());
  return registry;
}
