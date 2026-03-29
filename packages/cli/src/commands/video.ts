/**
 * video command
 *
 * Renders a squisq document to MP4 video by:
 * 1. Parsing the input (markdown, container, or folder)
 * 2. Generating a self-contained render HTML
 * 3. Capturing frames via Playwright headless browser
 * 4. Encoding to MP4 using native ffmpeg (fast) or ffmpeg.wasm (fallback)
 *
 * Usage:
 *   squisq video <input> [-o output.mp4] [--fps 30] [--quality normal] [--orientation landscape]
 */

import { mkdir } from 'node:fs/promises';
import { dirname, basename, extname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Doc } from '@bendyline/squisq/schemas';
import { readInput } from '../util/readInput.js';
import { detectFfmpeg } from '../util/detectFfmpeg.js';

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
    // Input was JSON or container/folder with doc.json — use directly
    console.error('Using pre-built Doc JSON');
    doc = result.doc;
  } else if (result.markdownDoc) {
    const { markdownToDoc } = await import('@bendyline/squisq/doc');
    doc = markdownToDoc(result.markdownDoc);
  } else {
    throw new Error('No document found in input');
  }

  // ── Step 3: Collect media from container ────────────────────────
  const { collectImagePaths } = await import('@bendyline/squisq-formats/html');
  const imagePaths = collectImagePaths(doc);
  const images = new Map<string, ArrayBuffer>();
  for (const imgPath of imagePaths) {
    const data = await container.readFile(imgPath);
    if (data) {
      images.set(imgPath, data);
    }
  }

  // Collect audio segments
  const audio = new Map<string, ArrayBuffer>();
  const audioBuffers: ArrayBuffer[] = [];
  if (doc.audio?.segments?.length) {
    for (const seg of doc.audio.segments) {
      const data = await container.readFile(seg.src);
      if (data) {
        audio.set(seg.src, data);
        // Also map by name for the audio URL rewriting in the player
        audio.set(seg.name, data);
        audioBuffers.push(data);
      }
    }
  }

  // Concatenate audio segments for the final MP4's audio track.
  // The render HTML player handles multi-segment playback internally,
  // but the encoder needs a single audio track for muxing.
  let concatenatedAudio: Uint8Array | null = null;
  if (audioBuffers.length > 0) {
    concatenatedAudio = await concatenateAudioBuffers(audioBuffers);
  }

  // ── Step 4: Generate render HTML ────────────────────────────────
  const { generateRenderHtml } = await import('@bendyline/squisq-video');
  const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
  const { resolveDimensions } = await import('@bendyline/squisq-video');

  const dimensions = resolveDimensions({
    orientation,
    width: opts.width ? parseInt(opts.width, 10) : undefined,
    height: opts.height ? parseInt(opts.height, 10) : undefined,
  });

  const renderHtml = generateRenderHtml(doc, {
    playerScript: PLAYER_BUNDLE,
    images,
    audio: audio.size > 0 ? audio : undefined,
    width: dimensions.width,
    height: dimensions.height,
    captionStyle,
  });

  console.error(
    `Viewport: ${dimensions.width}x${dimensions.height}, ${fps} fps, quality: ${quality}, captions: ${captions}`,
  );

  // ── Step 5: Capture frames via Playwright ───────────────────────
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: dimensions.width, height: dimensions.height },
  });

  // Capture page errors so they don't vanish silently
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  // Load the render HTML — use 'load' since everything is inline (no network)
  await page.setContent(renderHtml, { waitUntil: 'load' });

  // Give React one frame to mount and run useEffect
  await page.waitForTimeout(500);

  // Wait for the render API to be available
  try {
    await page.waitForFunction(
      () => typeof (window as unknown as Record<string, unknown>).getDuration === 'function',
      { timeout: 15000 },
    );
  } catch {
    await browser.close();
    const errorDetail = pageErrors.length
      ? `\nPage errors:\n  ${pageErrors.join('\n  ')}`
      : '\nNo page errors captured — the player may have failed to mount.';
    throw new Error(`Render API did not initialize within 15 seconds.${errorDetail}`);
  }

  // Get duration from the player
  const duration: number = await page.evaluate(() => {
    return (window as unknown as { getDuration: () => number }).getDuration();
  });

  if (duration <= 0) {
    await browser.close();
    throw new Error('Document has zero duration — nothing to render');
  }

  const totalFrames = Math.ceil(duration * fps);
  console.error(`Duration: ${duration.toFixed(1)}s, ${totalFrames} frames to capture`);

  const frames: Uint8Array[] = [];
  const frameInterval = 1 / fps;

  // Optional: render cover frame (time 0)
  const hasCover: boolean = await page.evaluate(() => {
    const w = window as unknown as { hasCoverBlock?: () => boolean };
    return typeof w.hasCoverBlock === 'function' ? w.hasCoverBlock() : false;
  });

  if (hasCover) {
    const coverFrameCount = 2 * fps;
    await page.evaluate(() => {
      (window as unknown as { showCover: () => void }).showCover();
    });
    await page.waitForTimeout(100);
    const coverScreenshot = await page.screenshot({ type: 'png' });
    const coverFrame = new Uint8Array(coverScreenshot);
    for (let i = 0; i < coverFrameCount; i++) {
      frames.push(coverFrame);
    }
    await page.evaluate(() => {
      (window as unknown as { hideCover: () => void }).hideCover();
    });
    writeProgress('Capturing', coverFrameCount, totalFrames + coverFrameCount);
  }

  // Capture animation frames
  const totalWithCover = totalFrames + frames.length;
  for (let i = 0; i < totalFrames; i++) {
    const time = i * frameInterval;

    await page.evaluate((t: number) => {
      return (window as unknown as { seekTo: (t: number) => Promise<void> }).seekTo(t);
    }, time);

    const screenshot = await page.screenshot({ type: 'png' });
    frames.push(new Uint8Array(screenshot));

    if (i % Math.max(1, Math.floor(fps / 2)) === 0 || i === totalFrames - 1) {
      writeProgress('Capturing', frames.length, totalWithCover);
    }
  }

  clearProgress();
  await browser.close();

  // ── Step 6: Encode to MP4 ───────────────────────────────────────
  const ffmpegPath = await detectFfmpeg();

  const exportOptions = {
    fps,
    quality: quality as VideoQuality,
    orientation: orientation as VideoOrientation,
    width: dimensions.width,
    height: dimensions.height,
    onProgress: (percent: number, phase: string) => {
      writeProgress('Encoding', percent, 100, phase);
    },
  };

  if (ffmpegPath) {
    console.error(`Using native ffmpeg: ${ffmpegPath}`);
    const { framesToMp4Native } = await import('../util/nativeEncoder.js');
    await framesToMp4Native(ffmpegPath, frames, concatenatedAudio, outputPath, exportOptions);
  } else {
    throw new Error(
      'ffmpeg is required but not found in PATH.\n' +
        'Install it with:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Windows: winget install ffmpeg',
    );
  }

  clearProgress();
  console.error(`  ✓ ${outputPath}`);
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

