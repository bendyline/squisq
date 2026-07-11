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
  validateZipArchive,
  type ZipSafetyLimits,
} from '../shared/zipSafety.js';

export type ZipToContainerOptions = ZipSafetyLimits;

/**
 * Serialize a ContentContainer to a ZIP blob.
 *
 * All files in the container are written to the ZIP archive preserving
 * their path structure. The resulting blob can be saved as a .zip file.
 *
 * @param container — The container to serialize
 * @returns A Blob containing the ZIP archive
 */
export async function containerToZip(container: ContentContainer): Promise<Blob> {
  const zip = new JSZip();
  const entries = await container.listFiles();

  for (const entry of entries) {
    assertSafeZipPath(entry.path);
    const data = await container.readFile(entry.path);
    if (data) {
      zip.file(entry.path, new Uint8Array(data));
    }
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
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
  const zip = await JSZip.loadAsync(zipData);
  const container = new MemoryContentContainer();
  const files = validateZipArchive(zip, options);
  const maxUncompressedBytes = options.maxUncompressedBytes ?? 512 * 1024 * 1024;

  let totalBytes = 0;
  for (const { path, entry } of files) {
    const data = await entry.async('arraybuffer');
    totalBytes += data.byteLength;
    if (totalBytes > maxUncompressedBytes) {
      throw new Error(
        `ZIP import: uncompressed content exceeds ${maxUncompressedBytes} byte limit.`,
      );
    }
    await container.writeFile(path, data);
  }
  return container;
}
