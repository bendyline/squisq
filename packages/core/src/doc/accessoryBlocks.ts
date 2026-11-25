/**
 * Accessory blocks: side information about another block.
 *
 * An accessory block is a heading whose `{[…]}` tag names a registered
 * accessory type (`accessoryBlockTypes.ts`), together with everything under
 * that heading:
 *
 * ```markdown
 * ## Write the way you already do
 *
 * Type to add text, and use the toolbar…
 *
 * ### Write the way you already do {[summary]}
 *
 * - Type anywhere to add text
 * ```
 *
 * - **Owner.** It is about the section it sits under. At the top level it is
 *   about the text before the first heading. An `of=<blockId>` tag parameter
 *   names a different owner where nesting is impossible.
 * - **Extent.** Markdown has no "end of section", so it runs to the next
 *   heading at its level or shallower; deeper headings are part of it. It
 *   therefore belongs after its owner's own text and before the owner's
 *   first sub-section.
 * - **Ids.** It takes an id from its own namespace (`<owner>~summary`,
 *   `<owner>~summary-2`), so adding one never renumbers a real block.
 *
 * `markdownToDoc` keeps accessory blocks in the block tree, so the markdown
 * round-trips and editors can pair the Nth heading with the Nth block
 * (`flattenBlocks`). Every output — slides, video, narration, captions,
 * chapters, page views, exports — works from the tree without them:
 * `flattenRenderableBlocks` skips them, and anything that walks
 * `children` itself starts from {@link pruneAccessoryBlocks}. Pruning, not
 * skipping, matters there: a section whose only child is a summary must
 * still look like a section with no children.
 */

import type { Block } from '../schemas/Doc.js';

/** True for an accessory block, or a heading nested inside one. */
export function isAccessoryBlock(block: Pick<Block, 'accessoryBlock'>): boolean {
  return block.accessoryBlock !== undefined;
}

/** A block's children that are not accessory blocks. */
export function realChildren(block: Pick<Block, 'children'>): Block[] {
  const children = block.children;
  if (!children || children.length === 0) return [];
  return children.some(isAccessoryBlock) ? children.filter((c) => !isAccessoryBlock(c)) : children;
}

/**
 * The block tree without accessory blocks (and what is nested in them).
 * Returns the same array when there are none, so memoized consumers see no
 * change; otherwise copies only the blocks whose children changed. A block
 * left with no children loses the `children` key, exactly as it would parse
 * had the accessory blocks never been written.
 */
export function pruneAccessoryBlocks(blocks: Block[]): Block[] {
  let changed = false;
  const out: Block[] = [];
  for (const block of blocks) {
    if (isAccessoryBlock(block)) {
      changed = true;
      continue;
    }
    if (block.children) {
      const children = pruneAccessoryBlocks(block.children);
      if (children !== block.children) {
        changed = true;
        if (children.length > 0) {
          out.push({ ...block, children });
        } else {
          const { children: _dropped, ...rest } = block;
          void _dropped;
          out.push(rest);
        }
        continue;
      }
    }
    out.push(block);
  }
  return changed ? out : blocks;
}

/** A doc (or anything holding a block tree) without its accessory blocks. */
export function withoutAccessoryBlocks<T extends { blocks: Block[] }>(doc: T): T {
  const blocks = pruneAccessoryBlocks(doc.blocks);
  return blocks === doc.blocks ? doc : { ...doc, blocks };
}

/**
 * Every block that is not an accessory block, depth first — like
 * `flattenBlocks`, minus accessory blocks and what is nested in them. The
 * parse passes that read a block's content (media, structured data,
 * diagrams, timing) walk this list.
 */
export function flattenContentBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    if (isAccessoryBlock(block)) continue;
    result.push(block);
    if (block.children) result.push(...flattenContentBlocks(block.children));
  }
  return result;
}

/**
 * Accessory blocks themselves (not the headings nested in them), depth
 * first, in document order.
 */
export function collectAccessoryBlocks(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    if (block.accessoryBlock) {
      if (block.accessoryBlock.within === undefined) result.push(block);
      continue;
    }
    if (block.children) result.push(...collectAccessoryBlocks(block.children));
  }
  return result;
}
