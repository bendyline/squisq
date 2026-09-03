/**
 * video command
 *
 * Renders a squisq document to MP4 or animated GIF by delegating to the
 * programmatic render APIs.
 *
 * Usage:
 *   squisq video <input> [-o output.mp4|output.gif] [--format mp4|gif]
 *     [--theme <id>] [--transform <style>] [--cover-preroll <seconds>]
 */

import { mkdir } from 'node:fs/promises';
import { dirname, basename, extname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Doc } from '@bendyline/squisq/schemas';
import { readInput } from '../util/readInput.js';
import {
  applyTransformToDoc,
  assertValidThemeId,
  assertValidTransformStyle,
} from '../util/applyTransformPipeline.js';
import { renderDocToGif, renderDocToMp4 } from '../api.js';
import { assertOutputsWritable } from '../util/outputGuard.js';

import type { GifDither, VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
import { validateVideoExportOptions } from '@bendyline/squisq-video';

type CaptionOption = 'off' | 'standard' | 'social';
type VideoOutputFormat = 'mp4' | 'gif';

interface VideoCommandOptions {
  autoTemplates?: boolean;
  output?: string;
  format?: string;
  fps?: string;
  quality?: VideoQuality;
  orientation?: VideoOrientation;
  captions?: CaptionOption;
  width?: string;
  height?: string;
  /** Replace an existing output file instead of refusing to clobber it. */
  overwrite?: boolean;
  theme?: string;
  transform?: string;
  coverPreroll?: string;
  animations?: boolean;
  loop?: string;
  maxColors?: string;
  dither?: string;
  bayerScale?: string;
}

const VALID_QUALITIES = ['draft', 'normal', 'high'] as const;
const VALID_ORIENTATIONS = ['landscape', 'portrait'] as const;
const VALID_CAPTIONS = ['off', 'standard', 'social'] as const;
const VALID_FORMATS = ['mp4', 'gif'] as const;
const VALID_GIF_DITHERS = ['bayer', 'sierra2_4a', 'none'] as const;

export function registerVideoCommand(program: Command): void {
  program
    .command('video')
    .description('Render a squisq document to MP4 video or animated GIF')
    .argument('<input>', 'Path to .md/.json file, .zip/.dbk container, or folder')
    .argument('[output]', 'Output .mp4 or .gif path (default: <input>.<format>)')
    .option('-o, --output <path>', 'Output .mp4 or .gif path (format inferred from extension)')
    .option('--format <format>', `Output format: ${VALID_FORMATS.join(', ')} (default: mp4)`)
    .option('--fps <number>', 'Frames per second (default: 30 for MP4, 10 for GIF)')
    .option(
      '--quality <level>',
      `MP4 encoding quality: ${VALID_QUALITIES.join(', ')} (default: normal)`,
    )
    .option(
      '--orientation <orient>',
      `Video orientation: ${VALID_ORIENTATIONS.join(', ')} (default: landscape)`,
      'landscape',
    )
    .option(
      '--captions <style>',
      `Caption style: ${VALID_CAPTIONS.join(', ')} (default: off for MP4, standard for GIF)`,
    )
    .option(
      '--no-auto-templates',
      'Disable content-aware template auto-picking for unannotated headings',
    )
    .option('-t, --theme <id>', 'Squisq theme ID to apply (e.g., documentary, cinematic, bold)')
    .option(
      '--transform <style>',
      'Transform style to apply before rendering (e.g., documentary, magazine, minimal)',
    )
    .option(
      '--cover-preroll <seconds>',
      'Seconds of cover-slide pre-roll before the story starts (default: 2)',
      '2',
    )
    .option('--width <pixels>', 'Override video width (must be even for MP4)')
    .option('--height <pixels>', 'Override video height (must be even for MP4)')
    .option('--overwrite', 'Replace an existing output file (default: refuse and exit non-zero)')
    .option('--animations', 'Enable slide animations/transitions (GIF default: disabled)')
    .option('--no-animations', 'Disable slide animations/transitions')
    .option('--loop <count>', 'GIF repeat count: 0 forever, -1 no loop (default: 0)')
    .option('--max-colors <count>', 'GIF palette size from 2 to 256 (default: 256)')
    .option(
      '--dither <algorithm>',
      `GIF dithering: ${VALID_GIF_DITHERS.join(', ')} (default: sierra2_4a)`,
    )
    .option('--bayer-scale <number>', 'GIF Bayer dither strength from 0 to 5 (default: 3)')
    .action(async (inputPath: string, outputArg: string | undefined, opts: VideoCommandOptions) => {
      try {
        if (outputArg && opts.output) {
          throw new Error('The positional output and --output cannot be used together.');
        }
        if (outputArg) opts.output = outputArg;
        await runVideo(inputPath, opts);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}

async function runVideo(inputPath: string, opts: VideoCommandOptions): Promise<void> {
  const resolvedInput = resolve(inputPath);

  const requestedFormat = opts.format?.toLowerCase();
  if (
    requestedFormat !== undefined &&
    !VALID_FORMATS.includes(requestedFormat as VideoOutputFormat)
  ) {
    throw new Error(`Invalid format "${requestedFormat}". Valid: ${VALID_FORMATS.join(', ')}`);
  }
  const outputExtension = opts.output ? extname(opts.output).toLowerCase() : '';
  const extensionFormat: VideoOutputFormat | undefined =
    outputExtension === '.gif' ? 'gif' : outputExtension === '.mp4' ? 'mp4' : undefined;
  if (opts.output && !extensionFormat) {
    throw new Error('Output path must end in .mp4 or .gif');
  }
  if (requestedFormat && extensionFormat && requestedFormat !== extensionFormat) {
    throw new Error(
      `Output extension "${outputExtension}" conflicts with --format ${requestedFormat}.`,
    );
  }
  const outputFormat = (requestedFormat ?? extensionFormat ?? 'mp4') as VideoOutputFormat;

  // Resolve format-specific defaults before validating. GIF frame delays are
  // centisecond-based, so rates above 100 cannot be represented precisely.
  const maxFps = outputFormat === 'gif' ? 100 : 120;
  const fps = Number(opts.fps ?? (outputFormat === 'gif' ? '10' : '30'));
  if (!Number.isSafeInteger(fps) || fps < 1 || fps > maxFps) {
    throw new Error(`FPS must be an integer between 1 and ${maxFps}`);
  }

  const quality = opts.quality ?? 'normal';
  if (outputFormat === 'gif' && opts.quality !== undefined) {
    throw new Error('--quality only applies to MP4 output');
  }
  if (!VALID_QUALITIES.includes(quality as (typeof VALID_QUALITIES)[number])) {
    throw new Error(`Invalid quality "${quality}". Valid: ${VALID_QUALITIES.join(', ')}`);
  }

  const orientation = opts.orientation ?? 'landscape';
  if (!VALID_ORIENTATIONS.includes(orientation as (typeof VALID_ORIENTATIONS)[number])) {
    throw new Error(
      `Invalid orientation "${orientation}". Valid: ${VALID_ORIENTATIONS.join(', ')}`,
    );
  }

  // Parse and validate dimension overrides BEFORE reading the document or
  // launching a browser. `--width 851` used to capture every frame — minutes of
  // work — and only then die inside libx264 with "width not divisible by 2",
  // surfaced as an opaque "ffmpeg failed: …".
  // One rule for both formats, matching browser export: dimensions must be even
  // and are rejected, never rounded. (Native GIF could technically take odd
  // sizes, but browser GIF export muxes an H.264 intermediate and cannot — a
  // dimension rule that depends on format and runtime is worse than one rule.)
  const width = opts.width === undefined ? undefined : Number(opts.width);
  const height = opts.height === undefined ? undefined : Number(opts.height);
  validateVideoExportOptions({ width, height, orientation });

  const captions = opts.captions ?? (outputFormat === 'gif' ? 'standard' : 'off');
  if (!VALID_CAPTIONS.includes(captions as (typeof VALID_CAPTIONS)[number])) {
    throw new Error(`Invalid captions "${captions}". Valid: ${VALID_CAPTIONS.join(', ')}`);
  }

  const coverPreRoll = Number(opts.coverPreroll ?? '2');
  if (!Number.isFinite(coverPreRoll) || coverPreRoll < 0) {
    throw new Error('Cover pre-roll must be a number of seconds >= 0');
  }

  const animationsEnabled = opts.animations ?? outputFormat === 'mp4';
  const loop = opts.loop === undefined ? 0 : Number(opts.loop);
  const maxColors = opts.maxColors === undefined ? 256 : Number(opts.maxColors);
  const bayerScale = opts.bayerScale === undefined ? undefined : Number(opts.bayerScale);
  const dither = (opts.dither ?? 'sierra2_4a') as GifDither;
  if (outputFormat === 'mp4' && (opts.loop || opts.maxColors || opts.dither || opts.bayerScale)) {
    throw new Error('--loop, --max-colors, --dither, and --bayer-scale only apply to GIF output');
  }
  if (!Number.isSafeInteger(loop) || loop < -1 || loop > 65_535) {
    throw new Error('GIF loop must be an integer between -1 and 65535');
  }
  if (!Number.isSafeInteger(maxColors) || maxColors < 2 || maxColors > 256) {
    throw new Error('GIF max colors must be an integer between 2 and 256');
  }
  if (!VALID_GIF_DITHERS.includes(dither as (typeof VALID_GIF_DITHERS)[number])) {
    throw new Error(`Invalid GIF dither "${dither}". Valid: ${VALID_GIF_DITHERS.join(', ')}`);
  }
  if (
    bayerScale !== undefined &&
    (!Number.isSafeInteger(bayerScale) || bayerScale < 0 || bayerScale > 5)
  ) {
    throw new Error('GIF Bayer scale must be an integer between 0 and 5');
  }

  // Validate the transform ID up front. The theme id is validated after the
  // doc is read (below), so a custom theme inlined in the doc is admitted
  // rather than rejected as "unknown".
  if (opts.transform) {
    await assertValidTransformStyle(opts.transform);
  }

  // Determine output path
  const inputBasename = basename(resolvedInput);
  const inputExt = extname(inputBasename);
  const baseName = inputExt ? inputBasename.slice(0, -inputExt.length) : inputBasename;
  const outputPath = opts.output
    ? resolve(opts.output)
    : resolve(dirname(resolvedInput), `${baseName}.${outputFormat}`);

  // Refuse to clobber an existing render before spending minutes producing one.
  await assertOutputsWritable([outputPath], opts.overwrite);

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // ── Step 1: Read input ──────────────────────────────────────────
  console.error(`Reading: ${resolvedInput}`);
  const result = await readInput(resolvedInput);
  const { container } = result;

  // Validate the theme id now that we have the doc: accept built-ins AND any
  // custom themes declared by the document itself.
  if (opts.theme) {
    await assertValidThemeId(opts.theme, result);
  }

  // ── Step 2: Get or parse Doc ────────────────────────────────────
  // readInput already resolved a Doc (markdown-shaped inputs use the default
  // auto-templating). Only re-derive when the author explicitly opted out via
  // --no-auto-templates and a markdown source is available.
  let doc: Doc = result.doc;
  if (result.markdownDoc) {
    if (opts.autoTemplates === false) {
      const { markdownToDoc, resolveAudioMapping, resolveDataReferences } =
        await import('@bendyline/squisq/doc');
      // Re-deriving from markdown discards readInput's audio and data
      // resolution (narration timing + segment mapping + sidecar previews)
      // — re-run both.
      const { defaultDataReaders } = await import('@bendyline/squisq-formats/data');
      const audioDoc = await resolveAudioMapping(
        markdownToDoc(result.markdownDoc, { autoTemplates: false }),
        container,
      );
      doc = (await resolveDataReferences(audioDoc, container, { readers: defaultDataReaders() }))
        .doc;
    }
  } else {
    console.error('Using pre-built Doc JSON');
  }

  // Apply transform / theme before rendering, mirroring how convert threads
  // them to its exporters.
  if (opts.transform) {
    doc = await applyTransformToDoc(doc, opts.transform, opts.theme);
    console.error(`  Applied transform: ${opts.transform}`);
  }
  if (opts.theme) {
    doc = { ...doc, themeId: opts.theme };
  }

  const motionLabel = animationsEnabled ? 'animations on' : 'animations off';
  const qualityLabel = outputFormat === 'mp4' ? `, quality: ${quality}` : '';
  console.error(
    `Rendering ${outputFormat.toUpperCase()}: ${fps} fps${qualityLabel}, orientation: ${orientation}, captions: ${captions}, ${motionLabel}`,
  );

  // ── Step 3: Render via programmatic API ─────────────────────────
  const sharedRenderOptions = {
    outputPath,
    fps,
    orientation: orientation as VideoOrientation,
    width,
    height,
    captionStyle: captions,
    coverPreRoll,
    animationsEnabled,
    onProgress: (phase: string, percent: number) => writeProgress(phase, percent, 100),
  };
  const result2 =
    outputFormat === 'gif'
      ? await renderDocToGif(doc, container, {
          ...sharedRenderOptions,
          loop,
          maxColors,
          dither,
          bayerScale,
        })
      : await renderDocToMp4(doc, container, {
          ...sharedRenderOptions,
          quality: quality as VideoQuality,
        });

  clearProgress();
  const warnings = 'warnings' in result2 && Array.isArray(result2.warnings) ? result2.warnings : [];
  for (const warning of warnings) {
    console.error(`  ⚠ ${warning}`);
  }
  console.error(
    `  ✓ ${outputPath} (${result2.duration.toFixed(1)}s, ${result2.frameCount} frames)`,
  );
  console.error('Done.');
}

// ── Progress helpers ──────────────────────────────────────────────

const BAR_WIDTH = 30;

function writeProgress(label: string, current: number, total: number, detail?: string): void {
  const pct = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const suffix = detail ? ` (${detail})` : '';
  process.stderr.write(`\r  ${label}: ${bar} ${pct}%${suffix}  `);
}

function clearProgress(): void {
  process.stderr.write('\r' + ' '.repeat(80) + '\r');
}
