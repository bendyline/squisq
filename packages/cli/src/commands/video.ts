/**
 * video command
 *
 * Renders a squisq document to MP4 video by delegating to the
 * programmatic renderDocToMp4 API.
 *
 * Usage:
 *   squisq video <input> [-o output.mp4] [--fps 30] [--quality normal] [--orientation landscape]
 */

import { mkdir } from 'node:fs/promises';
import { dirname, basename, extname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Doc } from '@bendyline/squisq/schemas';
import { readInput } from '../util/readInput.js';
import { renderDocToMp4 } from '../api.js';

import type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';

type CaptionOption = 'off' | 'standard' | 'social';

interface VideoCommandOptions {
  output?: string;
  fps?: string;
  quality?: VideoQuality;
  orientation?: VideoOrientation;
  captions?: CaptionOption;
  width?: string;
  height?: string;
}

const VALID_QUALITIES = ['draft', 'normal', 'high'] as const;
const VALID_ORIENTATIONS = ['landscape', 'portrait'] as const;
const VALID_CAPTIONS = ['off', 'standard', 'social'] as const;

export function registerVideoCommand(program: Command): void {
  program
    .command('video')
    .description('Render a squisq document to MP4 video')
    .argument('<input>', 'Path to .md file, .zip/.dbk container, or folder')
    .argument('[output]', 'Output MP4 path (default: <input>.mp4)')
    .option('-o, --output <path>', 'Output MP4 path (default: <input>.mp4)')
    .option('--fps <number>', 'Frames per second (default: 30)', '30')
    .option(
      '--quality <level>',
      `Encoding quality: ${VALID_QUALITIES.join(', ')} (default: normal)`,
      'normal',
    )
    .option(
      '--orientation <orient>',
      `Video orientation: ${VALID_ORIENTATIONS.join(', ')} (default: landscape)`,
      'landscape',
    )
    .option(
      '--captions <style>',
      `Caption style: ${VALID_CAPTIONS.join(', ')} (default: off)`,
      'off',
    )
    .option('--width <pixels>', 'Override video width')
    .option('--height <pixels>', 'Override video height')
    .action(async (inputPath: string, outputArg: string | undefined, opts: VideoCommandOptions) => {
      try {
        // Positional output arg takes precedence, then -o flag
        if (outputArg && !opts.output) {
          opts.output = outputArg;
        }
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

  // Validate options
  const fps = parseInt(opts.fps ?? '30', 10);
  if (isNaN(fps) || fps < 1 || fps > 120) {
    throw new Error('FPS must be a number between 1 and 120');
  }

  const quality = opts.quality ?? 'normal';
  if (!VALID_QUALITIES.includes(quality as (typeof VALID_QUALITIES)[number])) {
    throw new Error(`Invalid quality "${quality}". Valid: ${VALID_QUALITIES.join(', ')}`);
  }

  const orientation = opts.orientation ?? 'landscape';
  if (!VALID_ORIENTATIONS.includes(orientation as (typeof VALID_ORIENTATIONS)[number])) {
    throw new Error(
      `Invalid orientation "${orientation}". Valid: ${VALID_ORIENTATIONS.join(', ')}`,
    );
  }

  const captions = opts.captions ?? 'off';
  if (!VALID_CAPTIONS.includes(captions as (typeof VALID_CAPTIONS)[number])) {
    throw new Error(`Invalid captions "${captions}". Valid: ${VALID_CAPTIONS.join(', ')}`);
  }
  const captionStyle = captions === 'off' ? undefined : (captions as 'standard' | 'social');

  // Determine output path
  const inputBasename = basename(resolvedInput);
  const inputExt = extname(inputBasename);
  const baseName = inputExt ? inputBasename.slice(0, -inputExt.length) : inputBasename;
  const outputPath = opts.output
    ? resolve(opts.output)
    : resolve(dirname(resolvedInput), `${baseName}.mp4`);

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // ── Step 1: Read input ──────────────────────────────────────────
  console.error(`Reading: ${resolvedInput}`);
  const result = await readInput(resolvedInput);
  const { container } = result;

  // ── Step 2: Get or parse Doc ────────────────────────────────────
  let doc: Doc;
  if (result.doc) {
    console.error('Using pre-built Doc JSON');
    doc = result.doc;
  } else if (result.markdownDoc) {
    const { markdownToDoc } = await import('@bendyline/squisq/doc');
    doc = markdownToDoc(result.markdownDoc);
  } else {
    throw new Error('No document found in input');
  }

  console.error(
    `Rendering: ${fps} fps, quality: ${quality}, orientation: ${orientation}, captions: ${captions}`,
  );

  // ── Step 3: Render via programmatic API ─────────────────────────
  const result2 = await renderDocToMp4(doc, container, {
    outputPath,
    fps,
    quality: quality as VideoQuality,
    orientation: orientation as VideoOrientation,
    width: opts.width ? parseInt(opts.width, 10) : undefined,
    height: opts.height ? parseInt(opts.height, 10) : undefined,
    captionStyle,
    coverPreRoll: 2,
    onProgress: (phase, percent) => {
      writeProgress(phase, percent, 100);
    },
  });

  clearProgress();
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
