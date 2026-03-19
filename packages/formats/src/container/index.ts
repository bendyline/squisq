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
): Promise<MemoryContentContainer> {
  const zip = await JSZip.loadAsync(zipData);
  const container = new MemoryContentContainer();

  const filePromises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    // Skip directories
    if (zipEntry.dir) return;

    // Strip leading slash if present
    const path = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    if (!path) return;

    filePromises.push(
      zipEntry.async('arraybuffer').then((data) => {
        return container.writeFile(path, data);
      }),
    );
  });

  await Promise.all(filePromises);
  return container;
}
