/**
 * Section passages: the text a section says itself, and a short key for it.
 *
 * Side information written from a section's text (an AI slide summary, an AI
 * study card) records the key of the passage it was made from, so it can tell
 * later whether the section has changed since. A section's passage is its own
 * body text — not its heading, not its sub-sections, not its accessory blocks —
 * with whitespace collapsed, so renaming the heading, re-wrapping lines or
 * adding a sub-section changes nothing, and changing a word does.
 */

import { hashString } from '../random/SeededRandom.js';
import type { Block, Doc } from '../schemas/Doc.js';
import { getBlockBodyText } from './markdownToDoc.js';
import { flattenContentBlocks } from './accessoryBlocks.js';

const PASSAGE_KEY_RE = /^[0-9a-z]{1,7}-[0-9a-z]{1,4}$/u;

/** True for a well-formed `passageKey`. */
export function isPassageKey(value: unknown): value is string {
  return typeof value === 'string' && PASSAGE_KEY_RE.test(value);
}

/** A short, stable name for an exact passage, so the text itself need not be saved. */
export function passageKey(passage: string): string {
  return `${hashString(passage).toString(36)}-${passage.length.toString(36)}`;
}

/** One section's own text and its key. */
export interface SectionPassage {
  /** The block the text belongs to. */
  blockId: string;
  /** Its heading text, when it has a heading. */
  heading?: string;
  /** Its own body text, whitespace collapsed. */
  text: string;
  /** `passageKey(text)`. */
  key: string;
}

/** A block's own body text, as section passages key it. */
export function sectionPassageText(block: Block): string {
  return getBlockBodyText(block).replace(/\s+/gu, ' ').trim();
}

function passageOf(block: Block): SectionPassage {
  const text = sectionPassageText(block);
  return {
    blockId: block.id,
    ...(block.sourceHeading && block.title ? { heading: block.title } : {}),
    text,
    key: passageKey(text),
  };
}

/** Every section that says something itself, in document order. */
export function sectionPassages(doc: Doc): SectionPassage[] {
  return flattenContentBlocks(doc.blocks)
    .map(passageOf)
    .filter((passage) => passage.text.length > 0);
}

/** One block's passage (its text may be empty), or undefined when it is not in the document. */
export function sectionPassage(doc: Doc, blockId: string): SectionPassage | undefined {
  const block = flattenContentBlocks(doc.blocks).find((item) => item.id === blockId);
  return block ? passageOf(block) : undefined;
}
