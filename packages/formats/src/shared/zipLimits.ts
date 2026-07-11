/** ZIP safety policy, structured errors, path checks, and metadata validation. */

import type JSZip from 'jszip';

export interface ZipSafetyLimits {
  /** Maximum number of archive records, including directories. Default: 10,000. */
  maxEntries?: number;
  /** Maximum uncompressed bytes for one member. Defaults to maxUncompressedBytes. */
  maxEntryUncompressedBytes?: number;
  /** Maximum total uncompressed bytes across the archive. Default: 512 MiB. */
  maxUncompressedBytes?: number;
  /** Maximum uncompressed/compressed ratio for a member. Default: 1,000. */
  maxCompressionRatio?: number;
}

export type ZipSafetyErrorCode =
  | 'invalid-limit'
  | 'invalid-archive'
  | 'unsafe-path'
  | 'invalid-entry-metadata'
  | 'too-many-entries'
  | 'entry-too-large'
  | 'archive-too-large'
  | 'compression-ratio-exceeded'
  | 'size-mismatch'
  | 'crc-mismatch'
  | 'decompression-failed';

export interface ZipSafetyErrorOptions {
  path?: string;
  limit?: number;
  actual?: number;
  cause?: unknown;
}

/** A stable, machine-readable error raised while validating or reading a ZIP. */
export class ZipSafetyError extends Error {
  readonly code: ZipSafetyErrorCode;
  readonly path?: string;
  readonly limit?: number;
  readonly actual?: number;

  constructor(code: ZipSafetyErrorCode, message: string, options: ZipSafetyErrorOptions = {}) {
    super(message);
    this.name = 'ZipSafetyError';
    this.code = code;
    this.path = options.path;
    this.limit = options.limit;
    this.actual = options.actual;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface ValidatedZipEntry {
  path: string;
  entry: JSZip.JSZipObject;
  declaredSize?: number;
  compressedSize?: number;
  crc32?: number;
}

export interface ResolvedZipSafetyLimits {
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_MAX_ZIP_ENTRIES = 10_000;
export const DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_ZIP_COMPRESSION_RATIO = 1_000;

/**
 * Validate central-directory metadata before any member is decompressed.
 * JSZip normalizes traversal names, so inspect `unsafeOriginalName` too.
 */
export function validateZipArchive(zip: JSZip, limits: ZipSafetyLimits = {}): ValidatedZipEntry[] {
  const resolved = resolveZipSafetyLimits(limits);
  const files: ValidatedZipEntry[] = [];
  let memberCount = 0;
  let declaredTotal = 0;
  let oversizedEntry: { path: string; actual: number; limit: number } | undefined;

  zip.forEach((relativePath, entry) => {
    memberCount++;
    if (entry.dir) return;
    const originalPath = originalEntryPath(entry, relativePath);
    if (!isSafeArchivePath(originalPath)) {
      throw new ZipSafetyError(
        'unsafe-path',
        `ZIP import: archive contains an unsafe path: ${originalPath}.`,
        { path: originalPath },
      );
    }

    const metadata = compressedMetadata(entry, originalPath);
    if (
      metadata.uncompressedSize !== undefined &&
      metadata.uncompressedSize > resolved.maxEntryUncompressedBytes
    ) {
      oversizedEntry ??= {
        path: originalPath,
        actual: metadata.uncompressedSize,
        limit: resolved.maxEntryUncompressedBytes,
      };
    }

    const ratio =
      metadata.uncompressedSize === undefined || metadata.compressedSize === undefined
        ? undefined
        : compressionRatio(metadata.uncompressedSize, metadata.compressedSize);
    if (ratio !== undefined && ratio > resolved.maxCompressionRatio) {
      throw compressionRatioError(originalPath, ratio, resolved.maxCompressionRatio);
    }

    declaredTotal += metadata.uncompressedSize ?? 0;
    if (!Number.isSafeInteger(declaredTotal)) throw invalidMetadataError(originalPath);
    files.push({
      path: relativePath,
      entry,
      ...(metadata.uncompressedSize !== undefined
        ? { declaredSize: metadata.uncompressedSize }
        : {}),
      ...(metadata.compressedSize !== undefined ? { compressedSize: metadata.compressedSize } : {}),
      ...(metadata.crc32 !== undefined ? { crc32: metadata.crc32 } : {}),
    });
  });

  if (memberCount > resolved.maxEntries) {
    throw tooManyEntriesError(memberCount, resolved.maxEntries);
  }
  if (declaredTotal > resolved.maxUncompressedBytes) {
    throw archiveTooLargeError(declaredTotal, resolved.maxUncompressedBytes);
  }
  if (oversizedEntry) {
    throw entryTooLargeError(oversizedEntry.path, oversizedEntry.actual, oversizedEntry.limit);
  }
  return files;
}

/** Reject a path that could be interpreted outside an archive's logical root. */
export function assertSafeZipPath(path: string): void {
  if (!isSafeArchivePath(path)) {
    throw new ZipSafetyError('unsafe-path', `ZIP archive path is unsafe: ${path}.`, { path });
  }
}

export function resolveZipSafetyLimits(limits: ZipSafetyLimits): ResolvedZipSafetyLimits {
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ZIP_ENTRIES;
  const maxUncompressedBytes = limits.maxUncompressedBytes ?? DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES;
  const maxEntryUncompressedBytes = limits.maxEntryUncompressedBytes ?? maxUncompressedBytes;
  const maxCompressionRatio = limits.maxCompressionRatio ?? DEFAULT_MAX_ZIP_COMPRESSION_RATIO;

  assertNonNegativeInteger('maxEntries', maxEntries);
  assertNonNegativeFinite('maxUncompressedBytes', maxUncompressedBytes);
  assertNonNegativeFinite('maxEntryUncompressedBytes', maxEntryUncompressedBytes);
  if (!Number.isFinite(maxCompressionRatio) || maxCompressionRatio < 1) {
    throw invalidLimitError(
      'maxCompressionRatio must be a finite number greater than or equal to 1',
    );
  }
  return {
    maxEntries,
    maxEntryUncompressedBytes,
    maxUncompressedBytes,
    maxCompressionRatio,
  };
}

export function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw invalidLimitError(`${name} must be a non-negative finite number`);
  }
}

export function entryTooLargeError(path: string, actual: number, limit: number): ZipSafetyError {
  return new ZipSafetyError(
    'entry-too-large',
    `ZIP import: archive member ${path} exceeds ${limit} byte per-entry limit.`,
    { path, limit, actual },
  );
}

export function tooManyEntriesError(actual: number, limit: number): ZipSafetyError {
  return new ZipSafetyError(
    'too-many-entries',
    `ZIP import: archive has ${actual} files; limit is ${limit}.`,
    { limit, actual },
  );
}

export function archiveTooLargeError(actual: number, limit: number): ZipSafetyError {
  return new ZipSafetyError(
    'archive-too-large',
    `ZIP import: uncompressed content exceeds ${limit} byte limit.`,
    { limit, actual },
  );
}

export function compressionRatioError(path: string, actual: number, limit: number): ZipSafetyError {
  return new ZipSafetyError(
    'compression-ratio-exceeded',
    `ZIP import: archive member ${path} exceeds ${limit}:1 compression-ratio limit.`,
    { path, limit, actual },
  );
}

export function compressionRatio(uncompressedBytes: number, compressedBytes: number): number {
  if (uncompressedBytes === 0) return 0;
  if (compressedBytes === 0) return Number.POSITIVE_INFINITY;
  return uncompressedBytes / compressedBytes;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw invalidLimitError(`${name} must be a non-negative integer`);
  }
}

