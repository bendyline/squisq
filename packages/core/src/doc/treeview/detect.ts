/**
 * ASCII tree detection: is this fence content a file-tree / outline?
 *
 * The mirror image of the diagram detector. A diagram has ≥2 closed boxes;
 * a tree has ZERO closed boxes plus connector-branch structure. The two
 * partition the `├──` glyph space cleanly, so a fence is at most one of
 * them. Auto-detection is deliberately conservative (requires connector
 * branches — the unambiguous AI file-tree signal); the parser still handles
 * pure-indentation renditions for explicitly `{[tree]}`-annotated fences.
 */

import type { MarkdownCodeBlock } from '../../markdown/types.js';
import { parseAsciiDiagramWithStats } from '../asciiDiagram/parse.js';
import { parseTreeWithStats } from './parse.js';
import type { TreeDetection } from './types.js';

/** Fence languages eligible for tree detection (plus no language at all). */
export const TREE_FENCE_LANGS: ReadonlySet<string> = new Set([
  'text',
  'txt',
  'plaintext',
  'plain',
  'ascii',
  'tree',
]);

const MAX_LINES = 400;
const MIN_LINES = 2;
const MIN_CONNECTOR_LINES = 2;
const MIN_NODES = 2;

/**
 * Box-drawing corners a file tree NEVER contains: top-left/right and
 * bottom-right in light, heavy, double, and rounded weights. Bottom-LEFT
 * corners (└ ┗ ╰ ╚ ╘) are excluded — the tree codec uses them as elbows.
 */
const BOX_CORNER_RE = /[┌┐┘┏┓┛╔╗╝╭╮╯]/u;

export function isEligibleTreeFenceLang(lang: string | null | undefined): boolean {
  if (lang === null || lang === undefined) return true;
  const normalized = lang.trim().toLowerCase();
  return normalized === '' || TREE_FENCE_LANGS.has(normalized);
}

/**
 * True when the fence LANGUAGE is the explicit `tree` tag — an author-set
 * "this is a tree" marker that survives markdown ↔ Tiptap round-trips (the
 * language class round-trips; fence meta does not). Detection of a tagged
 * fence is lenient (no connector requirement) so a flattened/degenerate
 * tree stays a tree.
 */
export function isExplicitTreeLang(lang: string | null | undefined): boolean {
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'tree';
}

export interface DetectTreeOptions {
  /** The fence is explicitly `tree`-tagged: skip the connector requirement. */
  explicit?: boolean;
}

export function detectTree(text: string, opts: DetectTreeOptions = {}): TreeDetection {
  const explicit = opts.explicit === true;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  // A `tree`-tagged fence can be a single-node tree (e.g. the outline edited
  // down to one item); an untagged fence needs ≥2 lines to auto-detect.
  const minLines = explicit ? 1 : MIN_LINES;
  if (nonBlank.length < minLines) {
    return { isTree: false, reasons: [`too-few-lines(${nonBlank.length})`] };
  }
  if (lines.length > MAX_LINES) {
    return { isTree: false, reasons: [`too-many-lines(${lines.length})`] };
  }

  // Markdown/GFM table shape → not a tree (even when explicitly tagged; it
  // wouldn't parse into a sensible hierarchy anyway).
  const pipeRows = nonBlank.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
  const hasGfmSeparator = nonBlank.some((l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-'));
  if (pipeRows > nonBlank.length / 2 && hasGfmSeparator) {
    return { isTree: false, reasons: ['markdown-table'] };
  }

  // Box-drawing CORNERS are an unambiguous box-diagram signal. A file tree /
  // outline is built only from tees (├), elbows (└ ┗ ╰), rails (│), and dashes
  // (─) — it never contains a TOP corner (┌ ┐) or a BOTTOM-RIGHT corner (┘).
  // A fence with those is a diagram, even a MALFORMED one whose borders are
  // misaligned so the tracer finds <2 closed boxes (e.g. hand-drawn art
  // knocked out of alignment by a later rename that widened the labels).
  // Without this, such art falls through to a mangled treeview. (Bottom-LEFT
  // corners └ ┗ ╰ ╚ ╘ are deliberately excluded — they double as tree elbows.)
  if (BOX_CORNER_RE.test(text)) {
    return { isTree: false, reasons: ['has-box-corners'] };
  }

  // Mutual exclusion with the diagram codec: a fence with ≥2 closed boxes is
  // a diagram, not a tree.
  const boxes = parseAsciiDiagramWithStats(text).diagram.nodes.length;
  if (boxes >= 2) {
    return { isTree: false, reasons: [`has-boxes(${boxes})`] };
  }

  const { tree, stats } = parseTreeWithStats(text);
  const nodeCount = countNodes(tree.roots);
  const minNodes = explicit ? 1 : MIN_NODES;
  if (nodeCount < minNodes) {
    return { isTree: false, reasons: [`too-few-nodes(${nodeCount})`] };
  }
  if (!explicit) {
    // Auto-detection of an UNTAGGED fence requires the connector signal
    // (pure-indentation art could be prose or a list). A `tree`-tagged fence
    // trusts the author and skips this.
    if (stats.connectorLines < MIN_CONNECTOR_LINES) {
      return { isTree: false, reasons: [`too-few-connectors(${stats.connectorLines})`] };
    }
    if (stats.looseLines > stats.contentLines * 0.25) {
      return { isTree: false, reasons: [`loose-ratio(${stats.looseLines}/${stats.contentLines})`] };
    }
  }

  return {
    isTree: true,
    tree,
    reasons: [`nodes(${nodeCount})`, explicit ? 'explicit' : `connectors(${stats.connectorLines})`],
  };
}

/** Convenience gate for pipeline callers: lang allowlist + content detection. */
export function isTreeFence(node: MarkdownCodeBlock): boolean {
  if (node.type !== 'code') return false;
  if (!isEligibleTreeFenceLang(node.lang)) return false;
  return detectTree(node.value, { explicit: isExplicitTreeLang(node.lang) }).isTree;
}

function countNodes(nodes: readonly import('./types.js').TreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}
