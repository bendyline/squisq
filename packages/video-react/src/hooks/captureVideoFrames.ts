/**
 * captureVideoFrames — decoded source frames for faster-than-realtime export.
 *
 * A `<video>` element can only reach a new frame by seeking or playing. Seeks
 * decode forward from the previous keyframe (screen recordings keep those
 * minutes apart), and playback runs on the wall clock, so frame capture
 * through the element can never outrun realtime. This module demuxes each
 * clip's source with mediabunny and decodes it with WebCodecs instead: one
 * sequential decoder per element, advanced exactly as far as each captured
 * frame needs. Its selected frame is drawn once into a per-element canvas at
 * display orientation, and the capture compositors draw that canvas in place
 * of the element.
 *
 * Anything the decoder cannot serve (a non-local URL, an unsupported
 * container or codec, a decode error mid-export) is released back to the
 * element path, which stays correct at realtime speed.
 */

import { BlobSource, Input, MATROSKA, MP4, QTFF, VideoSampleSink, WEBM } from 'mediabunny';
import type { RenderVideoFrameSelector } from '@bendyline/squisq-react';

/** Presentation-time slack so a target computed as 0.0333329 still selects the 0.033333 frame. */
const FRAME_TIME_EPSILON_SECONDS = 1e-4;
/**
 * A forward jump larger than this restarts decoding at the target's keyframe
 * rather than decoding every intermediate frame (a re-activated clip, a
 * trimmed in-point). Sequential capture steps are one output frame long.
 */
const MAX_SEQUENTIAL_DECODE_GAP_SECONDS = 3;
/** Sources whose bytes are already local. Remote URLs keep the element path. */
const DECODABLE_SOURCE_URL = /^(?:blob|data):/i;
const INPUT_FORMATS = [MP4, QTFF, WEBM, MATROSKA];

/** A decoded replacement for one element's pixels. */
export interface DecodedCaptureFrame {
  /** Holds the selected source frame at display orientation and size. */
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /** Presentation timestamp (seconds) of the drawn source frame. */
  readonly timestamp: number;
}

/** Pixel source for drawing a capture video, decoded or element-backed. */
export interface CaptureVideoImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** A cursor's canvas and the source frame drawn into it (`null` before the first draw). */
export interface DecodedCaptureCanvas {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  timestamp: number | null;
}

/**
 * The slice of a decoded frame the cursor uses — structurally mediabunny's
 * `VideoSample`, kept local so its types never reach this package's
 * declarations (mediabunny is bundled, not a consumer dependency).
 */
export interface DecodedFrameSample {
  readonly timestamp: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  draw(
    context: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ): void;
  close(): void;
}

/** Structurally mediabunny's `VideoSampleSink`. */
export interface DecodedFrameSampleSource {
  samples(startTimestamp: number): AsyncGenerator<DecodedFrameSample, void, unknown>;
}

/**
 * Elements are unique per capture session, so one module-level table lets
 * every compositor find decoded pixels without threading a session object
 * through each exported helper. Entries die with their elements.
 */
const decodedFrames = new WeakMap<HTMLVideoElement, DecodedCaptureCanvas>();

/** Decoded pixels that stand in for this element during capture, once a frame is drawn. */
export function getDecodedCaptureFrame(video: HTMLVideoElement): DecodedCaptureFrame | null {
  const frame = decodedFrames.get(video);
  if (!frame || frame.timestamp === null) return null;
  return {
    canvas: frame.canvas,
    width: frame.width,
    height: frame.height,
    timestamp: frame.timestamp,
  };
}

/** The pixels a compositor should draw for this element right now. */
export function resolveCaptureVideoImage(video: HTMLVideoElement): CaptureVideoImage {
  const decoded = getDecodedCaptureFrame(video);
  if (decoded) return { source: decoded.canvas, width: decoded.width, height: decoded.height };
  return { source: video, width: video.videoWidth, height: video.videoHeight };
}

function captureVideoSource(video: HTMLVideoElement): string {
  return video.currentSrc || video.src;
}

