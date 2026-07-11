/**
 * Shared helpers for document exports from the site package.
 */

import { resolveMediaSchedule } from '@bendyline/squisq/schemas';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';

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

  const { collectImagePaths, extractFilename } = await import('@bendyline/squisq-formats/html');

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

  for (const docPath of collectImagePaths(doc)) {
    if (images.has(docPath)) continue;
    const data = byFilename.get(extractFilename(docPath));
    if (data) images.set(docPath, data);
  }

  return images;
}

/**
 * Collect the doc's audio (narration segments + scheduled audio clips,
 * including a document-anchored narration take and its timing sidecar)
 * from the workspace container for the HTML ZIP export's `audio` map.
 */
export async function collectAudioForHtmlExport(
  doc: Doc,
  container: ContentContainer | null | undefined,
): Promise<Map<string, ArrayBuffer> | undefined> {
  if (!container) return undefined;
  const srcs = new Set<string>();
  for (const segment of doc.audio?.segments ?? []) {
    if (segment.src) srcs.add(segment.src);
  }
  for (const clip of resolveMediaSchedule(doc)) {
    if (clip.kind === 'audio' && clip.src) srcs.add(clip.src);
  }
  const audio = new Map<string, ArrayBuffer>();
  for (const src of srcs) {
    const data = await container.readFile(src);
    if (!data) continue;
    audio.set(src, data);
    const sidecar = await container.readFile(`${src}.timing.json`);
    if (sidecar) audio.set(`${src}.timing.json`, sidecar);
  }
  return audio.size > 0 ? audio : undefined;
}
