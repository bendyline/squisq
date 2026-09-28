/**
 * Programmatic Rendered-Media API
 *
 * Provides library-style entry points for rendering Squisq documents to MP4
 * or animated GIF from Node.js callers. This avoids the need to shell
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

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import type { Doc, MotionSpec } from '@bendyline/squisq/schemas';
import { resolveMediaSchedule } from '@bendyline/squisq/schemas';
import { flattenBlocks } from '@bendyline/squisq/doc';
import type { DashboardStyleId } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type {
  DashboardResolutionId,
  GifDither,
  VideoQuality,
  VideoOrientation,
} from '@bendyline/squisq-video';
import { ffmpegGifOutputArgs, frameTimeSeconds, generateRenderHtml } from '@bendyline/squisq-video';
import { resolveDashboardDimensions, resolveDimensions } from '@bendyline/squisq-video';
import {
  convert as formatsConvert,
  prepareConversion as formatsPrepareConversion,
} from '@bendyline/squisq-formats';
import type {
  ConvertSource,
  ConvertOptions,
  ConversionResult,
  FormatId,
  PreparedConversion,
} from '@bendyline/squisq-formats';
import { detectFfmpegDetailed } from './util/detectFfmpeg.js';
import { buildMixedAudioTrack } from './util/audioMix.js';
import { CapturedFrameCollector } from './util/capturedFrameBudget.js';
import { resolveAppliedCoverPreRoll } from './util/coverPreRoll.js';
import { createMediaBudget } from './util/mediaBudget.js';
import { GIF_EXPORT_DEFAULTS } from './util/nativeEncoder.js';
import { selectStandalonePlayerVariant } from './util/playerBundle.js';
import { runFfmpeg } from './util/runFfmpeg.js';
import {
  createFfmpegPipeSink,
  docRenderHash,
  openDirectoryFrameStore,
  type CaptureFormat,
  type FrameManifest,
  type FrameSink,
} from './util/frameSink.js';
import { createCliRegistry } from './registry.js';
import type { GifFormatOptions, Mp4FormatOptions, PngFormatOptions } from './registry.js';

/**
 * How long the standalone player may take to publish its render API. A render
 * page embeds every asset as base64, so a media-heavy story can take well over
 * the old 15 s to parse and mount.
 */
const RENDER_BOOT_TIMEOUT_MS = 60_000;
/** Chromium JPEG quality for `captureFormat: 'jpeg'`; invisible after H.264 at normal/high CRF. */
const JPEG_CAPTURE_QUALITY = 92;

let playerBundlePromise: Promise<string> | undefined;
let fullPlayerBundlePromise: Promise<string> | undefined;
let playerIconBootstrapPromise: Promise<string> | undefined;

function loadPlayerIconBootstrap(): Promise<string> {
  playerIconBootstrapPromise ??= readFile(
    new URL('../dist/squisq-player-icons.global.js', import.meta.url),
    'utf8',
  );
  return playerIconBootstrapPromise;
}

function loadPlayerBundle(): Promise<string> {
  playerBundlePromise ??= Promise.all([
    loadPlayerIconBootstrap(),
    readFile(new URL('../dist/squisq-player.global.js', import.meta.url), 'utf8'),
  ]).then(([icons, player]) => `${icons}${player}`);
  return playerBundlePromise;
}

function loadFullPlayerBundle(): Promise<string> {
  fullPlayerBundlePromise ??= Promise.all([
    loadPlayerIconBootstrap(),
    readFile(new URL('../dist/squisq-player.full.global.js', import.meta.url), 'utf8'),
  ]).then(([icons, player]) => `${icons}${player}`);
  return fullPlayerBundlePromise;
}

// Re-export utility types and functions callers may need
export type { GifDither, VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
export { MemoryContentContainer } from '@bendyline/squisq/storage';
export { readInput } from './util/readInput.js';
export type { ReadInputResult } from './util/readInput.js';
export { CapturedFrameBudgetError, MAX_CAPTURED_FRAME_BYTES } from './util/capturedFrameBudget.js';
export {
  GIF_EXPORT_DEFAULTS,
  framesToGifNative,
  framesToGifNativeBytes,
  framesToMp4Native,
  framesToMp4NativeBytes,
} from './util/nativeEncoder.js';
export type { GifExportOptions, NativeVideoExportOptions } from './util/nativeEncoder.js';
export type { CaptureFormat, FrameManifest } from './util/frameSink.js';
export { ffmpegPipeArgs } from './util/frameSink.js';
export type { GifFormatOptions, Mp4FormatOptions, PngFormatOptions } from './registry.js';
export {
  DASHBOARD_RESOLUTIONS,
  DEFAULT_DASHBOARD_RESOLUTION,
  resolveDashboardDimensions,
  validateDashboardImageDimensions,
} from '@bendyline/squisq-video';
export type { DashboardResolutionId, DashboardResolutionPreset } from '@bendyline/squisq-video';

/** Convert options with the CLI-only rendered-media adapters strongly typed. */
export type CliConvertOptions = Omit<ConvertOptions, 'formatOptions'> & {
  formatOptions?: ConvertOptions['formatOptions'] & {
    mp4?: Mp4FormatOptions;
    gif?: GifFormatOptions;
    png?: PngFormatOptions;
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
  PreparedConversion,
  PreparedExportOptions,
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
    resolvePlayerScript: loadPlayerBundle,
    ...options,
  });
}

