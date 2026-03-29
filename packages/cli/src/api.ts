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
import type { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
import { generateRenderHtml } from '@bendyline/squisq-video';
import { resolveDimensions } from '@bendyline/squisq-video';
import { detectFfmpeg } from './util/detectFfmpeg.js';

// Re-export utility types and functions callers may need
export type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
export { MemoryContentContainer } from '@bendyline/squisq/storage';
export { readInput } from './util/readInput.js';
export type { ReadInputResult } from './util/readInput.js';

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

  /** Seconds of cover-slide pre-roll before the story starts (default: 0). */
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
 * - FFmpeg — for video encoding (must be on PATH)
 *
 * @param doc - The Doc structure to render
 * @param container - MemoryContentContainer with audio/image files
 * @param options - Rendering and encoding options
 * @returns Result with duration and frame count
 */
export async function renderDocToMp4(
  doc: Doc,
  container: MemoryContentContainer,
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
    concatenatedAudio = await concatenateAudioBuffers(audioBuffers);
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
  const browser = await chromium.launch({ headless: true });
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
    throw new Error(`Render API did not initialize within 15 seconds.${errorDetail}`);
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

  // ── FFmpeg encoding ─────────────────────────────────────────────
  const ffmpegPath = await detectFfmpeg();
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg is required but not found in PATH.\n' +
        'Install it with:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Windows: winget install ffmpeg',
    );
  }

  // If there's a pre-roll, delay the audio track to match
  let encodingAudio = concatenatedAudio;
  if (coverPreRoll > 0 && concatenatedAudio) {
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
async function concatenateAudioBuffers(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  if (buffers.length === 0) return new Uint8Array(0);
  if (buffers.length === 1) return new Uint8Array(buffers[0]);

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
