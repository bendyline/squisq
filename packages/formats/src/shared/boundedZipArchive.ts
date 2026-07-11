/** Incremental JSZip member reads governed by one shared archive budget. */

import JSZip from 'jszip';
import {
  archiveTooLargeError,
  assertNonNegativeFinite,
  compressionRatio,
  compressionRatioError,
  entryTooLargeError,
  resolveZipSafetyLimits,
  validateZipArchive,
  tooManyEntriesError,
  ZipSafetyError,
  type ResolvedZipSafetyLimits,
  type ValidatedZipEntry,
  type ZipSafetyErrorCode,
  type ZipSafetyLimits,
} from './zipLimits.js';
import { declaredZipEntryCount, prepareZipInput, type ZipInput } from './zipEntryCount.js';

interface ActiveZipRead {
  stop(error: ZipSafetyError): void;
}

interface ZipChunkStream {
  on(event: 'data', callback: (chunk: Uint8Array) => void): ZipChunkStream;
  on(event: 'error', callback: (error: unknown) => void): ZipChunkStream;
  on(event: 'end', callback: () => void): ZipChunkStream;
  pause(): ZipChunkStream;
  resume(): ZipChunkStream;
}

interface StreamableZipObject {
  internalStream(type: 'uint8array'): ZipChunkStream;
}

/**
 * A JSZip archive whose member reads share one actual-byte budget.
 *
 * JSZip's promise API accumulates a complete inflated member before returning.
 * This wrapper instead consumes `internalStream('uint8array')`, checks every
 * emitted chunk, and pauses every active stream as soon as any limit fails.
 * Completed reads are cached so repeated OOXML part access is neither inflated
 * nor charged twice.
 */
export interface BoundedZipArchive {
  readonly zip: JSZip;
  readonly entries: readonly ValidatedZipEntry[];
  readonly emittedUncompressedBytes: number;
  read(path: string, maxBytes?: number): Promise<Uint8Array | null>;
  readText(path: string, maxBytes?: number): Promise<string | null>;
  release(path: string): void;
}

class JsZipBoundedArchive implements BoundedZipArchive {
  readonly zip: JSZip;
  readonly entries: readonly ValidatedZipEntry[];

  private readonly limits: ResolvedZipSafetyLimits;
  private readonly entriesByPath: ReadonlyMap<string, ValidatedZipEntry>;
  private readonly reads = new Map<string, Promise<Uint8Array>>();
  private readonly activeReads = new Set<ActiveZipRead>();
  private terminalError?: ZipSafetyError;
  private emittedBytes = 0;

  constructor(zip: JSZip, entries: readonly ValidatedZipEntry[], limits: ResolvedZipSafetyLimits) {
    this.zip = zip;
    this.entries = entries;
    this.limits = limits;
    this.entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  }

  /** Actual uncompressed bytes accepted from JSZip streams so far. */
  get emittedUncompressedBytes(): number {
    return this.emittedBytes;
  }

