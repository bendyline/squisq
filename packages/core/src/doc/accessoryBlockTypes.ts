/**
 * Accessory block types.
 *
 * An accessory block is a heading whose `{[…]}` tag names one of these types,
 * together with everything under that heading. It holds side information
 * about another block (its owner) — a slide summary, a study card, other
 * notes later — and is never a slide, a video scene, narration, a
 * caption, a chapter, or exported content. See `accessoryBlocks.ts`.
 *
 * Kept dependency-free: the markdown parser and exporters import it.
 */

export interface AccessoryBlockTypeInfo {
  /** Name of one block of this type, e.g. "Slide summary". */
  readonly label: string;
  /** Name of several, e.g. "Slide summaries". */
  readonly pluralLabel: string;
  /** What a block of this type holds, as one plain sentence. */
  readonly description: string;
  /**
   * Where a tool writes a new block of this type among a section's accessory
   * blocks: lower first, equal together. Blocks already in a document are
   * never moved.
   */
  readonly order: number;
}

/** Every registered accessory block type, by the tag name that marks it. */
export const ACCESSORY_BLOCK_TYPES = Object.freeze({
  summary: Object.freeze({
    label: 'Slide summary',
    pluralLabel: 'Slide summaries',
    description: 'How one of this section’s summary slides is worded.',
    order: 0,
  }),
  flashcard: Object.freeze({
    label: 'Flashcard',
    pluralLabel: 'Flashcards',
    description: 'A question about this section, with its answer.',
    order: 1,
  }),
  quiz: Object.freeze({
    label: 'Quiz question',
    pluralLabel: 'Quiz questions',
    description: 'A multiple-choice question about this section, with the right answer ticked.',
    order: 1,
  }),
} satisfies Record<string, AccessoryBlockTypeInfo>);

export type AccessoryBlockType = keyof typeof ACCESSORY_BLOCK_TYPES;

/** True when a `{[name]}` tag marks an accessory block. */
export function isAccessoryBlockType(name: string | undefined | null): name is AccessoryBlockType {
  return !!name && Object.prototype.hasOwnProperty.call(ACCESSORY_BLOCK_TYPES, name);
}

/** The registry entry for an accessory block type. */
export function accessoryBlockTypeInfo(type: AccessoryBlockType): AccessoryBlockTypeInfo {
  return ACCESSORY_BLOCK_TYPES[type];
}

/**
 * The tag parameter naming an accessory block's owner when it is not the
 * section the block sits under — a level-6 heading has no deeper level to
 * nest one in, and a section made by a standalone tag has no heading.
 */
export const ACCESSORY_BLOCK_OWNER_PARAM = 'of';
