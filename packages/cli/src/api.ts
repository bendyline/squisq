/**
 * Programmatic Video API
 *
 * Provides a library-style entry point for rendering Squisq documents to MP4
 * from Node.js callers (e.g., Qualla's pipeline). This avoids the need to shell
 * out to the `squisq video` CLI and gives callers full control over the Doc,
 * MemoryContentContainer, and encoding options.
 *
 * Orchestrates the full pipeline: Doc → render HTML → Playwright frame capture → FFmpeg encode.
 *
 * Usage:
 *   import { renderDocToMp4 } from '@bendyline/squisq-cli/api';
 *
 *   await renderDocToMp4(doc, container, {
 *     outputPath: '/tmp/output.mp4',
 *     fps: 30,
 *     quality: 'normal',
 *     orientation: 'landscape',
 *   });
 */

import type { Doc } from '@bendyline/squisq/schemas';
import { resolveMediaSchedule } from '@bendyline/squisq/schemas';
import { flattenBlocks } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
import { generateRenderHtml } from '@bendyline/squisq-video';
import { resolveDimensions } from '@bendyline/squisq-video';
import { convert as formatsConvert } from '@bendyline/squisq-formats';
import type {
  ConvertSource,
  ConvertOptions,
  ConversionResult,
  FormatId,
} from '@bendyline/squisq-formats';
import { detectFfmpeg } from './util/detectFfmpeg.js';
import { createCliRegistry } from './registry.js';

// Re-export utility types and functions callers may need
export type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
export { MemoryContentContainer } from '@bendyline/squisq/storage';
export { readInput } from './util/readInput.js';
export type { ReadInputResult } from './util/readInput.js';

// ── Format registry / convert() surface ───────────────────────────
// Re-export the CLI's format registry factory plus the registry types and the
// structured error, so `@bendyline/squisq-cli/api` is a one-stop programmatic
// front door for both video rendering and document conversion.
export { createCliRegistry } from './registry.js';
export { ConversionError } from '@bendyline/squisq-formats';
export type {
  ConvertSource,
  ConvertOptions,
  ConversionResult,
  FormatId,
  FormatRegistry,
  FormatDefinition,
  NormalizedInput,
  ConversionErrorCode,
  ConversionErrorOptions,
} from '@bendyline/squisq-formats';

/**
 * Convert a document to a target format using the CLI's format registry.
 *
 * This is a thin, pre-bound wrapper over `convert()` from
 * `@bendyline/squisq-formats`: it injects the CLI registry (which adds the
 * `mp4` format on top of every built-in exporter) and a default
 * `resolvePlayerScript` that lazily loads the standalone player IIFE bundle
 * (required for HTML/EPUB-style exports). Callers may override either via
 * `options`.
 *
 * @param source - A bytes / markdown / doc {@link ConvertSource}.
 * @param to - Target format id (`docx`, `pdf`, `pptx`, `html`, `mp4`, …).
 * @param options - Conversion options; `registry` and `resolvePlayerScript`
 *   default to the CLI's values but can be overridden.
 * @returns The encoded bytes plus mime type, suggested filename, and warnings.
 * @throws {@link ConversionError} on any failure, with a stable `code`.
 */
export async function convert(
  source: ConvertSource,
  to: FormatId,
  options: ConvertOptions = {},
): Promise<ConversionResult> {
  return formatsConvert(source, to, {
    registry: createCliRegistry(),
    resolvePlayerScript: () =>
      import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE),
    ...options,
  });
}

/** Options for renderDocToMp4. */
export interface RenderDocToMp4Options {
  /** Output file path for the MP4. */
  outputPath: string;

  /** Frames per second (default: 30). */
  fps?: number;

  /** Encoding quality preset (default: 'normal'). */
  quality?: VideoQuality;

  /** Video orientation (default: 'landscape'). */
  orientation?: VideoOrientation;

  /** Override video width in pixels. */
  width?: number;

  /** Override video height in pixels. */
  height?: number;

  /** Caption style to bake into the video (default: none). */
  captionStyle?: 'standard' | 'social';