  /** Read and cache one member, returning null when it does not exist. */
  async read(path: string, maxBytes?: number): Promise<Uint8Array | null> {
    this.throwIfFailed();
    if (maxBytes !== undefined) assertNonNegativeFinite('member read limit', maxBytes);
    const entry = this.entriesByPath.get(path);
    if (!entry) return null;

    let pending = this.reads.get(path);
    if (!pending) {
      pending = this.streamEntry(entry, maxBytes);
      this.reads.set(path, pending);
    }
    const bytes = await pending;
    if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
      const error = entryTooLargeError(path, bytes.byteLength, maxBytes);
      this.failArchive(error);
      throw error;
    }
    return bytes;
  }

  /** Read one UTF-8 text member, returning null when it does not exist. */
  async readText(path: string, maxBytes?: number): Promise<string | null> {
    const bytes = await this.read(path, maxBytes);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  /** Release a cached member when a sequential consumer has taken ownership. */
  release(path: string): void {
    this.reads.delete(path);
  }

  private streamEntry(metadata: ValidatedZipEntry, readLimit?: number): Promise<Uint8Array> {
    const { path, entry, declaredSize, crc32: expectedCrc } = metadata;
    const effectiveEntryLimit = Math.min(
      this.limits.maxEntryUncompressedBytes,
      readLimit ?? Number.POSITIVE_INFINITY,
    );
    // Never trust a declaration enough to allocate it up front. A forged
    // 511 MiB size must not force 511 MiB of memory for a tiny member.
    let output: Uint8Array = new Uint8Array(0);
    let stream: ZipChunkStream;
    try {
      stream = (entry as unknown as StreamableZipObject).internalStream('uint8array');
    } catch (error: unknown) {
      const safeError = asZipSafetyError(error, path);
      this.failArchive(safeError);
      return Promise.reject(safeError);
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      let written = 0;
      let crc = 0xffffffff;

      const controller: ActiveZipRead = {
        stop: (error) => {
          if (settled) return;
          settled = true;
          this.activeReads.delete(controller);
          // Public JSZip cancellation is cooperative. It prevents another
          // compressed-input tick; data already emitted synchronously by the
          // current tick is ignored because `settled` is now true.
          try {
            stream.pause();
          } catch {
            // Reject with the original safety failure even if a malformed
            // third-party stream cannot be paused cleanly.
          }
          reject(error);
        },
      };
      this.activeReads.add(controller);

      stream
        .on('data', (chunk: Uint8Array) => {
          if (settled) return;
          const nextWritten = written + chunk.byteLength;
          try {
            this.assertChunkAllowed(metadata, nextWritten, chunk.byteLength, effectiveEntryLimit);
            output = growOutput(output, nextWritten, declaredSize, effectiveEntryLimit);
            output.set(chunk, written);
            written = nextWritten;
            crc = updateCrc32(crc, chunk);
          } catch (error: unknown) {
            this.failArchive(asZipSafetyError(error, path));
          }
        })
        .on('error', (error: unknown) => {
          if (settled) return;
          const message = error instanceof Error ? error.message : String(error);
          const code: ZipSafetyErrorCode = message.includes('uncompressed data size mismatch')
            ? 'size-mismatch'
            : 'decompression-failed';
          this.failArchive(
            new ZipSafetyError(code, `ZIP import: could not decompress ${path}: ${message}`, {
              path,
              cause: error,
            }),
          );
        })
        .on('end', () => {
          if (settled) return;
          if (declaredSize !== undefined && written !== declaredSize) {
            this.failArchive(
              new ZipSafetyError(
                'size-mismatch',
                `ZIP import: archive member size does not match its metadata: ${path}.`,
                { path, actual: written },
              ),
            );
            return;
          }
          const actualCrc = (crc ^ 0xffffffff) >>> 0;
          if (expectedCrc !== undefined && actualCrc !== expectedCrc >>> 0) {
            this.failArchive(
              new ZipSafetyError('crc-mismatch', `ZIP import: CRC32 mismatch for ${path}.`, {
                path,
              }),
            );
            return;
          }

          settled = true;
          this.activeReads.delete(controller);
          resolve(output.byteLength === written ? output : output.slice(0, written));
        })
        .resume();
    });
  }

  private assertChunkAllowed(
    entry: ValidatedZipEntry,
    nextEntryBytes: number,
    chunkBytes: number,
    effectiveEntryLimit: number,
  ): void {
    if (entry.declaredSize !== undefined && nextEntryBytes > entry.declaredSize) {
      throw new ZipSafetyError(
        'size-mismatch',
        `ZIP import: archive member size does not match its metadata: ${entry.path}.`,
        { path: entry.path, actual: nextEntryBytes },
      );
    }
    if (
      effectiveEntryLimit < this.limits.maxUncompressedBytes &&
      nextEntryBytes > effectiveEntryLimit
    ) {
      throw entryTooLargeError(entry.path, nextEntryBytes, effectiveEntryLimit);
    }

    const nextTotal = this.emittedBytes + chunkBytes;
    if (nextTotal > this.limits.maxUncompressedBytes) {
      throw archiveTooLargeError(nextTotal, this.limits.maxUncompressedBytes);
    }
    if (nextEntryBytes > effectiveEntryLimit) {
      throw entryTooLargeError(entry.path, nextEntryBytes, effectiveEntryLimit);
    }

    const ratio =
      entry.compressedSize === undefined
        ? undefined
        : compressionRatio(nextEntryBytes, entry.compressedSize);
    if (ratio !== undefined && ratio > this.limits.maxCompressionRatio) {
      throw compressionRatioError(entry.path, ratio, this.limits.maxCompressionRatio);
    }
    this.emittedBytes = nextTotal;
  }

  private failArchive(error: ZipSafetyError): void {
    if (this.terminalError) return;
    this.terminalError = error;
    for (const active of [...this.activeReads]) active.stop(error);
  }

  private throwIfFailed(): void {
    if (this.terminalError) throw this.terminalError;
  }
}

