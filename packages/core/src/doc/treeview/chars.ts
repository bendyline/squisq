/**
 * Character classification + render vocabularies for ASCII tree art.
 *
 * The parser accepts a superset (Unicode light/heavy/rounded branches plus
 * ASCII `|-- ` / `` `-- `` / `+-- `); the renderer emits one `TreeVocab`.
 * Internal to the treeview module.
 */

/** Vertical rail glyphs (an ancestor line continuing downward). */
const RAIL_CHARS = new Set(['│', '┃', '╎', '╏', '║', '|']);
/** Branch-tee glyphs (a node that has a following sibling). */
const BRANCH_TEE = new Set(['├', '┣', '┠', '┝', '╠', '╞']);
/** Branch-elbow glyphs (the last child). */
const BRANCH_ELBOW = new Set(['└', '┗', '╰', '╚', '╘']);
/** Horizontal dash glyphs used in a branch arm. */
const DASH_CHARS = new Set(['─', '━', '═', '-']);

export function isRailChar(ch: string): boolean {
  return RAIL_CHARS.has(ch);
}
export function isBranchTee(ch: string): boolean {
  return BRANCH_TEE.has(ch);
}
export function isBranchElbow(ch: string): boolean {
  return BRANCH_ELBOW.has(ch);
}
export function isUnicodeBranch(ch: string): boolean {
  return BRANCH_TEE.has(ch) || BRANCH_ELBOW.has(ch);
}
export function isDashChar(ch: string): boolean {
  return DASH_CHARS.has(ch);
}

/** Structural glyphs used for the style vote. */
export function isUnicodeTreeChar(ch: string): boolean {
  return (
    BRANCH_TEE.has(ch) ||
    BRANCH_ELBOW.has(ch) ||
    ch === '│' ||
    ch === '┃' ||
    ch === '─' ||
    ch === '━'
  );
}
export function isAsciiTreeChar(ch: string): boolean {
  return ch === '|' || ch === '`' || ch === '+' || ch === '-';
}

export interface TreeVocab {
  /** Branch to a node that has a later sibling (`├── `). */
  tee: string;
  /** Branch to the last child (`└── `). */
  elbow: string;
  /** Ancestor rail column (`│   `). */
  rail: string;
  /** Ended-ancestor gap column (`    `). */
  gap: string;
}

export const UNICODE_TREE_VOCAB: TreeVocab = {
  tee: '├── ',
  elbow: '└── ',
  rail: '│   ',
  gap: '    ',
};

export const ASCII_TREE_VOCAB: TreeVocab = {
  tee: '|-- ',
  elbow: '`-- ',
  rail: '|   ',
  gap: '    ',
};
