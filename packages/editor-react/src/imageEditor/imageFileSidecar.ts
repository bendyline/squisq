/**
 * Sidecar check for `ImageFileEditor`: before an image file's layers load,
 * make sure they still belong to the picture on disk.
 */

import type { ContentContainer } from '@bendyline/squisq/storage';
import {
  IMAGE_EDIT_STATE_FILENAME,
  inspectAnimatedImage,
  readImageEditDoc,
} from '@bendyline/squisq/imageEdit';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import { IMAGE_EDIT_WRITE_BACK_FILENAME, digestBytes, readWriteBackState } from './writeBack';

/** Outcome of checking an image file's sidecar against its picture. */
export type ImageFileSidecarPreparation =
  | {
      kind: 'ready';
      /** Signature of the layers the picture shows, or null when unknown. */
      written: string | null;
      /** True when stale layers were dropped so the editor re-seeds. */
      reseeded: boolean;
    }
  /** Animated pictures are not edited: saving would flatten them to one frame. */
  | { kind: 'animated' }
  | { kind: 'cancelled' };

/**
 * Check an image file's sidecar against the picture's current bytes, and
 * drop layers that belong to an older picture so the editor re-seeds:
 *
 *  - A write-back recorded a digest: keep the layers while the picture
 *    still has it, drop them once it differs (replaced outside the editor).
 *  - No write-back recorded one: keep the layers while the picture is still
 *    the original they were seeded from, including edits a session never
 *    wrote back (the next save or leave writes them). Any other picture is
 *    not theirs, so they are dropped. Re-seeding never loses what the
 *    picture shows; flattening stale layers over it would.
 */
export async function prepareImageFileSidecar(
  container: ContentContainer,
  pictureBytes: Uint8Array | ArrayBuffer,
  isCancelled: () => boolean = () => false,
): Promise<ImageFileSidecarPreparation> {
  if (inspectAnimatedImage(pictureBytes)?.animated) return { kind: 'animated' };
  const doc = await readImageEditDoc(container);
  if (!doc) return { kind: 'ready', written: null, reseeded: false };
  const record = await readWriteBackState(container);
  const pictureDigest = digestBytes(pictureBytes);
  const current = record?.pictureDigest
    ? record.pictureDigest === pictureDigest
    : await seededFromPicture(container, doc, pictureDigest);
  if (current) return { kind: 'ready', written: record?.signature ?? null, reseeded: false };
  if (isCancelled()) return { kind: 'cancelled' };
  await container.removeFile(IMAGE_EDIT_STATE_FILENAME);
  await container.removeFile(IMAGE_EDIT_WRITE_BACK_FILENAME);
  return { kind: 'ready', written: null, reseeded: true };
}

async function seededFromPicture(
  container: ContentContainer,
  doc: ImageEditDoc,
  pictureDigest: string,
): Promise<boolean> {
  const base = doc.layers[0];
  const source = doc.meta?.sourcePath ?? (base?.type === 'image' ? base.content.src : undefined);
  if (!source) return false;
  const bytes = await container.readFile(source);
  return bytes !== null && digestBytes(bytes) === pictureDigest;
}
