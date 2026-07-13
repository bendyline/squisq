/**
 * ASCII tree parser: file-tree / outline art → nested nodes.
 *
 * Pure, deterministic, never throws. Handles the many renditions AI emits:
 * Unicode connectors (`├── `/`└── `/`│   `), ASCII (`|-- `/`` `-- ``/`+-- `),
 * bullet-indented (`- `/`* `), and pure indentation. Depth is recovered by
 * finding where each line's LABEL begins (after any connector/indent
 * prefix) and running the standard outline indent-stack — this unifies all
 * renditions and tolerates ragged dedents.
 */

import {
  isBranchElbow,
  isBranchTee,
  isDashChar,
  isRailChar,
  isAsciiTreeChar,
  isUnicodeTreeChar,
} from './chars.js';
import type { Tree, TreeNode } from './types.js';

/** Internal per-line analysis fed to the reconstruction stack. */
export interface TreeLineStats {
  /** Non-blank content lines. */
  contentLines: number;
  /** Lines carrying a connector branch (`├──`/`└──`/`|--`/`` `--``/`+--`). */
  connectorLines: number;
  /** Lines that could not be analyzed as a node (loose text). */
  looseLines: number;
  /** Distinct label-start columns observed (a hierarchy has ≥2). */
  indentLevels: number;
}

interface AnalyzedLine {
  indent: number; // column where the label begins
  label: string;
  comment?: string;
  hadConnector: boolean;
}

export function parseTree(text: string): Tree {
  return parseTreeWithStats(text).tree;
}

export function parseTreeWithStats(text: string): { tree: Tree; stats: TreeLineStats } {
  const warnings: string[] = [];
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');

  const style = detectStyle(rawLines);
  const stats: TreeLineStats = {
    contentLines: 0,
    connectorLines: 0,
    looseLines: 0,
    indentLevels: 0,
  };
  const indentSet = new Set<number>();

  const analyzed: AnalyzedLine[] = [];
  for (const raw of rawLines) {
    if (raw.trim().length === 0) continue;
    stats.contentLines++;
    const a = analyzeLine(raw);
    if (!a || a.label.length === 0) {
      stats.looseLines++;
      continue;
    }
    if (a.hadConnector) stats.connectorLines++;
    indentSet.add(a.indent);
    analyzed.push(a);
  }
  stats.indentLevels = indentSet.size;

  // ---- Reconstruct the hierarchy via an indent stack --------------------
  const roots: TreeNode[] = [];
  const stack: Array<{ indent: number; node: TreeNode }> = [];
  for (const a of analyzed) {
    const node: TreeNode = {
      id: '',
      label: a.label,
      children: [],
      ...(a.comment ? { comment: a.comment } : {}),
    };
    // Pop ancestors that are at the same or deeper indent.
    while (stack.length > 0 && stack[stack.length - 1].indent >= a.indent) stack.pop();
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ indent: a.indent, node });
  }

  // ---- Post-pass: isDir + stable ids ------------------------------------
  const usedIds = new Map<string, number>();
  const finalize = (node: TreeNode): void => {
    node.isDir = node.label.endsWith('/') || node.children.length > 0;
    const base = slugify(stripTrailingSlash(node.label));
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    node.id = count === 0 ? base : `${base}-${count + 1}`;
    for (const child of node.children) finalize(child);
  };
  for (const root of roots) finalize(root);

  if (analyzed.length > 0 && stats.looseLines > 0) {
    warnings.push(`loose-lines(${stats.looseLines})`);
  }

  return { tree: { roots, style, warnings }, stats };
}

// ---------------------------------------------------------------------------
// Line analysis
// ---------------------------------------------------------------------------

/**
 * Strip a line's connector / indent prefix and return the column where the
 * label begins plus the cleaned label + trailing comment. Returns null for
 * a rails-only spacer line.
 */
function analyzeLine(line: string): AnalyzedLine | null {
  const chars = Array.from(line);
  let i = 0;
  let hadConnector = false;

  // Consume leading whitespace + vertical rails. A rail is a rail glyph NOT
  // immediately followed by a dash (which would make it an ASCII branch).
  for (;;) {
    while (i < chars.length && (chars[i] === ' ' || chars[i] === '\t')) i++;
    const ch = chars[i];
    if (ch === undefined) return null; // blank / rails-only
    if (isRailChar(ch) && !isDashChar(chars[i + 1] ?? '')) {
      i++;
      continue;
    }
    break;
  }

  // Optional branch: a Unicode tee/elbow + dashes, or ASCII `|`/`` ` ``/`+`
  // + dashes. The label follows (after any trailing spaces).
  const ch = chars[i];
  if (ch !== undefined) {
    if (isBranchTee(ch) || isBranchElbow(ch)) {
      i++;
      while (i < chars.length && (isDashChar(chars[i]) || isRailChar(chars[i]))) i++;
      hadConnector = true;
    } else if ((ch === '|' || ch === '`' || ch === '+') && isDashChar(chars[i + 1] ?? '')) {
      i++;
      while (i < chars.length && isDashChar(chars[i])) i++;
      hadConnector = true;
    } else if ((ch === '-' || ch === '*' || ch === '+') && (chars[i + 1] ?? '') === ' ') {
      // Markdown-style bullet (indent-based rendition).
      i++;
      hadConnector = false;
    }
  }
  while (i < chars.length && (chars[i] === ' ' || chars[i] === '\t')) i++;

  const indent = i;
  let label = chars.slice(i).join('').replace(/\s+$/u, '');
  if (label.length === 0) return null;

  // Trailing comment: ` # …`, ` <-- …`, or ` // …` (needs a leading space).
  let comment: string | undefined;
  const commentMatch = /\s+(?:#|<--|\/\/)\s?(.*)$/.exec(label);
  if (commentMatch) {
    comment = commentMatch[1].trim() || undefined;
    label = label.slice(0, commentMatch.index).replace(/\s+$/u, '');
  }
  if (label.length === 0) return null;

  return { indent, label, hadConnector, ...(comment ? { comment } : {}) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectStyle(lines: string[]): 'unicode' | 'ascii' {
  let unicode = 0;
  let ascii = 0;
  for (const line of lines) {
    for (const ch of line) {
      if (isUnicodeTreeChar(ch)) unicode++;
      else if (isAsciiTreeChar(ch)) ascii++;
    }
  }
  return ascii > unicode ? 'ascii' : 'unicode';
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'node';
}
