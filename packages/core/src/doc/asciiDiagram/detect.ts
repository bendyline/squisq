/**
 * ASCII diagram detection: is this fence content a box-and-line diagram?
 *
 * False positives are the expensive failure (they hide real code behind a
 * canvas / template); false negatives just leave a code block alone. Every
 * rejection path records a machine-greppable reason so the corpus tests
 * act as the contract for any future threshold tuning.
 */

import type { MarkdownCodeBlock } from '../../markdown/types.js';
import { parseAsciiDiagramWithStats } from './parse.js';
import type { AsciiDiagramDetection } from './types.js';

/** Fence languages eligible for diagram detection (plus no language at all). */
export const ASCII_DIAGRAM_FENCE_LANGS: ReadonlySet<string> = new Set([
  'text',
  'txt',
  'plaintext',
  'plain',
  'ascii',
  'diagram',
]);

const MAX_LINES = 400;
const MAX_COLS = 400;
const MIN_LINES = 3;
const MAX_LOOSE_RATIO = 0.25;

/**
 * Box-drawing corners, junctions, and (Unicode) verticals — characters that
 * signal a box border leaked into a node's label, i.e. a mis-aligned parse.
 * ASCII `|`/`+`/`-` and the horizontal `─` are excluded: they occur in real
 * label text (`stdin | stdout`, `read-only`, `A + B`).
 */
const STRUCTURAL_IN_LABEL = /[│┃║┌┐└┘├┤┬┴┼╭╮╰╯┏┓┗┛╔╗╚╝┣┫┳┻╋╠╣╦╩╬╞╡╥╨╫╪]/;

export function isEligibleAsciiFenceLang(lang: string | null | undefined): boolean {
  if (lang === null || lang === undefined) return true;
  const normalized = lang.trim().toLowerCase();
  return normalized === '' || ASCII_DIAGRAM_FENCE_LANGS.has(normalized);
}

/**
 * True when the fence LANGUAGE is the explicit `diagram` tag — an author-set
 * "this is a diagram" marker that survives round-trips (the language class
 * round-trips; fence meta does not). Detection of a tagged fence is lenient
 * (≥1 box, no lattice rejector) so a degenerate diagram stays a diagram.
 */
export function isExplicitDiagramLang(lang: string | null | undefined): boolean {
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'diagram';
}

export interface DetectDiagramOptions {
  /** The fence is explicitly `diagram`-tagged: accept ≥1 box, skip rejectors. */
  explicit?: boolean;
}