  /**
   * Seconds of cover-slide pre-roll before the story starts (default: 0).
   *
   * Note: the `squisq video` CLI defaults its `--cover-preroll` flag to 2
   * seconds; this programmatic API deliberately defaults to 0 so library
   * callers get exactly the duration they ask for.
   */
  coverPreRoll?: number;

  /**
   * Progress callback. Called with a phase name and 0-100 percentage.
   */
  onProgress?: (phase: string, percent: number) => void;
}

/** Result returned by renderDocToMp4. */
export interface RenderDocToMp4Result {
  /** Duration of the rendered video in seconds (including pre-roll). */
  duration: number;

  /** Number of frames captured. */
  frameCount: number;

  /** Output file path. */
  outputPath: string;
}

/**
 * Render a Doc + media container to an MP4 video file.
 *
 * The container should contain audio and image files referenced by the Doc's
 * audio.segments[].src and block image paths. Files are embedded as base64
 * data URIs in a self-contained render HTML page.
 *
 * Requires:
 * - Playwright (chromium) — for headless frame capture
 * - FFmpeg — for video encoding (resolved from SQUISQ_FFMPEG, PATH, or an
 *   optionally installed `ffmpeg-static` package — see detectFfmpeg)
 *
 * @param doc - The Doc structure to render
 * @param container - MemoryContentContainer with audio/image files
 * @param options - Rendering and encoding options
 * @returns Result with duration and frame count
 */