function invalidLimitError(detail: string): ZipSafetyError {
  return new ZipSafetyError('invalid-limit', `ZIP import: ${detail}.`);
}

function originalEntryPath(entry: JSZip.JSZipObject, relativePath: string): string {
  return (
    (
      entry as JSZip.JSZipObject & {
        unsafeOriginalName?: string;
      }
    ).unsafeOriginalName ?? relativePath
  );
}

function compressedMetadata(
  entry: JSZip.JSZipObject,
  path: string,
): { uncompressedSize?: number; compressedSize?: number; crc32?: number } {
  const data = (
    entry as unknown as {
      _data?: { uncompressedSize?: number; compressedSize?: number; crc32?: number };
    }
  )._data;
  const uncompressedSize = data?.uncompressedSize;
  const compressedSize = data?.compressedSize;
  const crc32 = data?.crc32;
  if (
    (uncompressedSize !== undefined && !isValidMetadataInteger(uncompressedSize)) ||
    (compressedSize !== undefined && !isValidMetadataInteger(compressedSize)) ||
    (crc32 !== undefined && !Number.isInteger(crc32))
  ) {
    throw invalidMetadataError(path);
  }
  return {
    ...(uncompressedSize !== undefined ? { uncompressedSize } : {}),
    ...(compressedSize !== undefined ? { compressedSize } : {}),
    ...(crc32 !== undefined ? { crc32 } : {}),
  };
}

function isValidMetadataInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalidMetadataError(path: string): ZipSafetyError {
  return new ZipSafetyError(
    'invalid-entry-metadata',
    `ZIP import: archive member has invalid size or checksum metadata: ${path}.`,
    { path },
  );
}

function isSafeArchivePath(path: string): boolean {
  const segments = path.split('/');
  return !(
    path.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.includes('\\') ||
    Array.from(path).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f;
    }) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}
