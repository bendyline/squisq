/**
 * When a document's cover is its first slide.
 *
 * The automatic cover takes its title from the document's first heading and
 * its subtitle from the paragraph beneath it. When that heading holds nothing
 * else and its author chose no template for it, a deck opened on the cover and
 * then showed the same words again, small, as slide one. Players and the video
 * exporter show the cover as that slide instead of before it.
 */

import type { Block, Doc } from '../schemas/Doc.js';
import { extractPlainText } from '../markdown/utils.js';

/**
 * Whether `doc`'s cover only repeats its leading block: the block's heading is
 * the cover's title, it has no authored template, and its only content is the
 * paragraph the cover shows as its subtitle (or nothing).
 */
export function coverRepeatsLeadingBlock(doc: Doc): boolean {
  const cover = doc.startBlock;
  const first: Block | undefined = doc.blocks[0];
  if (!cover || !first?.sourceHeading) return false;
  if (first.sourceHeading.templateAnnotation?.template || first.promotedBodyAnnotation) {
    return false;
  }
  if (first.title?.trim() !== cover.title.trim()) return false;
  if ((first.layers?.length ?? 0) > 0 || (first.media?.length ?? 0) > 0) return false;

  const contents = first.contents ?? [];
  if (contents.length === 0) return true;
  return (
    contents.length === 1 &&
    contents[0].type === 'paragraph' &&
    !!cover.subtitle &&
    extractPlainText(contents[0]).trim() === cover.subtitle.trim()
  );
}