/** Normalize and transform once using the CLI registry, then export one or more targets. */
export async function prepareConversion(
  source: ConvertSource,
  options: CliConvertOptions = {},
): Promise<PreparedConversion> {
  return formatsPrepareConversion(source, {
    registry: createCliRegistry(),
    resolvePlayerScript: loadPlayerBundle,
    ...options,
  });
}

/** Options for renderDocToMp4. */
export interface RenderDocToMp4Options {
  /** Cancel capture/encoding and terminate browser and FFmpeg work. */
  signal?: AbortSignal;
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

  /** Caption mode to bake into the video (default: off). */
  captionStyle?: 'off' | 'standard' | 'social';

  /**
   * Motion profile override: `calm` (pre-profile output), `documentary` or
   * `vibrant`, or a spec with overrides. Omitted → the doc's `motion` /
   * frontmatter `squisq-motion`, then the theme's `renderStyle.motionProfile`.
   */
  motion?: MotionSpec | null;

  /** Render layer animations and block transitions (default: true). */
  animationsEnabled?: boolean;

  /**
   * How captured stills reach the encoder (default: 'pipe').
   *
   * - 'pipe' streams each still into one long-running ffmpeg process as it is
   *   captured, so memory stays flat for documents of any length.
   * - 'memory' retains every still until capture completes, then encodes.
   *   Bounded by {@link MAX_CAPTURED_FRAME_BYTES} (a few seconds of 1080p
   *   photo slides); kept for callers that depend on the old semantics.
   */
  frameTransport?: 'pipe' | 'memory';

  /**
   * Still-image format captured from the browser per frame (default: 'png'
   * for high quality, otherwise 'jpeg'). Chromium encodes a 1080p PNG in
   * hundreds of milliseconds but a JPEG in tens, and JPEG stills are
   * converted to limited-range yuv420p and indistinguishable after H.264 at
   * draft/normal CRF; PNG keeps the capture lossless for the high preset.
   * Pipe transport only.
   */
  captureFormat?: CaptureFormat;

  /**
   * Spool every captured still into this directory next to a manifest, and
   * keep them after the render for inspection. With `resume`, a spool whose
   * manifest matches this render supplies its frames instead of re-capturing
   * them. Pipe transport only.
   */
  framesDir?: string;

  /** Reuse frames already present in `framesDir` from an identical render. */
  resume?: boolean;

  /** Per-frame callback for hosts that measure throughput or tee frames. Pipe transport only. */
  onFrame?: (frame: RenderedFrameInfo) => void;

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
  /** Cancel capture/encoding and terminate browser and FFmpeg work. */
  signal?: AbortSignal;
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
  /** Caption mode to bake into the GIF (default: standard). */
  captionStyle?: 'off' | 'standard' | 'social';
  /** Motion profile override (see {@link RenderDocToMp4Options.motion}). */
  motion?: MotionSpec | null;
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

/** One output frame as it passes through the render loop. */
export interface RenderedFrameInfo {
  /** Zero-based index in the output sequence; cover pre-roll frames come first. */
  index: number;
  /** Timeline second rendered (0 during the cover pre-roll). */
  time: number;
  isCover: boolean;
  /** Frames the render emits in total, pre-roll included. */
  totalFrames: number;
  /** True when the still came from a resumed spool instead of a capture. */
  reused: boolean;
  /** Milliseconds spent seeking and capturing (0 when reused). */
  captureMs: number;
}

/** Result returned by renderDocToMp4. */
export interface RenderDocToMp4Result {
  /** Duration of the rendered video in seconds (including pre-roll). */
  duration: number;

  /** Number of frames captured. */
  frameCount: number;

  /** Output file path. */
  outputPath: string;

  /** Frames supplied by a resumed spool instead of a capture (pipe transport). */
  reusedFrameCount?: number;

