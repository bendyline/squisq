/**
 * Shared helpers for document exports from the site package.
 */

import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';
import { collectImagePaths, extractFilename } from '@bendyline/squisq-formats/html';

/**
 * Collect images from a MediaProvider keyed by both the storage name and
 * any doc-referenced paths that resolve to the same filename. This handles
 * path mismatches where the Doc references `images/hero.jpg` but the
 * provider stores it as `hero.jpg` (or vice versa).
 */
export async function collectImagesForHtmlExport(
  doc: Doc,
  mediaProvider: MediaProvider | null,
): Promise<Map<string, ArrayBuffer>> {
  const images = new Map<string, ArrayBuffer>();
  if (!mediaProvider) return images;

  // Fetch all provider media in parallel
  const entries = await mediaProvider.listMedia();
  const fetched = await Promise.all(
    entries.map(async (entry) => {
      const url = await mediaProvider.resolveUrl(entry.name);
      const res = await fetch(url);
      if (!res.ok) return null;
      return { name: entry.name, data: await res.arrayBuffer() };
    }),
  );

  const byFilename = new Map<string, ArrayBuffer>();
  for (const f of fetched) {
    if (!f) continue;
    images.set(f.name, f.data);
    byFilename.set(extractFilename(f.name), f.data);
  }

  // Add entries keyed by doc-referenced paths when the filename matches
  for (const docPath of collectImagePaths(doc)) {
    if (images.has(docPath)) continue;
    const data = byFilename.get(extractFilename(docPath));
    if (data) images.set(docPath, data);
  }

  return images;
}