export async function renderDocToMp4(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToMp4Options,
): Promise<RenderDocToMp4Result> {
  const {
    outputPath,
    fps = 30,
    quality = 'normal',
    orientation = 'landscape',
    captionStyle,
    coverPreRoll = 0,
    onProgress,
  } = options;

  const dimensions = resolveDimensions({
    orientation,
    width: options.width,
    height: options.height,
  });

  // Detect ffmpeg early — needed for audio concat and video encoding
  const ffmpegPath = await detectFfmpeg();
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg is required but not found in PATH.\n' +
        'Install it with:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Windows: winget install ffmpeg\n' +
        'Or: npm install ffmpeg-static, or set SQUISQ_FFMPEG to an ffmpeg binary.',
    );
  }

  onProgress?.('collecting media', 0);

  // ── Collect images from container ───────────────────────────────
  const { collectImagePaths } = await import('@bendyline/squisq-formats/html');
  const imagePaths = collectImagePaths(doc);
  const images = new Map<string, ArrayBuffer>();
  for (const imgPath of imagePaths) {
    const data = await container.readFile(imgPath);
    if (data) {
      images.set(imgPath, data);
    }
  }

  // ── Collect audio segments ──────────────────────────────────────
  const audio = new Map<string, ArrayBuffer>();
  const audioBuffers: ArrayBuffer[] = [];
  if (doc.audio?.segments?.length) {
    for (const seg of doc.audio.segments) {
      const data = await container.readFile(seg.src);
      if (data) {
        audio.set(seg.src, data);
        audio.set(seg.name, data);
        audioBuffers.push(data);
      }
    }
  }

  // Concatenate audio for the MP4's audio track
  let concatenatedAudio: Uint8Array | null = null;
  if (audioBuffers.length > 0) {
    concatenatedAudio = await concatenateAudioBuffers(audioBuffers, ffmpegPath);
  }

  // ── Collect timed-media clips + block video sources ─────────────
  // Every scheduled clip (block.media + doc.documentMedia) and every
  // template-produced VideoLayer needs its bytes embedded so the headless
  // page can load them with no network. They resolve through the inline
  // media provider's `images` map (which infers mp4/mp3 MIME by extension).
  const schedule = resolveMediaSchedule(doc);
  const mediaSrcs = new Set<string>(schedule.map((c) => c.src));
  for (const block of flattenBlocks(doc.blocks)) {
    for (const layer of block.layers ?? []) {
      if (layer.type === 'video') mediaSrcs.add(layer.content.src);
    }
  }
  // Buffers for the scheduled audio clips, keyed by clip id, for the mux.
  const clipBuffers = new Map<string, ArrayBuffer>();
  for (const src of mediaSrcs) {
    if (images.has(src)) continue;
    const data = await container.readFile(src);
    if (data) images.set(src, data);
  }
  for (const clip of schedule) {
    if (clip.kind !== 'audio') continue;
    const data = images.get(clip.src) ?? (await container.readFile(clip.src));
    if (data) clipBuffers.set(clip.id, data);
  }

  onProgress?.('generating render HTML', 10);

  // ── Generate self-contained render HTML ─────────────────────────
  const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
  const renderHtml = generateRenderHtml(doc, {
    playerScript: PLAYER_BUNDLE,
    images,
    audio: audio.size > 0 ? audio : undefined,
    width: dimensions.width,
    height: dimensions.height,
    captionStyle,
  });

  onProgress?.('launching browser', 15);

  // ── Playwright frame capture ────────────────────────────────────
  const { chromium } = await import('playwright-core');
  let browser: import('playwright-core').Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new Error(
      'Playwright Chromium is not installed. Run: npx playwright install chromium\n' +
        `(launch failed: ${detail})`,
    );
  }
  const page = await browser.newPage({
    viewport: { width: dimensions.width, height: dimensions.height },
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.setContent(renderHtml, { waitUntil: 'load' });
  await page.waitForTimeout(500);

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
    throw new Error(
      `The standalone player failed to boot in headless Chromium. ` +
        `Render API did not initialize within 15 seconds.${errorDetail}`,
    );
  }

  const docDuration: number = await page.evaluate(() => {
    return (window as unknown as { getDuration: () => number }).getDuration();
  });

  if (docDuration <= 0) {
    await browser.close();
    throw new Error('Document has zero duration — nothing to render');
  }

  const storyFrameCount = Math.ceil(docDuration * fps);
  const preRollFrameCount = Math.ceil(coverPreRoll * fps);
  const totalFrames = preRollFrameCount + storyFrameCount;
  const frames: Uint8Array[] = [];

  onProgress?.('capturing frames', 20);

  // Cover slide pre-roll (if requested)
  if (preRollFrameCount > 0) {
    const hasCover: boolean = await page.evaluate(() => {
      const w = window as unknown as { hasCoverBlock?: () => boolean };
      return typeof w.hasCoverBlock === 'function' ? w.hasCoverBlock() : false;
    });

    if (hasCover) {
      await page.evaluate(() => {
        (window as unknown as { showCover: () => void }).showCover();
      });
      await page.waitForTimeout(100);
      const coverFrame = new Uint8Array(await page.screenshot({ type: 'png' }));
      for (let i = 0; i < preRollFrameCount; i++) {
        frames.push(coverFrame);
      }
      await page.evaluate(() => {
        (window as unknown as { hideCover: () => void }).hideCover();
      });
    }
  }

  // Story frames via seekTo
  const frameInterval = 1 / fps;
  for (let i = 0; i < storyFrameCount; i++) {
    const time = i * frameInterval;
    await page.evaluate((t: number) => {
      return (window as unknown as { seekTo: (t: number) => Promise<void> }).seekTo(t);
    }, time);

    const screenshot = await page.screenshot({ type: 'png' });
    frames.push(new Uint8Array(screenshot));

    // Report progress: frames phase is 20% to 80%
    if (i % Math.max(1, Math.floor(fps / 2)) === 0 || i === storyFrameCount - 1) {
      const pct = 20 + Math.round((frames.length / totalFrames) * 60);
      onProgress?.('capturing frames', pct);
    }
  }

  await browser.close();

  onProgress?.('encoding video', 80);

  // Build the final audio track. With timed media clips, mix the narration
  // (delayed by the cover pre-roll) and each scheduled audio clip at its
  // absolute time. Without clips, keep the legacy narration-only path so
  // existing exports are unchanged.
  const scheduledAudioClips = schedule.filter((c) => c.kind === 'audio' && clipBuffers.has(c.id));
  let encodingAudio = concatenatedAudio;
  if (scheduledAudioClips.length > 0 && ffmpegPath) {
    encodingAudio = await mixScheduledAudio(
      ffmpegPath,
      concatenatedAudio,
      scheduledAudioClips.map((c) => ({
        buffer: clipBuffers.get(c.id)!,
        delaySec: c.absoluteStart + coverPreRoll,
        trimStart: c.sourceIn,
        trimLen: Math.max(0, c.absoluteEnd - c.absoluteStart),
      })),
      coverPreRoll,
    );
  } else if (coverPreRoll > 0 && concatenatedAudio) {
    // Use FFmpeg to add silence padding at the start (adelay filter)
    encodingAudio = await addAudioDelay(ffmpegPath, concatenatedAudio, coverPreRoll);
  }

  const { framesToMp4Native } = await import('./util/nativeEncoder.js');
  await framesToMp4Native(ffmpegPath, frames, encodingAudio, outputPath, {
    fps,
    quality,
    orientation,
    width: dimensions.width,
    height: dimensions.height,
    onProgress: (percent, phase) => {
      onProgress?.(`encoding: ${phase}`, 80 + Math.round(percent * 0.2));
    },
  });

  onProgress?.('done', 100);

  const totalDuration = docDuration + coverPreRoll;
  return {
    duration: totalDuration,
    frameCount: frames.length,
    outputPath,
  };
}