  /** Spool directory holding every captured still, when one was requested. */
  framesDir?: string;
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
  /** Composed viewport; absent from player bundles older than 2.11.11. */
  getViewport?(): { width: number; height: number };
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
  signal?: AbortSignal;
  fps: number;
  width: number;
  height: number;
  captionStyle?: 'standard' | 'social';
  motion?: MotionSpec | null;
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

/** The live headless page + render-API handle passed to a capture callback. */
interface RenderPageSession {
  page: import('playwright-core').Page;
  renderAPI: import('playwright-core').JSHandle<BrowserRenderAPI>;
}

interface RenderPageOptions {
  signal?: AbortSignal;
  width: number;
  height: number;
  /**
   * Embed narration/scheduled audio in the render page. Video/GIF paths
   * need it (media duration defines the visual timeline); the single-frame
   * dashboard PNG path passes false — there is no clock to feed.
   */
  includeAudio: boolean;
  captionStyle?: 'standard' | 'social';
  /** Motion profile override forwarded to the capture player. */
  motion?: MotionSpec | null;
  animationsEnabled: boolean;
  /** Player rendition mounted in the capture page (default 'slideshow'). */
  displayMode?: 'slideshow' | 'dashboard';
  /** Dashboard-mode options forwarded to the standalone mount. */
  dashboard?: {
    layout?: string;
    title?: boolean;
    style?: DashboardStyleId;
    documentTitle?: string;
  };
  onProgress?: (phase: string, percent: number) => void;
}

/**
 * Boot the standalone player in headless Chromium and hand the ready page
 * to `fn`. Owns everything every capture path must not get subtly wrong:
 * media collection under the shared budget, player-bundle variant
 * selection, render-HTML generation, browser launch + abort wiring, the
 * SSRF route guard, the readiness poll, and teardown.
 */
async function withRenderPage<T>(
  doc: Doc,
  container: ContentContainer,
  options: RenderPageOptions,
  fn: (session: RenderPageSession) => Promise<T>,
): Promise<T> {
  const {
    signal,
    width,
    height,
    includeAudio,
    captionStyle,
    motion,
    animationsEnabled,
    displayMode,
    dashboard,
    onProgress,
  } = options;

  onProgress?.('collecting media', 0);
  signal?.throwIfAborted();
  const { collectImagePaths } = await import('@bendyline/squisq-formats/html');
  signal?.throwIfAborted();
  const budget = createMediaBudget();
  const images = new Map<string, ArrayBuffer>();
  for (const imgPath of collectImagePaths(doc)) {
    signal?.throwIfAborted();
    const data = await container.readFile(imgPath);
    signal?.throwIfAborted();
    if (data) {
      budget.admit(imgPath, data);
      images.set(imgPath, data);
    }
  }

  // Audio remains available to the headless player even for silent GIF output:
  // narration metadata and media duration still define the visual timeline.
  const audio = new Map<string, ArrayBuffer>();
  if (includeAudio) {
    for (const seg of doc.audio?.segments ?? []) {
      signal?.throwIfAborted();
      const data = await container.readFile(seg.src);
      signal?.throwIfAborted();
      if (data) {
        budget.admit(seg.src, data);
        audio.set(seg.src, data);
        audio.set(seg.name, data);
      }
    }
  }

  const mediaSrcs = new Set<string>(resolveMediaSchedule(doc).map((clip) => clip.src));
  for (const block of flattenBlocks(doc.blocks)) {
    for (const layer of block.layers ?? []) {
      if (layer.type === 'video') mediaSrcs.add(layer.content.src);
    }
  }
  for (const src of mediaSrcs) {
    signal?.throwIfAborted();
    if (images.has(src)) continue;
    const data = await container.readFile(src);
    signal?.throwIfAborted();
    if (data) {
      budget.admit(src, data);
      images.set(src, data);
    }
  }

  onProgress?.('generating render HTML', 10);
  signal?.throwIfAborted();
  const playerBundle = await (selectStandalonePlayerVariant(doc) === 'full'
    ? loadFullPlayerBundle()
    : loadPlayerBundle());
  signal?.throwIfAborted();
  const renderHtml = generateRenderHtml(doc, {
    playerScript: playerBundle,
    images,
    audio: audio.size > 0 ? audio : undefined,
    width,
    height,
    captionStyle,
    motion,
    animationsEnabled,
    displayMode,
    dashboard,
  });

  onProgress?.('launching browser', 15);
  signal?.throwIfAborted();
  const { chromium } = await import('playwright-core');
  signal?.throwIfAborted();
  let browser: import('playwright-core').Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      // Keyframe animations must be sampled by the main thread: the
      // compositor rasterises a transforming layer differently depending on
      // whether it caught the animation running, which made mid-motion stills
      // differ between otherwise identical renders.
      args: ['--disable-threaded-animation'],
    });
  } catch (err: unknown) {
    signal?.throwIfAborted();
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new Error(
      'Playwright Chromium is not installed. Run: npx playwright install chromium\n' +
        `(launch failed: ${detail})`,
    );
  }

  const handleAbort = (): void => {
    void browser.close().catch(() => undefined);
  };
  if (signal?.aborted) {
    await browser.close().catch(() => undefined);
    signal.throwIfAborted();
  }
  signal?.addEventListener('abort', handleAbort, { once: true });
  let renderAPI: import('playwright-core').JSHandle<BrowserRenderAPI> | null = null;

  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    // The render HTML already embeds every container asset as data. A document
    // must not be able to turn the CLI/CI host into an SSRF client by naming a
    // loopback, private-network, metadata, file, or arbitrary remote URL.
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (/^(?:about:|blob:|data:)/i.test(url)) await route.continue();
      else await route.abort('blockedbyclient');
    });
    signal?.throwIfAborted();
    await page.setContent(renderHtml, { waitUntil: 'load' });
    signal?.throwIfAborted();
    await page.waitForTimeout(500);
    signal?.throwIfAborted();
    try {
      await page.waitForFunction(
        () => {
          const root = document.getElementById('squisq-root');
          const player = (window as unknown as SquisqBrowserWindow).SquisqPlayer;
          return root ? player?.getHandle(root)?.getRenderAPI() != null : false;
        },
        { timeout: RENDER_BOOT_TIMEOUT_MS },
      );
    } catch {
      signal?.throwIfAborted();
      const errorDetail = pageErrors.length
        ? `\nPage errors:\n  ${pageErrors.join('\n  ')}`
        : '\nNo page errors captured — the player may have failed to mount.';
      throw new Error(
        `The standalone player failed to boot in headless Chromium. ` +
          `Render API did not initialize within ${RENDER_BOOT_TIMEOUT_MS / 1000} seconds.${errorDetail}`,
      );
    }

    // Webfont metrics settle text fitting (the block renderer re-measures on
    // `document.fonts.ready`), so wait for them before the first capture:
    // otherwise an early frame can be taken with fallback glyphs under load
    // and differ from an otherwise identical render.
    signal?.throwIfAborted();
    await page.evaluate(() =>
      Promise.race([
        document.fonts?.ready ?? Promise.resolve(undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]).then(() => undefined),
    );

    renderAPI = await page.evaluateHandle(() => {
      const root = document.getElementById('squisq-root');
      const player = (window as unknown as SquisqBrowserWindow).SquisqPlayer;
      const api = root ? player?.getHandle(root)?.getRenderAPI() : null;
      if (!api) throw new Error('Squisq render API disappeared after initialization.');
      return api;
    });
    signal?.throwIfAborted();
    // The player composes blocks for a viewport. If it did not adopt the export
    // size (an older bundle, or a mount that ignored `viewport`), every frame
    // would be a letterboxed landscape layout — fail now, not after capture.
    const mounted = await renderAPI.evaluate((api) => (api.getViewport ? api.getViewport() : null));
    signal?.throwIfAborted();
    if (mounted && (mounted.width !== width || mounted.height !== height)) {
      throw new Error(
        `The player composed a ${mounted.width}x${mounted.height} viewport for a ` +
          `${width}x${height} render; the output would be letterboxed. ` +
          'Rebuild the CLI player bundle (npm run build:cli) so the render page can pin its viewport.',
      );
    }
    return await fn({ page, renderAPI });
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    await renderAPI?.dispose().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

/** Everything the frame loop needs to know about one output frame. */
interface DocFrameVisit {
  /** Zero-based index in the output sequence (pre-roll first). */
  index: number;
  /** Timeline second to render; pre-roll frames report 0. */
  time: number;
  isCover: boolean;
  /** Repetitions of this still in the output (cover pre-roll collapses to one capture). */
  repeat: number;
  totalFrames: number;
}

interface DocFrameLoopOptions {
  fps: number;
  coverPreRoll: number;
  captureFormat: CaptureFormat;
  signal?: AbortSignal;
  onProgress?: (phase: string, percent: number) => void;
}

interface DocFrameLoopResult {
  totalDuration: number;
  appliedCoverPreRoll: number;
  totalFrames: number;
  preRollFrameCount: number;
}

/** Locate ffmpeg or explain how to install it. Runs before any browser work. */
async function requireFfmpeg(signal?: AbortSignal): Promise<string> {
  const ffmpegPath = (await detectFfmpegDetailed(signal))?.path ?? null;
  signal?.throwIfAborted();
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
  return ffmpegPath;
}

/**
 * Walk the output frame sequence in order, handing the visitor a lazy capture
 * so it can skip the browser work for frames it already has (resume). Frames
 * are deterministic functions of time: the player seeks each one and pauses
 * every animation before the screenshot, so any frame may be captured in any
 * order and a resumed render is pixel-identical to a fresh one.
 */
async function iterateDocFrames(
  session: RenderPageSession,
  options: DocFrameLoopOptions,
  visit: (frame: DocFrameVisit, capture: () => Promise<Uint8Array>) => Promise<void>,
): Promise<DocFrameLoopResult> {
  const { page, renderAPI } = session;
  const { fps, coverPreRoll, captureFormat, signal, onProgress } = options;
  const screenshot = (): Promise<Uint8Array> =>
    captureFormat === 'jpeg'
      ? page.screenshot({ type: 'jpeg', quality: JPEG_CAPTURE_QUALITY })
      : page.screenshot({ type: 'png' });

  const docDuration = await renderAPI.evaluate((api) => api.getDuration());
  signal?.throwIfAborted();
  if (docDuration <= 0) throw new Error('Document has zero duration — nothing to render');

  const hasCover =
    coverPreRoll > 0 ? await renderAPI.evaluate((api) => api.hasCoverBlock()) : false;
  const appliedCoverPreRoll = resolveAppliedCoverPreRoll(coverPreRoll, hasCover);
  const storyFrameCount = Math.ceil(docDuration * fps);
  const preRollFrameCount = Math.ceil(appliedCoverPreRoll * fps);
  const totalFrames = preRollFrameCount + storyFrameCount;
  onProgress?.('capturing frames', 20);

  if (preRollFrameCount > 0) {
    signal?.throwIfAborted();
    await visit(
      { index: 0, time: 0, isCover: true, repeat: preRollFrameCount, totalFrames },
      async () => {
        await renderAPI.evaluate((api) => api.showCover());
        await page.waitForTimeout(100);
        signal?.throwIfAborted();
        const frame = await screenshot();
        await renderAPI.evaluate((api) => api.hideCover());
        return frame;
      },
    );
  }

  const progressEvery = Math.max(1, Math.floor(fps / 2));
  for (let i = 0; i < storyFrameCount; i++) {
    signal?.throwIfAborted();
    const time = frameTimeSeconds(i, fps);
    await visit(
      { index: preRollFrameCount + i, time, isCover: false, repeat: 1, totalFrames },
      async () => {
        await renderAPI.evaluate((api, t: number) => api.seekTo(t), time);
        signal?.throwIfAborted();
        return screenshot();
      },
    );
    if (i % progressEvery === 0 || i === storyFrameCount - 1) {
      onProgress?.(
        'capturing frames',
        20 + Math.round(((preRollFrameCount + i + 1) / totalFrames) * 60),
      );
    }
  }

  return {
    totalDuration: docDuration + appliedCoverPreRoll,
    appliedCoverPreRoll,
    totalFrames,
    preRollFrameCount,
  };
}

/**
 * Capture every frame into memory (bounded), for GIF output and the legacy
 * `frameTransport: 'memory'` MP4 path.
 */
async function captureDocFrames(
  doc: Doc,
  container: ContentContainer,
  options: CaptureDocFramesOptions,
): Promise<CapturedDocFrames> {
  const {
    fps,
    width,
    height,
    captionStyle,
    motion,
    coverPreRoll,
    animationsEnabled,
    onProgress,
    signal,
  } = options;

  signal?.throwIfAborted();
  resolveAppliedCoverPreRoll(coverPreRoll, true);
  // The ffmpeg gate stays ahead of any browser work for the video/GIF paths.
  // The dashboard PNG path never enters this function, so it needs Chromium
  // only — do not move this check into `withRenderPage`.
  const ffmpegPath = await requireFfmpeg(signal);

  const capturedFrames = new CapturedFrameCollector();
  try {
    return await withRenderPage(
      doc,
      container,
      {
        signal,
        width,
        height,
        includeAudio: true,
        captionStyle,
        motion,
        animationsEnabled,
        onProgress,
      },
      async (session) => {
        const loop = await iterateDocFrames(
          session,
          { fps, coverPreRoll, captureFormat: 'png', signal, onProgress },
          async (frame, capture) => {
            capturedFrames.throwIfAborted(signal);
            const bytes = await capture();
            capturedFrames.throwIfAborted(signal);
            capturedFrames.append(bytes, frame.repeat);
          },
        );
        return {
          frames: capturedFrames.release(),
          totalDuration: loop.totalDuration,
          appliedCoverPreRoll: loop.appliedCoverPreRoll,
          ffmpegPath,
        };
      },
    );
  } catch (err: unknown) {
    capturedFrames.clear();
    signal?.throwIfAborted();
    throw err;
  }
}

interface ResolvedMp4Render {
  fps: number;
  quality: VideoQuality;
  width: number;
  height: number;
  captureFormat: CaptureFormat;
}

/**
 * Stream frames straight into ffmpeg. The audio mix is built once the player
 * has booted (the pre-roll offset depends on whether the doc exposes a cover),
 * then every captured — or resumed — still is written to the encoder in order.
 */
async function renderDocToMp4Piped(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToMp4Options,
  render: ResolvedMp4Render,
): Promise<RenderDocToMp4Result> {
  const { signal, onProgress } = options;
  const { fps, quality, width, height, captureFormat } = render;
  const coverPreRoll = options.coverPreRoll ?? 0;
  resolveAppliedCoverPreRoll(coverPreRoll, true);
  if (options.resume && !options.framesDir) {
    throw new Error('resume requires framesDir so there is a spool to resume from');
  }
  const captionStyle = options.captionStyle === 'off' ? undefined : options.captionStyle;
  const motion = options.motion ?? null;
  const animationsEnabled = options.animationsEnabled ?? true;
  const ffmpegPath = await requireFfmpeg(signal);
  const outputPath = resolvePath(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const manifest: FrameManifest = {
    generatedBy: 'squisq-cli',
    docHash: docRenderHash(doc),
    fps,
    width,
    height,
    captionStyle: captionStyle ?? null,
    motion: motion === null ? null : JSON.stringify(motion),
    animationsEnabled,
    coverPreRoll,
    captureFormat,
  };
  const store = options.framesDir
    ? await openDirectoryFrameStore(
        resolvePath(options.framesDir),
        manifest,
        options.resume === true,
      )
    : null;

  const audioPath = join(tmpdir(), `squisq-audio-${randomBytes(8).toString('hex')}.mp3`);
  let audioWritten = false;
  let sink: FrameSink | null = null;
  let reusedFrameCount = 0;
  try {
    const { loop, activeSink } = await withRenderPage(
      doc,
      container,
      {
        signal,
        width,
        height,
        includeAudio: true,
        captionStyle,
        motion,
        animationsEnabled,
        onProgress,
      },
      async (session) => {
        const hasCover =
          coverPreRoll > 0 ? await session.renderAPI.evaluate((api) => api.hasCoverBlock()) : false;
        const appliedCoverPreRoll = resolveAppliedCoverPreRoll(coverPreRoll, hasCover);
        onProgress?.('mixing audio', 18);
        const encodingAudio = await buildMixedAudioTrack(
          doc,
          container,
          ffmpegPath,
          appliedCoverPreRoll,
          signal,
        );
        signal?.throwIfAborted();
        if (encodingAudio) {
          await writeFile(audioPath, encodingAudio);
          audioWritten = true;
        }
        const pipe = createFfmpegPipeSink({
          ffmpegPath,
          outputPath,
          fps,
          width,
          height,
          quality,
          captureFormat,
          audioPath: audioWritten ? audioPath : null,
          signal,
        });
        sink = pipe;
        const result = await iterateDocFrames(
          session,
          { fps, coverPreRoll, captureFormat, signal, onProgress },
          async (frame, capture) => {
            const started = Date.now();
            let bytes: Uint8Array;
            let reused = false;
            if (store?.reusable && (await store.has(frame.index))) {
              bytes = await store.read(frame.index);
              reused = true;
              reusedFrameCount += frame.repeat;
            } else {
              bytes = await capture();
              if (store) await store.write(frame.index, bytes);
            }
            await pipe.write(bytes, frame.repeat);
            options.onFrame?.({
              index: frame.index,
              time: frame.time,
              isCover: frame.isCover,
              totalFrames: frame.totalFrames,
              reused,
              captureMs: reused ? 0 : Date.now() - started,
            });
          },
        );
        return { loop: result, activeSink: pipe };
      },
    );
    onProgress?.('encoding video', 85);
    await activeSink.finish();
    signal?.throwIfAborted();
    onProgress?.('done', 100);
    return {
      duration: loop.totalDuration,
      frameCount: activeSink.frameCount,
      outputPath,
      reusedFrameCount,
      ...(store ? { framesDir: store.dir } : {}),
    };
  } catch (err: unknown) {
    await (sink as FrameSink | null)?.abort();
    throw err;
  } finally {
    if (audioWritten) await rm(audioPath, { force: true }).catch(() => undefined);
  }
}

/** Options for {@link renderDocToDashboardPng}. */
export interface RenderDashboardPngOptions {
  /** Abort the render; rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Optional output file; bytes are always returned. */
  outputPath?: string;
  /** Named resolution preset (default `'fhd'`, 1920×1080). */
  resolution?: DashboardResolutionId;
  /** Custom pixel width; requires `height` and excludes `resolution`. */
  width?: number;
  /** Custom pixel height; requires `width` and excludes `resolution`. */
  height?: number;
  /** Dashboard layout id, or `'auto'` for the block-count pick (default). */
  layout?: string;
  /**
   * Render the document-title band. Leave unset to defer to the doc's own
   * `squisq-dashboard-title` frontmatter (which itself defaults on).
   */
  title?: boolean;
  /**
   * Cell style variant (`basic` | `card` | `panel` | `accent`). Default:
   * the document's own `squisq-dashboard-style` setting.
   */
  style?: DashboardStyleId;
  /** Host-supplied title fallback when the doc has no frontmatter title. */
  documentTitle?: string;
  onProgress?: (phase: string, percent: number) => void;
}

/** Result returned by {@link renderDocToDashboardPng}. */
export interface RenderDashboardPngResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Absolute path written, when `outputPath` was requested. */
  outputPath?: string;
}

/** Options for rendering the managed cover as a standalone PNG. */
export interface RenderCoverPngOptions {
  signal?: AbortSignal;
  outputPath?: string;
  width?: number;
  height?: number;
  animationsEnabled?: boolean;
  onProgress?: (phase: string, percent: number) => void;
}

/** Result returned by {@link renderDocCoverToPng}. */
export interface RenderCoverPngResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  outputPath?: string;
}