/**
 * One sequential decode cursor over a source's primary video track.
 *
 * `selectFrame` shows the last frame whose presentation timestamp is at or
 * before the target — the frame an element displays at that `currentTime`.
 * Monotonic small steps pull straight from mediabunny's pre-decoding sample
 * iterator, so each source frame is decoded once; backward or long forward
 * jumps restart the iterator at the target's keyframe.
 */
export class DecodedVideoCursor {
  readonly frame: DecodedCaptureCanvas;
  private iterator: AsyncGenerator<DecodedFrameSample, void, unknown> | null = null;
  private lookahead: DecodedFrameSample | null = null;
  /** True while showing a track's first frame for a target before it. */
  private showingLeadingFrame = false;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  /**
   * @param source Sequential sample iterator factory for one video track.
   * @param releaseSource Frees the demuxer behind `source`.
   */
  constructor(
    private readonly source: DecodedFrameSampleSource,
    private readonly releaseSource: () => void,
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ) {
    canvas.width = width;
    canvas.height = height;
    this.frame = { canvas, width, height, timestamp: null };
  }

  /** Open a local source, or null when it has no decodable video track. */
  static async open(blob: Blob, ownerDocument: Document): Promise<DecodedVideoCursor | null> {
    const input = new Input({ source: new BlobSource(blob), formats: INPUT_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        return null;
      }
      const width = track.displayWidth;
      const height = track.displayHeight;
      if (width <= 0 || height <= 0) {
        input.dispose();
        return null;
      }
      return new DecodedVideoCursor(
        new VideoSampleSink(track),
        () => input.dispose(),
        ownerDocument.createElement('canvas'),
        width,
        height,
      );
    } catch {
      input.dispose();
      return null;
    }
  }

  /** Draw the frame displayed at `targetTime` (seconds). Calls run in order. */
  selectFrame(targetTime: number): Promise<void> {
    const selection = this.queue.then(() => this.advanceTo(targetTime));
    // Keep the chain alive after a failure; the caller observes the rejection.
    this.queue = selection.catch(() => undefined);
    return selection;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lookahead?.close();
    this.lookahead = null;
    void this.iterator?.return();
    this.iterator = null;
    this.releaseSource();
    this.frame.canvas.width = 0;
    this.frame.canvas.height = 0;
    this.frame.timestamp = null;
  }

  private async advanceTo(targetTime: number): Promise<void> {
    if (this.disposed) throw new Error('Decoded capture video was released.');
    const target = targetTime + FRAME_TIME_EPSILON_SECONDS;
    const shown = this.frame.timestamp;
    const continues =
      this.iterator !== null &&
      shown !== null &&
      target - shown <= MAX_SEQUENTIAL_DECODE_GAP_SECONDS &&
      (target >= shown || this.showingLeadingFrame);
    if (continues && target < shown) return;

    let candidate: DecodedFrameSample | null = null;
    try {
      if (!continues) {
        await this.restartAt(target);
        // The iterator opens on the frame displayed at the target (or the
        // track's first frame when the target precedes it).
        candidate = await this.pull();
        if (!candidate) return;
      }
      for (;;) {
        const next = this.lookahead ?? (await this.pull());
        this.lookahead = null;
        if (!next) break;
        if (next.timestamp > target) {
          this.lookahead = next;
          break;
        }
        candidate?.close();
        candidate = next;
      }
      // A release during the awaits above already freed the canvas.
      if (candidate && !this.disposed) {
        this.present(candidate);
        this.showingLeadingFrame = candidate.timestamp > target;
      }
    } finally {
      candidate?.close();
    }
  }

  private async restartAt(target: number): Promise<void> {
    this.lookahead?.close();
    this.lookahead = null;
    await this.iterator?.return();
    this.iterator = this.source.samples(target);
  }

  private async pull(): Promise<DecodedFrameSample | null> {
    const result = await this.iterator?.next();
    return result && !result.done ? result.value : null;
  }

  private present(sample: DecodedFrameSample): void {
    const { frame } = this;
    // Recorder streams may change resolution mid-file (a resized shared
    // window). Follow the frame, as an element's intrinsic size would, so
    // object-fit math stays exact.
    if (sample.displayWidth !== frame.width || sample.displayHeight !== frame.height) {
      frame.width = sample.displayWidth;
      frame.height = sample.displayHeight;
      frame.canvas.width = frame.width;
      frame.canvas.height = frame.height;
    }
    const context = frame.canvas.getContext('2d');
    if (!context) throw new Error('Could not create the decoded video frame canvas context');
    // draw() honors the sample's rotation and flip metadata.
    sample.draw(context, 0, 0, frame.width, frame.height);
    frame.timestamp = sample.timestamp;
  }
}