// ── Audio helpers ─────────────────────────────────────────────────

/**
 * Concatenate multiple audio buffers into one.
 * Uses native ffmpeg concat when available, falls back to byte concatenation.
 */
async function concatenateAudioBuffers(
  buffers: ArrayBuffer[],
  ffmpegPath?: string,
): Promise<Uint8Array> {
  if (buffers.length === 0) return new Uint8Array(0);
  if (buffers.length === 1) return new Uint8Array(buffers[0]);

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

async function concatenateAudioNative(
  ffmpegPath: string,
  buffers: ArrayBuffer[],
): Promise<Uint8Array> {
  const { writeFile, readFile, mkdir, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  const { execFile } = await import('node:child_process');

  const tmpId = randomBytes(8).toString('hex');
  const workDir = join(tmpdir(), `squisq-audio-concat-${tmpId}`);
  await mkdir(workDir, { recursive: true });

  try {
    const segmentPaths: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const segPath = join(workDir, `seg-${i}.mp3`);
      await writeFile(segPath, new Uint8Array(buffers[i]));
      segmentPaths.push(segPath);
    }

    const listPath = join(workDir, 'concat-list.txt');
    const listContent = segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    await writeFile(listPath, listContent);

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

    const data = await readFile(outputPath);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Add silence at the start of an audio track by re-encoding with adelay filter.
 */
async function addAudioDelay(
  ffmpegPath: string,
  audioData: Uint8Array,
  delaySecs: number,
): Promise<Uint8Array> {
  const { writeFile, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  const { execFile } = await import('node:child_process');

  const tmpId = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `squisq-audio-delay-in-${tmpId}.mp3`);
  const outputPath = join(tmpdir(), `squisq-audio-delay-out-${tmpId}.mp3`);

  try {
    await writeFile(inputPath, audioData);
    const delayMs = Math.round(delaySecs * 1000);

    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          '-y',
          '-i',
          inputPath,
          '-af',
          `adelay=${delayMs}|${delayMs}`,
          '-c:a',
          'libmp3lame',
          '-b:a',
          '128k',
          outputPath,
        ],
        { timeout: 60_000 },
        (err) => {
          if (err) reject(new Error(`ffmpeg audio delay failed: ${err.message}`));
          else resolve();
        },
      );
    });

    const data = await readFile(outputPath);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    await rm(inputPath, { force: true });
    await rm(outputPath, { force: true });
  }
}

/** One scheduled audio clip to fold into the mix. */
interface AudioMixClip {
  buffer: ArrayBuffer;
  /** Seconds to delay the clip on the final timeline. */
  delaySec: number;
  /** Source in-point to trim from (seconds). */
  trimStart: number;
  /** Played length (seconds). */
  trimLen: number;
}

/**
 * Mix the sequential narration track (delayed by the cover pre-roll) with any
 * number of scheduled audio clips, each trimmed to its source window and
 * delayed to its absolute position. Returns a single MP3.
 *
 * Each input is `adelay`'d (per-channel) and `atrim`'d; `amix` sums them with
 * `normalize=0` so individual levels are preserved. Frame capture stays silent
 * — this reconstructs the audio offline from the same schedule the renderer
 * uses, keeping audio and video aligned.
 */