/** Render a Doc's managed cover to a PNG with the canonical headless renderer. */
export async function renderDocCoverToPng(
  doc: Doc,
  container: ContentContainer,
  options: RenderCoverPngOptions = {},
): Promise<RenderCoverPngResult> {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  if (!doc.startBlock) throw new Error('Document has no managed cover to render');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64) {
    throw new Error('Cover PNG dimensions must be integers of at least 64 pixels');
  }
  options.signal?.throwIfAborted();
  const bytes = await withRenderPage(
    doc,
    container,
    {
      signal: options.signal,
      width,
      height,
      includeAudio: false,
      animationsEnabled: options.animationsEnabled ?? false,
      displayMode: 'slideshow',
      onProgress: options.onProgress,
    },
    async ({ page, renderAPI }) => {
      options.onProgress?.('rendering cover', 50);
      await renderAPI.evaluate((api) => api.showCover());
      await page.waitForTimeout(100);
      options.signal?.throwIfAborted();
      options.onProgress?.('capturing image', 85);
      return page.screenshot({ type: 'png' });
    },
  );
  let writtenPath: string | undefined;
  if (options.outputPath) {
    const absolute = resolvePath(options.outputPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    writtenPath = absolute;
  }
  options.onProgress?.('done', 100);
  return { bytes, width, height, ...(writtenPath ? { outputPath: writtenPath } : {}) };
}

