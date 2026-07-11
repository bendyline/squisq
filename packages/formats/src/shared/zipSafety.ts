/** Central ZIP metadata and path validation for every archive import path. */

import type JSZip from 'jszip';

export interface ZipSafetyLimits {
  /** Maximum number of non-directory archive members. Default: 10,000. */
  maxEntries?: number;
  /** Maximum declared total uncompressed bytes. Default: 512 MiB. */
  maxUncompressedBytes?: number;
}

export interface ValidatedZipEntry {
  path: string;
  entry: JSZip.JSZipObject;
  declaredSize?: number;
}

export const DEFAULT_MAX_ZIP_ENTRIES = 10_000;
export const DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/**
 * Validate central-directory metadata before any member is decompressed.
 * JSZip already normalizes traversal names, so inspect `unsafeOriginalName`
 * as well as the key it exposes to consumers.
 */
export function validateZipArchive(zip: JSZip, limits: ZipSafetyLimits = {}): ValidatedZipEntry[] {
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ZIP_ENTRIES;
  const maxUncompressedBytes = limits.maxUncompressedBytes ?? DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES;
  if (!Number.isInteger(maxEntries) || maxEntries < 0) {
    throw new Error('ZIP import: maxEntries must be a non-negative integer.');
  }
  if (!Number.isFinite(maxUncompressedBytes) || maxUncompressedBytes < 0) {
    throw new Error('ZIP import: maxUncompressedBytes must be a non-negative finite number.');
  }

  const files: ValidatedZipEntry[] = [];
  let declaredTotal = 0;
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const originalPath =
      (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ??
      relativePath;
    if (!isSafeArchivePath(originalPath)) {
      throw new Error(`ZIP import: archive contains an unsafe path: ${originalPath}.`);
    }

    const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize;
    if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 0)) {
      throw new Error(`ZIP import: archive member has an invalid size: ${originalPath}.`);
    }
    if (declaredSize !== undefined) declaredTotal += declaredSize;
    files.push({
      path: relativePath,
      entry,
      ...(declaredSize !== undefined ? { declaredSize } : {}),
    });
  });

  if (files.length > maxEntries) {
    throw new Error(`ZIP import: archive has ${files.length} files; limit is ${maxEntries}.`);
  }
  if (declaredTotal > maxUncompressedBytes) {
    throw new Error(`ZIP import: uncompressed content exceeds ${maxUncompressedBytes} byte limit.`);
  }
  return files;
}

/** Reject a path that could be interpreted outside an archive's logical root. */
export function assertSafeZipPath(path: string): void {
  if (!isSafeArchivePath(path)) {
    throw new Error(`ZIP archive path is unsafe: ${path}.`);
  }
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
