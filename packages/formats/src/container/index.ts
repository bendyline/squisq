/**
 * Container ZIP serialization — convert between ContentContainer and ZIP archives.
 *
 * Uses JSZip (already a formats dependency) to serialize a ContentContainer to
 * a ZIP blob and to deserialize a ZIP blob into a MemoryContentContainer.
 *
 * ZIP structure mirrors the container's flat path hierarchy directly:
 *   index.md
 *   images/hero.jpg
 *   audio/narration.mp3
 *   timing.json
 */

import JSZip from 'jszip';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  assertSafeZipPath,
  openBoundedZipArchive,
  ZipSafetyError,
  type ZipSafetyLimits,
  type ZipSafetyErrorCode,
  type ZipSafetyErrorOptions,
} from '../shared/zipSafety.js';

export type ZipToContainerOptions = ZipSafetyLimits;
export interface ContainerToZipOptions {
  /** STORE avoids producing archives that violate strict import compression-ratio policies. */
  compression?: 'STORE' | 'DEFLATE';
  /** JSZip DEFLATE level; ignored for STORE. */
  compressionLevel?: number;
}
export { ZipSafetyError };
export type { ZipSafetyLimits, ZipSafetyErrorCode, ZipSafetyErrorOptions };

/**
 * Serialize a ContentContainer to a ZIP blob.
 *
 * All files in the container are written to the ZIP archive preserving
 * their path structure. The resulting blob can be saved as a .zip file.
 *
 * @param container — The container to serialize
 * @returns A Blob containing the ZIP archive
 */
export async function containerToZip(
  container: ContentContainer,
  options: ContainerToZipOptions = {},
): Promise<Blob> {
  const zip = new JSZip();
  const entries = await container.listFiles();

  for (const entry of entries) {
    assertSafeZipPath(entry.path);
    const data = await container.readFile(entry.path);
    if (data) {
      zip.file(entry.path, new Uint8Array(data));
    }
  }

  const compression = options.compression ?? 'DEFLATE';
  const compressionLevel = options.compressionLevel ?? 6;
  if (!Number.isSafeInteger(compressionLevel) || compressionLevel < 1 || compressionLevel > 9) {
    throw new Error('ZIP compression level must be an integer between 1 and 9');
  }
  return zip.generateAsync({
    type: 'blob',
    compression,
    ...(compression === 'DEFLATE' ? { compressionOptions: { level: compressionLevel } } : {}),
  });
}

/**
 * Deserialize a ZIP archive into a MemoryContentContainer.
 *
 * Reads all files from the ZIP and writes them into a new MemoryContentContainer.
 * Directory entries are skipped. The resulting container can be used immediately
 * for rendering, editing, or saving to persistent storage.
 *
 * @param zipData — The ZIP archive as ArrayBuffer, Uint8Array, or Blob
 * @returns A MemoryContentContainer populated with the ZIP's contents
 */
export async function zipToContainer(
  zipData: ArrayBuffer | Uint8Array | Blob,
  options: ZipToContainerOptions = {},
): Promise<MemoryContentContainer> {
  const archive = await openBoundedZipArchive(zipData, options);
  const container = new MemoryContentContainer();
  for (const { path } of archive.entries) {
    const data = await archive.read(path);
    if (data) await container.writeFile(path, data);
    archive.release(path);
  }
  return container;
}