/**
 * Render a Doc's Dashboard rendition to a single PNG image.
 *
 * Needs Playwright Chromium only — unlike the video paths there is no
 * ffmpeg involvement. Apply a theme upstream (`{ ...doc, themeId }`), the
 * same convention `renderDocToMp4`/`renderDocToGif` use.
 */
export async function renderDocToDashboardPng(
  doc: Doc,
  container: ContentContainer,
  options: RenderDashboardPngOptions = {},
): Promise<RenderDashboardPngResult> {
  const {
    signal,
    outputPath,
    resolution,
    width,
    height,
    layout,
    title,
    style,
    documentTitle,
    onProgress,
  } = options;
  signal?.throwIfAborted();
  // Dimension conflicts and bounds fail here, before any browser work.
  const dimensions = resolveDashboardDimensions({ resolution, width, height });

  const bytes = await withRenderPage(
    doc,
    container,
    {
      signal,
      width: dimensions.width,
      height: dimensions.height,
      includeAudio: false,
      animationsEnabled: false,
      displayMode: 'dashboard',
      dashboard: { layout, title, style, documentTitle },
      onProgress,
    },
    async ({ page, renderAPI }) => {
      onProgress?.('rendering dashboard', 50);
      signal?.throwIfAborted();
      // The dashboard render API's seekTo resolves once fonts and images
      // have settled; the time argument is ignored (there is no clock).
      await renderAPI.evaluate((api) => api.seekTo(0));
      signal?.throwIfAborted();
      await page.waitForTimeout(100);
      signal?.throwIfAborted();
      onProgress?.('capturing image', 85);
      return await page.screenshot({ type: 'png' });
    },
  );

  let writtenPath: string | undefined;
  if (outputPath) {
    const absolute = resolvePath(outputPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    writtenPath = absolute;
  }
  onProgress?.('done', 100);
  return {
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    ...(writtenPath ? { outputPath: writtenPath } : {}),
  };
}

/** Render a Doc + media container to an MP4 video file. */
export async function renderDocToMp4(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToMp4Options,
): Promise<RenderDocToMp4Result> {
  options.signal?.throwIfAborted();
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
  const frameTransport = options.frameTransport ?? 'pipe';
  const captureFormat = options.captureFormat ?? (quality === 'high' ? 'png' : 'jpeg');
  if (frameTransport === 'pipe') {
    return renderDocToMp4Piped(doc, container, options, {
      fps,
      quality,
      width: dimensions.width,
      height: dimensions.height,
      captureFormat,
    });
  }
  if (options.framesDir || options.resume || options.onFrame) {
    throw new Error('framesDir, resume, and onFrame require the pipe frame transport');
  }
  const capture = await captureDocFrames(doc, container, {
    fps,
    width: dimensions.width,
    height: dimensions.height,
    captionStyle: options.captionStyle === 'off' ? undefined : options.captionStyle,
    motion: options.motion ?? null,
    coverPreRoll: options.coverPreRoll ?? 0,
    animationsEnabled: options.animationsEnabled ?? true,
    onProgress: options.onProgress,
    signal: options.signal,
  });
  const frameCount = capture.frames.length;
  try {
    options.onProgress?.('encoding video', 80);
    options.signal?.throwIfAborted();
    const encodingAudio = await buildMixedAudioTrack(
      doc,
      container,
      capture.ffmpegPath,
      capture.appliedCoverPreRoll,
      options.signal,
    );
    options.signal?.throwIfAborted();
    const { framesToMp4Native } = await import('./util/nativeEncoder.js');
    await framesToMp4Native(capture.ffmpegPath, capture.frames, encodingAudio, options.outputPath, {
      fps,
      quality,
      orientation,
      width: dimensions.width,
      height: dimensions.height,
      signal: options.signal,
      onProgress: (percent, phase) =>
        options.onProgress?.(`encoding: ${phase}`, 80 + Math.round(percent * 0.2)),
    });
    options.signal?.throwIfAborted();
    options.onProgress?.('done', 100);
    options.signal?.throwIfAborted();
    return {
      duration: capture.totalDuration,
      frameCount,
      outputPath: options.outputPath,
    };
  } finally {
    capture.frames.length = 0;
  }
}

/** Render a Doc + media container to a silent animated GIF. */
export async function renderDocToGif(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToGifOptions,
): Promise<RenderDocToGifResult> {
  options.signal?.throwIfAborted();
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
    captionStyle: options.captionStyle === 'off' ? undefined : (options.captionStyle ?? 'standard'),
    motion: options.motion ?? null,
    coverPreRoll: options.coverPreRoll ?? 0,
    animationsEnabled: options.animationsEnabled ?? false,
    onProgress: options.onProgress,
    signal: options.signal,
  });
  const frameCount = capture.frames.length;
  try {
    options.onProgress?.('encoding GIF', 80);
    options.signal?.throwIfAborted();
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
      signal: options.signal,
      onProgress: (percent, phase) =>
        options.onProgress?.(`encoding: ${phase}`, 80 + Math.round(percent * 0.2)),
    });
    options.signal?.throwIfAborted();
    options.onProgress?.('done', 100);
    options.signal?.throwIfAborted();

    const hasAudio =
      (doc.audio?.segments?.length ?? 0) > 0 ||
      resolveMediaSchedule(doc).some((clip) => clip.kind === 'audio');
    return {
      duration: capture.totalDuration,
      frameCount,
      outputPath: options.outputPath,
      warnings: hasAudio ? ['Animated GIF does not support audio; audio tracks were omitted.'] : [],
    };
  } finally {
    capture.frames.length = 0;
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
  /** Path to the source MP4 or animated GIF. */
  videoPath: string;
  /** Directory to write thumbnails into. */
  outputDir: string;
  /** Base slug for filenames (produces `{slug}-{width}x{height}.jpg`). */
  slug: string;
  /** Thumbnail sizes to generate. */
  sizes: ThumbnailSpec[];
  /** Overwrite existing thumbnails (default: false). */
  force?: boolean;
  /** Cancels FFmpeg and rejects with the caller's exact abort reason. */
  signal?: AbortSignal;
}