export function detectAsciiDiagram(
  text: string,
  opts: DetectDiagramOptions = {},
): AsciiDiagramDetection {
  const explicit = opts.explicit === true;
  const reasons: string[] = [];

  // ---- Cheap prefilter (no parse) ----------------------------------------
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length < MIN_LINES) {
    return { isDiagram: false, reasons: [`too-few-lines(${lines.length})`] };
  }
  if (lines.length > MAX_LINES) {
    return { isDiagram: false, reasons: [`too-many-lines(${lines.length})`] };
  }
  let maxCols = 0;
  for (const line of lines) maxCols = Math.max(maxCols, line.length);
  if (maxCols > MAX_COLS) {
    return { isDiagram: false, reasons: [`too-wide(${maxCols})`] };
  }

  if (!explicit) {
    let tlCandidates = 0;
    for (const line of lines) {
      // Unicode TL corners, junction-started shared borders (`├──`), and
      // ASCII `+-` starts. Junctions over-count (file trees use `├──`), but
      // the prefilter only gates the full parse — box tracing decides.
      const unicodeMatches = line.match(/[┌╭┏╔]|[├┬┼┣┳╋╠╦╬][─━═]/gu);
      tlCandidates += unicodeMatches ? unicodeMatches.length : 0;
      const plusMatches = line.match(/\+[-+]/g);
      tlCandidates += plusMatches ? plusMatches.length : 0;
    }
    if (tlCandidates < 2) {
      return { isDiagram: false, reasons: [`too-few-corner-candidates(${tlCandidates})`] };
    }
  }

  // Markdown/GFM table shape: mostly `| … |` rows plus a separator row.
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  const pipeRows = nonBlank.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
  const hasGfmSeparator = nonBlank.some((l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-'));
  if (pipeRows > nonBlank.length / 2 && hasGfmSeparator) {
    return { isDiagram: false, reasons: ['markdown-table'] };
  }

  // ---- Full parse + acceptance -------------------------------------------
  const { diagram, stats } = parseAsciiDiagramWithStats(text);

  const minBoxes = explicit ? 1 : 2;
  if (diagram.nodes.length < minBoxes) {
    return { isDiagram: false, reasons: [`too-few-boxes(${diagram.nodes.length})`] };
  }

  // Garbled-label guard: a clean box label never contains box-drawing
  // corners/junctions/verticals — those only leak in when the label columns
  // are desynced from the box borders (hand-drawn art whose labels overflow
  // their boxes and shove every following column out of alignment row-to-row,
  // so no parser can map the text back to the boxes). When a meaningful share
  // of labels are corrupt this way, the "diagram" would render as garbage, so
  // decline detection and let the fence fall back to a faithful code block.
  const garbled = diagram.nodes.filter((n) => STRUCTURAL_IN_LABEL.test(n.label)).length;
  if (garbled > 0 && garbled >= diagram.nodes.length * 0.25) {
    return { isDiagram: false, reasons: [`garbled-labels(${garbled}/${diagram.nodes.length})`] };
  }

  if (!explicit) {
    // Table-lattice rejector: an edge-less shared-border grid of ≥2×2 boxes
    // is a psql/MySQL-style result table, not a diagram. Single-column
    // stacks still pass (a legitimate "layer stack" diagram).
    if (diagram.edges.length === 0 && diagram.nodes.length >= 4 && isLattice(diagram)) {
      return { isDiagram: false, reasons: ['table-lattice'] };
    }
    if (stats.totalNonSpaceCells > 0) {
      const looseRatio = stats.looseNonSpaceCells / stats.totalNonSpaceCells;
      if (looseRatio > MAX_LOOSE_RATIO) {
        return { isDiagram: false, reasons: [`loose-ratio(${looseRatio.toFixed(2)})`] };
      }
    }
  }

  reasons.push(`boxes(${diagram.nodes.length})`, `edges(${diagram.edges.length})`);
  if (explicit) reasons.push('explicit');
  return { isDiagram: true, diagram, reasons };
}

/** Convenience gate for pipeline callers: lang allowlist + content detection. */
export function isAsciiDiagramFence(node: MarkdownCodeBlock): boolean {
  if (node.type !== 'code') return false;
  if (!isEligibleAsciiFenceLang(node.lang)) return false;
  return detectAsciiDiagram(node.value, { explicit: isExplicitDiagramLang(node.lang) }).isDiagram;
}

function isLattice(diagram: {
  nodes: ReadonlyArray<{
    col: number;
    row: number;
    wCols: number;
    hRows: number;
    containerId?: string;
  }>;
}): boolean {
  const leaves = diagram.nodes.filter((n) => !n.containerId);
  if (leaves.length < 4) return false;
  const rowBands = new Set(leaves.map((n) => n.row));
  const colBands = new Set(leaves.map((n) => n.col));
  if (rowBands.size < 2 || colBands.size < 2) return false;
  // Every box shares a border line with some other box.
  return leaves.every((a) =>
    leaves.some((b) => {
      if (a === b) return false;
      const aR1 = a.row + a.hRows - 1;
      const aC1 = a.col + a.wCols - 1;
      const bR1 = b.row + b.hRows - 1;
      const bC1 = b.col + b.wCols - 1;
      return a.row === bR1 || aR1 === b.row || a.col === bC1 || aC1 === b.col;
    }),
  );
}