// ── Audio concatenation ───────────────────────────────────────────

/**
 * Concatenate multiple audio segment buffers into a single buffer.
 *
 * Uses native ffmpeg (via concat demuxer) when available for proper
 * gapless concatenation. Falls back to naive byte concatenation which
 * works for MP3 (frame-based format) but may introduce minor artifacts.
 */
async function concatenateAudioBuffers(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  if (buffers.length === 0) return new Uint8Array(0);
  if (buffers.length === 1) return new Uint8Array(buffers[0]);

  // Try native ffmpeg concat for proper gapless audio
  const ffmpegPath = await detectFfmpeg();
  if (ffmpegPath) {
    return concatenateAudioNative(ffmpegPath, buffers);
  }

  // Fallback: naive byte concatenation (works for MP3)
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

/**
 * Concatenate audio buffers using native ffmpeg concat demuxer.
 * Writes segments to temp files, runs ffmpeg -f concat, reads the result.
 */
async function concatenateAudioNative(
  ffmpegPath: string,
  buffers: ArrayBuffer[],
): Promise<Uint8Array> {
  const {
    writeFile: fsWriteFile,
    readFile: fsReadFile,
    mkdir: fsMkdir,
    rm,
  } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  const { execFile } = await import('node:child_process');

  const tmpId = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `squisq-audio-concat-${tmpId}`);
  await fsMkdir(workDir, { recursive: true });

  try {
    // Write each segment to a temp file
    const segmentPaths: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const segPath = join(workDir, `seg-${i}.mp3`);
      await fsWriteFile(segPath, new Uint8Array(buffers[i]));
      segmentPaths.push(segPath);
    }

    // Write concat list
    const listPath = join(workDir, 'concat-list.txt');
    const listContent = segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    await fsWriteFile(listPath, listContent);

    // Run ffmpeg concat
    const outputPath = join(workDir, 'combined.mp3');
    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath,
        ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
        { timeout: 120_000 },
        (err) => {
          if (err) reject(new Error(`ffmpeg audio concat failed: ${err.message}`));
          else resolve();
        },
      );
    });

    const data = await fsReadFile(outputPath);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
