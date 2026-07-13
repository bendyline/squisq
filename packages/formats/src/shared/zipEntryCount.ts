/** Narrow EOCD preflight for rejecting record-count bombs before JSZip allocation. */

import { throwIfZipAborted } from './zipLimits.js';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_LOCATOR = 0x07064b50;
const UINT16_MAX = 0xffff;
const MIN_EOCD_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

export type ZipInput = ArrayBuffer | Uint8Array | Blob;

/** Materialize Blob input once when possible so preflight bytes feed JSZip too. */
export async function prepareZipInput(
  data: ZipInput,
  signal?: AbortSignal,
): Promise<{ input: ZipInput; bytes?: Uint8Array }> {
  throwIfZipAborted(signal);
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return { input: bytes, bytes };
  }
  if (!isBlobLike(data)) {
    const bytes = new Uint8Array(data);
    return { input: bytes, bytes };
  }

  const bytes = await readBlobBytes(data, signal);
  throwIfZipAborted(signal);
  return bytes ? { input: bytes, bytes } : { input: data };
}

/**
 * Read the declared total central-directory record count when unambiguous.
 * Returns undefined for absent, trailing, malformed, or unsupported metadata;
 * JSZip remains authoritative in those cases.
 */
export function declaredZipEntryCount(bytes: Uint8Array): number | undefined {
  const eocdOffset = findEocd(bytes);
  if (eocdOffset === undefined) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(eocdOffset + 10, true);
  if (count !== UINT16_MAX) return count;
  return readZip64EntryCount(view, eocdOffset);
}

function findEocd(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < MIN_EOCD_BYTES) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.byteLength - MIN_EOCD_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = bytes.byteLength - MIN_EOCD_BYTES; offset >= earliest; offset--) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + MIN_EOCD_BYTES + commentLength === bytes.byteLength) return offset;
  }
  return undefined;
}

function readZip64EntryCount(view: DataView, eocdOffset: number): number | undefined {
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || view.getUint32(locatorOffset, true) !== ZIP64_END_LOCATOR) {
    return undefined;
  }
  const recordOffset = readSafeUint64(view, locatorOffset + 8);
  if (
    recordOffset === undefined ||
    recordOffset < 0 ||
    recordOffset + 40 > view.byteLength ||
    view.getUint32(recordOffset, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY
  ) {
    return undefined;
  }
  return readSafeUint64(view, recordOffset + 32);
}

function readSafeUint64(view: DataView, offset: number): number | undefined {
  if (offset < 0 || offset + 8 > view.byteLength) return undefined;
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  const value = high * 0x1_0000_0000 + low;
  return Number.isSafeInteger(value) ? value : undefined;
}

function isBlobLike(data: ZipInput): data is Blob {
  const candidate = data as Blob;
  return typeof candidate.size === 'number' && typeof candidate.slice === 'function';
}

async function readBlobBytes(blob: Blob, signal?: AbortSignal): Promise<Uint8Array | undefined> {
  const arrayBuffer = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof arrayBuffer === 'function') {
    return new Uint8Array(await raceWithAbort(arrayBuffer.call(blob), signal));
  }
  if (typeof FileReader === 'undefined') return undefined;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = (): void => signal?.removeEventListener('abort', handleAbort);
    const finish = (work: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      work();
    };
    const handleAbort = (): void => {
      if (settled) return;
      const reason = signal?.reason ?? new Error('ZIP operation was cancelled');
      // Mark the promise settled before FileReader.abort(): browsers are
      // allowed to dispatch `abort` synchronously and re-enter this handler.
      finish(() => reject(reason));
      try {
        reader.abort();
      } catch {
        // Preserve the caller's reason if a platform reader is already done.
      }
    };
    reader.onload = () => finish(() => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () =>
      finish(() => reject(reader.error ?? new Error('Could not read ZIP blob.')));
    reader.onabort = handleAbort;
    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    reader.readAsArrayBuffer(blob);
  });
}

function raceWithAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfZipAborted(signal);
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      complete();
    };
    const handleAbort = (): void =>
      finish(() => reject(signal.reason ?? new Error('ZIP operation was cancelled')));
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