/**
 * Extract thumbnail images from the first frame of an MP4 or animated GIF.
 * Produces JPEG files at each specified size using FFmpeg video filters.
 */
export async function extractThumbnails(options: ExtractThumbnailsOptions): Promise<void> {
  const { videoPath, outputDir, slug, sizes, force, signal } = options;
  const { existsSync } = await import('node:fs');
  const { rm } = await import('node:fs/promises');
  const { isAbsolute, relative, resolve, sep } = await import('node:path');

  signal?.throwIfAborted();
  if (
    typeof slug !== 'string' ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/.test(slug)
  ) {
    throw new TypeError(
      'Thumbnail slug must be 1–128 filename-safe characters (letters, numbers, dot, dash, or underscore) and must start and end with a letter or number.',
    );
  }
  for (const [index, thumb] of sizes.entries()) {
    if (!Number.isSafeInteger(thumb.width) || thumb.width <= 0) {
      throw new TypeError(`Thumbnail sizes[${index}].width must be a positive integer.`);
    }
    if (!Number.isSafeInteger(thumb.height) || thumb.height <= 0) {
      throw new TypeError(`Thumbnail sizes[${index}].height must be a positive integer.`);
    }
  }

  const resolvedOutputDir = resolve(outputDir);
  const outputPaths = sizes.map((thumb) => {
    const outputPath = resolve(resolvedOutputDir, `${slug}-${thumb.width}x${thumb.height}.jpg`);
    const rel = relative(resolvedOutputDir, outputPath);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new TypeError('Thumbnail output path must remain inside outputDir.');
    }
    return outputPath;
  });

  const ffmpegPath = (await detectFfmpegDetailed(signal))?.path ?? null;
  if (!ffmpegPath) {
    throw new Error(
      'ffmpeg is required for thumbnail extraction but not found in PATH.\n' +
        'Install it with:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Windows: winget install ffmpeg',
    );
  }

  const generatedPaths: string[] = [];
  try {
    for (const [index, thumb] of sizes.entries()) {
      signal?.throwIfAborted();
      const outputPath = outputPaths[index]!;
      if (!force && existsSync(outputPath)) continue;

      try {
        await runFfmpeg(
          ffmpegPath,
          ['-y', '-i', videoPath, '-vf', thumb.filter, '-frames:v', '1', '-q:v', '2', outputPath],
          {
            timeoutMs: 30_000,
            failureMessage: `Thumbnail extraction failed (${thumb.name})`,
            signal,
          },
        );
        signal?.throwIfAborted();
        generatedPaths.push(outputPath);
      } catch (error: unknown) {
        await rm(outputPath, { force: true });
        throw error;
      }
    }
    signal?.throwIfAborted();
  } catch (error: unknown) {
    await Promise.allSettled(generatedPaths.map((path) => rm(path, { force: true })));
    throw error;
  }
}