async function mixScheduledAudio(
  ffmpegPath: string,
  narration: Uint8Array | null,
  clips: AudioMixClip[],
  coverPreRoll: number,
): Promise<Uint8Array | null> {
  if (!narration && clips.length === 0) return null;

  const { writeFile, readFile, mkdir, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  const { execFile } = await import('node:child_process');

  const workDir = join(tmpdir(), `squisq-audio-mix-${randomBytes(8).toString('hex')}`);
  await mkdir(workDir, { recursive: true });

  try {
    const inputs: string[] = [];
    const filters: string[] = [];
    const labels: string[] = [];
    const ms = (s: number) => Math.max(0, Math.round(s * 1000));

    if (narration) {
      const p = join(workDir, 'narration.mp3');
      await writeFile(p, narration);
      const i = inputs.push(p) - 1;
      const d = ms(coverPreRoll);
      filters.push(`[${i}:a]adelay=${d}|${d}[a${i}]`);
      labels.push(`[a${i}]`);
    }

    for (const clip of clips) {
      const p = join(workDir, `clip-${inputs.length}.mp3`);
      await writeFile(p, new Uint8Array(clip.buffer));
      const i = inputs.push(p) - 1;
      const d = ms(clip.delaySec);
      const end = clip.trimStart + clip.trimLen;
      filters.push(
        `[${i}:a]atrim=start=${clip.trimStart}:end=${end},asetpts=PTS-STARTPTS,adelay=${d}|${d}[a${i}]`,
      );
      labels.push(`[a${i}]`);
    }

    const graph = `${filters.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`;
    const args = ['-y'];
    for (const p of inputs) args.push('-i', p);
    args.push(
      '-filter_complex',
      graph,
      '-map',
      '[aout]',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      join(workDir, 'mixed.mp3'),
    );

    await new Promise<void>((resolve, reject) => {
      execFile(ffmpegPath, args, { timeout: 180_000 }, (err) => {
        if (err) reject(new Error(`ffmpeg audio mix failed: ${err.message}`));
        else resolve();
      });
    });

    const data = await readFile(join(workDir, 'mixed.mp3'));
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// ── Thumbnail extraction ──────────────────────────────────────────

/** A thumbnail size specification. */
export interface ThumbnailSpec {
  /** Label for the thumbnail (used in filename: `{slug}-{width}x{height}.jpg`). */
  name: string;
  /** Output width in pixels. */
  width: number;
  /** Output height in pixels. */
  height: number;
  /** FFmpeg video filter string (e.g., 'scale=1280:720'). */
  filter: string;
}

/** Options for extractThumbnails. */
export interface ExtractThumbnailsOptions {
  /** Path to the source MP4 video. */
  videoPath: string;
  /** Directory to write thumbnails into. */
  outputDir: string;
  /** Base slug for filenames (produces `{slug}-{width}x{height}.jpg`). */
  slug: string;
  /** Thumbnail sizes to generate. */
  sizes: ThumbnailSpec[];
  /** Overwrite existing thumbnails (default: false). */
  force?: boolean;
}

/**
 * Extract thumbnail images from the first frame of an MP4 video.
 * Produces JPEG files at each specified size using FFmpeg video filters.
 */
export async function extractThumbnails(options: ExtractThumbnailsOptions): Promise<void> {
  const { videoPath, outputDir, slug, sizes, force } = options;
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');

  const ffmpegPath = await detectFfmpeg();
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg is required for thumbnail extraction but not found in PATH.\n' +
        'Install it with:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Windows: winget install ffmpeg',
    );
  }

  for (const thumb of sizes) {
    const outputPath = join(outputDir, `${slug}-${thumb.width}x${thumb.height}.jpg`);
    if (!force && existsSync(outputPath)) continue;

    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath,
        ['-y', '-i', videoPath, '-vf', thumb.filter, '-frames:v', '1', '-q:v', '2', outputPath],
        { timeout: 30_000 },
        (err) => {
          if (err) reject(new Error(`Thumbnail extraction failed (${thumb.name}): ${err.message}`));
          else resolve();
        },
      );
    });
  }
}