/** Load with JSZip, validate metadata, and create a shared bounded read session. */
export async function openBoundedZipArchive(
  data: ZipInput,
  limits: ZipSafetyLimits = {},
): Promise<BoundedZipArchive> {
  const resolved = resolveZipSafetyLimits(limits);
  let prepared: { input: ZipInput; bytes?: Uint8Array };
  try {
    prepared = await prepareZipInput(data);
  } catch (error: unknown) {
    throw invalidArchiveError(error);
  }
  if (prepared.bytes) {
    const declaredEntries = declaredZipEntryCount(prepared.bytes);
    if (declaredEntries !== undefined && declaredEntries > resolved.maxEntries) {
      throw tooManyEntriesError(declaredEntries, resolved.maxEntries);
    }
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(prepared.input);
  } catch (error: unknown) {
    throw invalidArchiveError(error);
  }
  return createBoundedZipArchive(zip, resolved);
}

function invalidArchiveError(cause: unknown): ZipSafetyError {
  return new ZipSafetyError('invalid-archive', 'ZIP import: archive is not readable.', { cause });
}

/** Wrap an existing JSZip instance in the same validation and shared budget. */
export function createBoundedZipArchive(
  zip: JSZip,
  limits: ZipSafetyLimits = {},
): BoundedZipArchive {
  const resolved = resolveZipSafetyLimits(limits);
  const entries = validateZipArchive(zip, resolved);
  return new JsZipBoundedArchive(zip, entries, resolved);
}

function asZipSafetyError(error: unknown, path: string): ZipSafetyError {
  if (error instanceof ZipSafetyError) return error;
  return new ZipSafetyError(
    'decompression-failed',
    `ZIP import: could not decompress ${path}: ${error instanceof Error ? error.message : String(error)}`,
    { path, cause: error },
  );
}

function growOutput(
  current: Uint8Array,
  required: number,
  declaredSize: number | undefined,
  limit: number,
): Uint8Array {
  if (required <= current.byteLength) return current;
  const maximum = Math.min(declaredSize ?? limit, limit);
  const grownSize = current.byteLength === 0 ? required : current.byteLength * 2;
  const nextSize = Math.min(maximum, Math.max(required, grownSize));
  const next = new Uint8Array(nextSize);
  next.set(current);
  return next;
}

let crcTable: Uint32Array | undefined;

function updateCrc32(crc: number, bytes: Uint8Array): number {
  const table = crcTable ?? (crcTable = makeCrcTable());
  let next = crc >>> 0;
  for (const byte of bytes) next = table[(next ^ byte) & 0xff]! ^ (next >>> 8);
  return next >>> 0;
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
}
