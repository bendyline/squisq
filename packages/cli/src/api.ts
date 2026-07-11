/**
 * Programmatic Rendered-Media API
 *
 * Provides library-style entry points for rendering Squisq documents to MP4
 * or animated GIF from Node.js callers (e.g., Qualla's pipeline). This avoids
 * the need to shell
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
 *
 *   await renderDocToGif(doc, container, {
 *     outputPath: '/tmp/output.gif',
 *     animationsEnabled: false,
 *   });
 */

import type { Doc } from '@bendyline/squisq/schemas';
import { resolveMediaSchedule } from '@bendyline/squisq/schemas';
import { flattenBlocks } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { GifDither, VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
import { ffmpegGifOutputArgs, generateRenderHtml } from '@bendyline/squisq-video';
import { resolveDimensions } from '@bendyline/squisq-video';
import { convert as formatsConvert } from '@bendyline/squisq-formats';
import type {
  ConvertSource,
  ConvertOptions,
  ConversionResult,
  FormatId,
} from '@bendyline/squisq-formats';
import { detectFfmpegDetailed } from './util/detectFfmpeg.js';
import { buildMixedAudioTrack } from './util/audioMix.js';
import { resolveAppliedCoverPreRoll } from './util/coverPreRoll.js';
import { GIF_EXPORT_DEFAULTS } from './util/nativeEncoder.js';
import { createCliRegistry } from './registry.js';
import type { GifFormatOptions, Mp4FormatOptions } from './registry.js';

// Re-export utility types and functions callers may need
export type { GifDither, VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
export { MemoryContentContainer } from '@bendyline/squisq/storage';
export { readInput } from './util/readInput.js';
export type { ReadInputResult } from './util/readInput.js';
export {
  GIF_EXPORT_DEFAULTS,
  framesToGifNative,
  framesToGifNativeBytes,
  framesToMp4Native,
  framesToMp4NativeBytes,
} from './util/nativeEncoder.js';
export type { GifExportOptions } from './util/nativeEncoder.js';
export type { GifFormatOptions, Mp4FormatOptions } from './registry.js';

/** Convert options with the CLI-only rendered-media adapters strongly typed. */
export type CliConvertOptions = Omit<ConvertOptions, 'formatOptions'> & {
  formatOptions?: ConvertOptions['formatOptions'] & {
    mp4?: Mp4FormatOptions;
    gif?: GifFormatOptions;
  };
};

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
 * `mp4` and `gif` formats on top of every built-in exporter) and a default
 * `resolvePlayerScript` that lazily loads the standalone player IIFE bundle
 * (required for HTML/EPUB-style exports). Callers may override either via
 * `options`.
 *
 * @param source - A bytes / markdown / doc {@link ConvertSource}.
 * @param to - Target format id (`docx`, `pdf`, `pptx`, `html`, `mp4`, `gif`, …).
 * @param options - Conversion options; `registry` and `resolvePlayerScript`
 *   default to the CLI's values but can be overridden.
 * @returns The encoded bytes plus mime type, suggested filename, and warnings.
 * @throws {@link ConversionError} on any failure, with a stable `code`.
 */
export async function convert(
  source: ConvertSource,
  to: FormatId,
  options: CliConvertOptions = {},
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

  /** Render layer animations and block transitions (default: true). */
  animationsEnabled?: boolean;

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

/** Options for rendering a document to an animated GIF. */
export interface RenderDocToGifOptions {
  /** Output file path for the GIF. */
  outputPath: string;
  /** Frames per second (default: 10). */
  fps?: number;
  /** Viewport orientation (default: landscape). */
  orientation?: VideoOrientation;
  /** Override output width (default: 960 landscape / 540 portrait). */
  width?: number;
  /** Override output height (default: 540 landscape / 960 portrait). */
  height?: number;
  /** Caption style to bake into the GIF (default: none). */
  captionStyle?: 'standard' | 'social';
  /** Seconds of cover-slide pre-roll (default: 0). */
  coverPreRoll?: number;
  /** Render layer animations and block transitions (default: false). */
  animationsEnabled?: boolean;
  /** Number of repeats; 0 loops forever and -1 disables looping. */
  loop?: number;
  /** Palette size, from 2 through 256 (default: 256). */
  maxColors?: number;
  /** Palette dithering algorithm (default: sierra2_4a). */
  dither?: GifDither;
  /** Bayer strength when dither is bayer (0-5, default: 3). */
  bayerScale?: number;
  /** Progress callback. */
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

/** Result returned by renderDocToGif. */
export interface RenderDocToGifResult extends RenderDocToMp4Result {
  /** Non-fatal fidelity warnings, including GIF's lack of audio. */
  warnings: string[];
}

/** Minimal standalone-player contract used inside Playwright's page realm. */
interface BrowserRenderAPI {
  seekTo(time: number): Promise<void>;
  getDuration(): number;
  hasCoverBlock(): boolean;
  showCover(): Promise<void>;
  hideCover(): Promise<void>;
}

interface BrowserPlayerHandle {
  getRenderAPI(): BrowserRenderAPI | null;
}

interface BrowserStandalonePlayer {
  getHandle(element: Element): BrowserPlayerHandle | undefined;
}

interface SquisqBrowserWindow {
  SquisqPlayer?: BrowserStandalonePlayer;
}

interface CaptureDocFramesOptions {
  fps: number;
  width: number;
  height: number;
  captionStyle?: 'standard' | 'social';
  coverPreRoll: number;
  animationsEnabled: boolean;
  onProgress?: (phase: string, percent: number) => void;
}

interface CapturedDocFrames {
  frames: Uint8Array[];
  totalDuration: number;
  appliedCoverPreRoll: number;
  ffmpegPath: string;
}

/** Capture deterministic PNG frames once, independent of the output encoder. */
async function captureDocFrames(
  doc: Doc,
  container: ContentContainer,
  options: CaptureDocFramesOptions,
): Promise<CapturedDocFrames> {
  const { fps, width, height, captionStyle, coverPreRoll, animationsEnabled, onProgress } = options;

  resolveAppliedCoverPreRoll(coverPreRoll, true);
  const ffmpegPath = (await detectFfmpegDetailed())?.path ?? null;
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
  const { collectImagePaths } = await import('@bendyline/squisq-formats/html');
  const images = new Map<string, ArrayBuffer>();
  for (const imgPath of collectImagePaths(doc)) {
    const data = await container.readFile(imgPath);
    if (data) images.set(imgPath, data);
  }

  // Audio remains available to the headless player even for silent GIF output:
  // narration metadata and media duration still define the visual timeline.
  const audio = new Map<string, ArrayBuffer>();
  for (const seg of doc.audio?.segments ?? []) {
    const data = await container.readFile(seg.src);
    if (data) {
      audio.set(seg.src, data);
      audio.set(seg.name, data);
    }
  }

  const mediaSrcs = new Set<string>(resolveMediaSchedule(doc).map((clip) => clip.src));
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
  const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
  const renderHtml = generateRenderHtml(doc, {
    playerScript: PLAYER_BUNDLE,
    images,
    audio: audio.size > 0 ? audio : undefined,
    width,
    height,
    captionStyle,
    animationsEnabled,
  });

  onProgress?.('launching browser', 15);
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

  const page = await browser.newPage({ viewport: { width, height } });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  let renderAPI: import('playwright-core').JSHandle<BrowserRenderAPI> | null = null;

  try {
    await page.setContent(renderHtml, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    try {
      await page.waitForFunction(
        () => {
          const root = document.getElementById('squisq-root');
          const player = (window as unknown as SquisqBrowserWindow).SquisqPlayer;
          return root ? player?.getHandle(root)?.getRenderAPI() != null : false;
        },
        { timeout: 15000 },
      );
    } catch {
      const errorDetail = pageErrors.length
        ? `\nPage errors:\n  ${pageErrors.join('\n  ')}`
        : '\nNo page errors captured — the player may have failed to mount.';
      throw new Error(
        `The standalone player failed to boot in headless Chromium. ` +
          `Render API did not initialize within 15 seconds.${errorDetail}`,
      );
    }

    renderAPI = await page.evaluateHandle(() => {
      const root = document.getElementById('squisq-root');
      const player = (window as unknown as SquisqBrowserWindow).SquisqPlayer;
      const api = root ? player?.getHandle(root)?.getRenderAPI() : null;
      if (!api) throw new Error('Squisq render API disappeared after initialization.');
      return api;
    });
    const docDuration = await renderAPI.evaluate((api) => api.getDuration());
    if (docDuration <= 0) throw new Error('Document has zero duration — nothing to render');

    const hasCover =
      coverPreRoll > 0 ? await renderAPI.evaluate((api) => api.hasCoverBlock()) : false;
    const appliedCoverPreRoll = resolveAppliedCoverPreRoll(coverPreRoll, hasCover);
    const storyFrameCount = Math.ceil(docDuration * fps);
    const preRollFrameCount = Math.ceil(appliedCoverPreRoll * fps);
    const totalFrames = preRollFrameCount + storyFrameCount;
    const frames: Uint8Array[] = [];
    onProgress?.('capturing frames', 20);

    if (preRollFrameCount > 0) {
      await renderAPI.evaluate((api) => api.showCover());
      await page.waitForTimeout(100);
      const coverFrame = new Uint8Array(await page.screenshot({ type: 'png' }));
      for (let i = 0; i < preRollFrameCount; i++) frames.push(coverFrame);
      await renderAPI.evaluate((api) => api.hideCover());
    }

    const frameInterval = 1 / fps;
    for (let i = 0; i < storyFrameCount; i++) {
      const time = i * frameInterval;
      await renderAPI.evaluate((api, t: number) => api.seekTo(t), time);
      frames.push(new Uint8Array(await page.screenshot({ type: 'png' })));
      if (i % Math.max(1, Math.floor(fps / 2)) === 0 || i === storyFrameCount - 1) {
        onProgress?.('capturing frames', 20 + Math.round((frames.length / totalFrames) * 60));
      }
    }

    return {
      frames,
      totalDuration: docDuration + appliedCoverPreRoll,
      appliedCoverPreRoll,
      ffmpegPath,
    };
  } finally {
    await renderAPI?.dispose();
    await browser.close();
  }
}

/** Render a Doc + media container to an MP4 video file. */
export async function renderDocToMp4(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToMp4Options,
): Promise<RenderDocToMp4Result> {
  const fps = options.fps ?? 30;
  const quality = options.quality ?? 'normal';
  const orientation = options.orientation ?? 'landscape';
  const dimensions = resolveDimensions({
    orientation,
    width: options.width,
    height: options.height,
    fps,
    quality,
  });
  const capture = await captureDocFrames(doc, container, {
    fps,
    width: dimensions.width,
    height: dimensions.height,
    captionStyle: options.captionStyle,
    coverPreRoll: options.coverPreRoll ?? 0,
    animationsEnabled: options.animationsEnabled ?? true,
    onProgress: options.onProgress,
  });

  options.onProgress?.('encoding video', 80);
  const encodingAudio = await buildMixedAudioTrack(
    doc,
    container,
    capture.ffmpegPath,
    capture.appliedCoverPreRoll,
  );
  const { framesToMp4Native } = await import('./util/nativeEncoder.js');
  await framesToMp4Native(capture.ffmpegPath, capture.frames, encodingAudio, options.outputPath, {
    fps,
    quality,
    orientation,
    width: dimensions.width,
    height: dimensions.height,
    onProgress: (percent, phase) =>
      options.onProgress?.(`encoding: ${phase}`, 80 + Math.round(percent * 0.2)),
  });
  options.onProgress?.('done', 100);
  return {
    duration: capture.totalDuration,
    frameCount: capture.frames.length,
    outputPath: options.outputPath,
  };
}

/** Render a Doc + media container to a silent animated GIF. */
export async function renderDocToGif(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToGifOptions,
): Promise<RenderDocToGifResult> {
  const fps = options.fps ?? GIF_EXPORT_DEFAULTS.fps;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 100) {
    throw new RangeError('GIF FPS must be a finite number between 1 and 100.');
  }
  const orientation = options.orientation ?? 'landscape';
  const portrait = orientation === 'portrait';
  const width =
    options.width ?? (portrait ? GIF_EXPORT_DEFAULTS.height : GIF_EXPORT_DEFAULTS.width);
  const height =
    options.height ?? (portrait ? GIF_EXPORT_DEFAULTS.width : GIF_EXPORT_DEFAULTS.height);
  // Reuse shared dimension validation without inheriting MP4's 1080p defaults.
  resolveDimensions({ orientation, width, height, fps });
  // Validate palette/muxer options before the expensive browser capture.
  ffmpegGifOutputArgs({
    width,
    height,
    loop: options.loop ?? GIF_EXPORT_DEFAULTS.loop,
    maxColors: options.maxColors ?? GIF_EXPORT_DEFAULTS.maxColors,
    dither: options.dither ?? GIF_EXPORT_DEFAULTS.dither,
    bayerScale: options.bayerScale,
  });

  const capture = await captureDocFrames(doc, container, {
    fps,
    width,
    height,
    captionStyle: options.captionStyle,
    coverPreRoll: options.coverPreRoll ?? 0,
    animationsEnabled: options.animationsEnabled ?? false,
    onProgress: options.onProgress,
  });

  options.onProgress?.('encoding GIF', 80);
  const { framesToGifNative } = await import('./util/nativeEncoder.js');
  await framesToGifNative(capture.ffmpegPath, capture.frames, options.outputPath, {
    fps,
    orientation,
    width,
    height,
    loop: options.loop,
    maxColors: options.maxColors,
    dither: options.dither,
    bayerScale: options.bayerScale,
    onProgress: (percent, phase) =>
      options.onProgress?.(`encoding: ${phase}`, 80 + Math.round(percent * 0.2)),
  });
  options.onProgress?.('done', 100);

  const hasAudio =
    (doc.audio?.segments?.length ?? 0) > 0 ||
    resolveMediaSchedule(doc).some((clip) => clip.kind === 'audio');
  return {
    duration: capture.totalDuration,
    frameCount: capture.frames.length,
    outputPath: options.outputPath,
    warnings: hasAudio ? ['Animated GIF does not support audio; audio tracks were omitted.'] : [],
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

  const ffmpegPath = (await detectFfmpegDetailed())?.path ?? null;
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