interface DecodedVideoBinding {
  src: string;
  cursor: DecodedVideoCursor;
}

/**
 * Per-capture-session owner of decoded video sources. `selectFrame` is the
 * DocPlayer `renderVideoFrameSelector`; `attach` binds newly mounted or
 * re-sourced elements before each capture.
 */
export class CaptureVideoFrameRegistry {
  private readonly bindings = new Map<HTMLVideoElement, DecodedVideoBinding>();
  private readonly blobs = new Map<string, Promise<Blob | null>>();
  /** Sources that failed to open or decode; they keep the element path. */
  private readonly undecodableSources = new Set<string>();
  private readonly opening = new Map<HTMLVideoElement, Promise<boolean>>();
  private disposed = false;

  /**
   * Bind decoders to every video under `root` that lacks one for its current
   * source, and release bindings whose element left the DOM or changed
   * source. Returns how many elements were newly bound: their pixels now
   * come from the decoder, so a caller must re-run its seek barrier.
   */
  async attach(root: HTMLElement): Promise<number> {
    for (const [video, binding] of this.bindings) {
      if (!video.isConnected || captureVideoSource(video) !== binding.src) this.release(video);
    }
    const results = await Promise.all(
      Array.from(root.querySelectorAll('video'))
        .filter((video) => !this.bindings.has(video))
        .map((video) => this.bind(video)),
    );
    return results.filter(Boolean).length;
  }

  /** Whether capture draws this element from decoded frames. */
  isDecoded(video: HTMLVideoElement): boolean {
    return this.bindings.has(video);
  }

  readonly selectFrame: RenderVideoFrameSelector = async (video, targetTime) => {
    const binding = this.bindings.get(video);
    if (!binding || binding.src !== captureVideoSource(video)) return false;
    try {
      await binding.cursor.selectFrame(targetTime);
      return true;
    } catch {
      // Hand this source back to the element for the rest of the export.
      this.undecodableSources.add(binding.src);
      this.release(video);
      return false;
    }
  };

  dispose(): void {
    this.disposed = true;
    for (const video of [...this.bindings.keys()]) this.release(video);
    this.blobs.clear();
    this.opening.clear();
  }

  private bind(video: HTMLVideoElement): Promise<boolean> {
    const pending = this.opening.get(video);
    if (pending) return pending;
    const opening = this.open(video).finally(() => this.opening.delete(video));
    this.opening.set(video, opening);
    return opening;
  }

  private async open(video: HTMLVideoElement): Promise<boolean> {
    const src = captureVideoSource(video);
    if (!src || !DECODABLE_SOURCE_URL.test(src) || this.undecodableSources.has(src)) return false;
    const blob = await this.loadBlob(src);
    const cursor = blob ? await DecodedVideoCursor.open(blob, video.ownerDocument) : null;
    if (!cursor) {
      this.undecodableSources.add(src);
      return false;
    }
    if (this.disposed || !video.isConnected || captureVideoSource(video) !== src) {
      cursor.dispose();
      return false;
    }
    this.bindings.set(video, { src, cursor });
    decodedFrames.set(video, cursor.frame);
    // The element is never positioned again; keep it still and let the
    // clip layers know capture owns its clock.
    video.pause();
    video.dataset.captureDecoded = 'true';
    return true;
  }

  private loadBlob(src: string): Promise<Blob | null> {
    let blob = this.blobs.get(src);
    if (!blob) {
      blob = fetch(src)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null);
      this.blobs.set(src, blob);
    }
    return blob;
  }

  private release(video: HTMLVideoElement): void {
    const binding = this.bindings.get(video);
    if (!binding) return;
    this.bindings.delete(video);
    if (decodedFrames.get(video) === binding.cursor.frame) decodedFrames.delete(video);
    delete video.dataset.captureDecoded;
    binding.cursor.dispose();
  }
}
