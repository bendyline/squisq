/**
 * Hard retained-memory ceiling for PNG frames captured before native encoding.
 *
 * The Node renderer currently keeps captured PNGs in memory while FFmpeg is
 * prepared. Bounding the actual encoded PNG bytes prevents visually complex
 * documents from exhausting the process even when their dimensions and frame
 * counts satisfy higher-level render budgets.
 */
export const MAX_CAPTURED_FRAME_BYTES = 256 * 1024 * 1024;

/** Stable failure raised before another captured frame is retained. */
export class CapturedFrameBudgetError extends Error {
  public readonly code = 'captured-frame-budget-exceeded';

  public constructor(
    public readonly capturedBytes: number,
    public readonly attemptedFrameBytes: number,
    public readonly maximumBytes: number,
  ) {
    super(
      `Captured PNG frames would retain ${capturedBytes + attemptedFrameBytes} bytes, ` +
        `exceeding the ${maximumBytes}-byte rendered-media memory limit.`,
    );
    this.name = 'CapturedFrameBudgetError';
  }
}

/**
 * Owns captured-frame references until they are handed to an encoder.
 * Repeated references (cover pre-roll) count once toward retained bytes.
 */
export class CapturedFrameCollector {
  private values: Uint8Array[] = [];
  private seen = new WeakSet<Uint8Array>();
  private bytes = 0;

  public constructor(private readonly maximumBytes = MAX_CAPTURED_FRAME_BYTES) {
    if (
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > MAX_CAPTURED_FRAME_BYTES
    ) {
      throw new Error(
        `Captured-frame byte limit must be between 1 and ${MAX_CAPTURED_FRAME_BYTES}`,
      );
    }
  }

  public get frameCount(): number {
    return this.values.length;
  }

  public get retainedBytes(): number {
    return this.bytes;
  }

  public append(frame: Uint8Array, repetitions = 1): void {
    if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
      throw new Error('Captured-frame repetition count must be a positive integer');
    }
    const additionalBytes = this.seen.has(frame) ? 0 : frame.byteLength;
    if (this.bytes + additionalBytes > this.maximumBytes) {
      const capturedBytes = this.bytes;
      this.clear();
      throw new CapturedFrameBudgetError(capturedBytes, additionalBytes, this.maximumBytes);
    }
    if (additionalBytes > 0) {
      this.seen.add(frame);
      this.bytes += additionalBytes;
    }
    for (let index = 0; index < repetitions; index += 1) this.values.push(frame);
  }

  /** Clear retained frame references before preserving the caller's abort reason. */
  public throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    this.clear();
    signal.throwIfAborted();
  }

  /** Transfer ownership of the captured frames to the encoder. */
  public release(): Uint8Array[] {
    const released = this.values;
    this.values = [];
    this.seen = new WeakSet<Uint8Array>();
    this.bytes = 0;
    return released;
  }

  /** Drop every retained reference so failed/cancelled captures can be collected promptly. */
  public clear(): void {
    this.values.length = 0;
    this.values = [];
    this.seen = new WeakSet<Uint8Array>();
    this.bytes = 0;
  }
}
