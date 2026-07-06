/**
 * Shared tail for the container-producing importers.
 *
 * `docxToContainer`, `pptxToContainer`, and `pdfToContainer` all end the same
 * way: create a `MemoryContentContainer`, write the primary markdown document,
 * then write each extracted image under its path with its MIME type. This
 * factors that identical epilogue into one place.
 */

import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';

/**
 * Assemble a {@link ContentContainer} from a markdown document plus a set of
 * media files. `images` is any iterable of `[path, { data, mimeType }]` pairs
 * (a `Map` from the importers' extraction context satisfies this directly).
 */
export async function buildContainer(
  markdown: string,
  images: Iterable<readonly [string, { data: ArrayBuffer; mimeType: string }]>,
): Promise<ContentContainer> {
  const container = new MemoryContentContainer();
  await container.writeDocument(markdown);
  for (const [path, { data, mimeType }] of images) {
    await container.writeFile(path, new Uint8Array(data), mimeType);
  }
  return container;
}
