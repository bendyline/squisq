/**
 * CLI format registry.
 *
 * The CLI extends the formats package's default registry with an `mp4` format
 * so `convert()` can produce video the same way it produces DOCX/PDF/HTML. MP4
 * export is Node-only (it needs Playwright + FFmpeg), which is why it lives
 * here in the CLI rather than in the browser-pure formats package.
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
import type { VideoOrientation, VideoQuality } from '@bendyline/squisq-video';

export interface Mp4FormatOptions {
  fps?: number;
  quality?: VideoQuality;
  orientation?: VideoOrientation;
  coverPreRoll?: number;
}

/** Sensible defaults for `convert(..., 'mp4')` — a full-quality landscape clip. */
const MP4_DEFAULTS = {
  fps: 30,
  quality: 'normal' as VideoQuality,
  orientation: 'landscape' as VideoOrientation,
  coverPreRoll: 0,
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

      const outputPath = join(tmpdir(), `squisq-mp4-${randomBytes(8).toString('hex')}.mp4`);
      try {
        const { renderDocToMp4 } = await import('./api.js');
        await renderDocToMp4(input.doc, input.container, {
          outputPath,
          fps,
          quality,
          orientation,
          coverPreRoll,
        });
        const data = await readFile(outputPath);
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return { bytes, mimeType: 'video/mp4', suggestedFilename: '', warnings: [] };
      } finally {
        await rm(outputPath, { force: true });
      }
    },
  };
}

/**
 * Build the CLI's format registry: every built-in format from
 * `@bendyline/squisq-formats` plus the CLI-only `mp4` exporter.
 */
export function createCliRegistry(): FormatRegistry {
  const registry = defaultRegistry();
  registry.register(mp4Format());
  return registry;
}
