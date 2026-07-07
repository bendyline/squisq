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
import { buildMixedAudioTrack } from './util/audioMix.js';
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

  // ── Collect audio segments for the render HTML ──────────────────
  // The player page loads narration so the doc's duration/timing resolves; the
  // captured frames themselves are silent (audio is reconstructed offline from
  // the timeline below). Keyed by both src and name so the inline provider
  // resolves either reference.
  const audio = new Map<string, ArrayBuffer>();
  if (doc.audio?.segments?.length) {
    for (const seg of doc.audio.segments) {
      const data = await container.readFile(seg.src);
      if (data) {
        audio.set(seg.src, data);
        audio.set(seg.name, data);
      }
    }
  }

  // ── Collect timed-media clips + block video sources ─────────────
  // Every scheduled clip (block.media + doc.documentMedia) and every
  // template-produced VideoLayer needs its bytes embedded so the headless
  // page can load them with no network. They resolve through the inline
  // media provider's `images` map (which infers mp4/mp3 MIME by extension).
  const mediaSrcs = new Set<string>(resolveMediaSchedule(doc).map((c) => c.src));
  for (const block of flattenBlocks(doc.blocks)) {
    for (const layer of block.layers ?? []) {
      if (layer.type === 'video') mediaSrcs.add(layer.content.src);
    }
  }
  for (const src of mediaSrcs) {
    if (images.has(src)) continue;
    const data = await container.readFile(src);
    if (data) images.set(src, data);
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

  // Build the final audio track from the single-source-of-truth timeline:
  // narration segments laid sequentially + timed media clips at their absolute
  // positions, every start shifted by the cover pre-roll. `buildMixedAudioTrack`
  // is a pure consumer of `computeAudioTimeline`, so the CLI's placement can no
  // longer drift from the browser export (zero-duration narration segments are
  // skipped consistently in both).
  const encodingAudio = await buildMixedAudioTrack(doc, container, ffmpegPath, coverPreRoll);

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
