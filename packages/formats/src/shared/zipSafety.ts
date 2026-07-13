/** Stable facade for ZIP validation and bounded JSZip member reads. */

export {
  ZipSafetyError,
  DEFAULT_MAX_ZIP_ENTRIES,
  DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES,
  DEFAULT_MAX_ZIP_COMPRESSION_RATIO,
  assertSafeZipPath,
  validateZipArchive,
} from './zipLimits.js';
export type {
  ZipSafetyLimits,
  ZipSafetyErrorCode,
  ZipSafetyErrorOptions,
  ValidatedZipEntry,
} from './zipLimits.js';

export { createBoundedZipArchive, openBoundedZipArchive } from './boundedZipArchive.js';
export type { BoundedZipArchive } from './boundedZipArchive.js';
