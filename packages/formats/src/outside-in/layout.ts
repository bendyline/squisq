/**
 * Outside-in path layout — the pure, synchronous half of the outside-in
 * contract.
 *
 * Maps a user-facing rendered file to its hidden companion directory and
 * slugged Markdown source:
 *
 *   Tucson.pptx
 *   Tucson_files/
 *     tucson.md
 *     .original/original.pptx
 *
 * Published on its own as `@bendyline/squisq-formats/outside-in-layout` so
 * hosts that only need the path rules (file explorers, workspace walkers, a
 * CJS editor-extension host) can bundle them without the format registry or
 * any format runtime. Keep this module free of imports: `/outside-in`
 * re-exports everything here, and the published suite asserts the built
 * entry reaches no other module.
 */

export const OUTSIDE_IN_FORMAT_IDS = ['html', 'docx', 'pdf', 'pptx', 'xlsx', 'csv'] as const;

export type OutsideInFormatId = (typeof OUTSIDE_IN_FORMAT_IDS)[number];

const OUTSIDE_IN_FORMAT_SET = new Set<string>(OUTSIDE_IN_FORMAT_IDS);

export interface OutsideInLayout {
  /** User-facing rendered file, relative to the host's workspace root. */
  targetPath: string;
  /** Registry format used to import and regenerate the target. */
  format: OutsideInFormatId;
  /** Parent directory of the rendered file. Empty at workspace root. */
  parentDirectory: string;
  /** Case-preserving rendered filename without its final extension. */
  stem: string;
  /** Case-preserving `<stem>_files` folder name. */
  companionName: string;
  /** Full workspace-relative companion directory. */
  companionDirectory: string;
  /** Slugged Markdown filename inside the companion directory. */
  markdownFilename: string;
  /** Full workspace-relative Markdown source path. */
  markdownPath: string;
  /** Rendered target path as stored relative to the Markdown source. */
  relativeTargetPath: string;
  /** Hidden directory containing the immutable pre-edit rendered file. */
  backupDirectory: string;
  /** Stable filename for the pre-edit rendered file. */
  backupFilename: string;
  /** Full workspace-relative path to the pre-edit rendered file. */
  backupPath: string;
}

function normalizePath(path: string): string {
  const slash = path.replace(/\\/g, '/');
  const leading = slash.startsWith('/') ? '/' : '';
  const parts = slash.split('/').filter((part) => part !== '');
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Outside-in paths must be canonical workspace paths: ${path}`);
  }
  return leading + parts.join('/');
}

function joinPath(parent: string, child: string): string {
  if (!parent || parent === '/') return parent === '/' ? `/${child}` : child;
  return `${parent}/${child}`;
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return '';
  if (slash === 0) return '/';
  return path.slice(0, slash);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function slugStem(stem: string): string {
  const slug = stem
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'document';
}

function formatFromExtension(extension: string): OutsideInFormatId | null {
  const normalized = extension.toLowerCase();
  if (normalized === 'htm') return 'html';
  return OUTSIDE_IN_FORMAT_SET.has(normalized) ? (normalized as OutsideInFormatId) : null;
}

/** Resolve the canonical companion/source layout for a supported rendered file. */
export function resolveOutsideInLayout(targetPath: string): OutsideInLayout | null {
  const normalized = normalizePath(targetPath);
  const filename = basename(normalized);
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return null;
  const format = formatFromExtension(filename.slice(dot + 1));
  if (!format) return null;

  const stem = filename.slice(0, dot);
  const parentDirectory = dirname(normalized);
  const companionName = `${stem}_files`;
  const companionDirectory = joinPath(parentDirectory, companionName);
  const markdownFilename = `${slugStem(stem)}.md`;
  const backupDirectory = joinPath(companionDirectory, '.original');
  const backupFilename = `original.${format}`;
  return {
    targetPath: normalized,
    format,
    parentDirectory,
    stem,
    companionName,
    companionDirectory,
    markdownFilename,
    markdownPath: joinPath(companionDirectory, markdownFilename),
    relativeTargetPath: `../${filename}`,
    backupDirectory,
    backupFilename,
    backupPath: joinPath(backupDirectory, backupFilename),
  };
}

/** True when `path` names a rendered file outside-in editing supports. */
export function isOutsideInTargetPath(path: string): boolean {
  return resolveOutsideInLayout(path) !== null;
}

/**
 * Pick an existing source inside the companion directory. Canonical slug wins;
 * a sole root-level Markdown file is accepted for older/manual layouts.
 */
export function chooseOutsideInMarkdownPath(
  layout: OutsideInLayout,
  paths: readonly string[],
): string | null {
  const canonical = normalizePath(layout.markdownPath);
  const normalized = paths.map(normalizePath);
  const exact = normalized.find((path) => path === canonical);
  if (exact) return exact;

  const canonicalFolded = canonical.toLocaleLowerCase('en-US');
  const folded = normalized.find((path) => path.toLocaleLowerCase('en-US') === canonicalFolded);
  if (folded) return folded;

  const prefix = `${normalizePath(layout.companionDirectory).replace(/\/$/, '')}/`;
  const markdown = normalized.filter((path) => {
    if (!path.toLocaleLowerCase('en-US').endsWith('.md')) return false;
    if (!path.startsWith(prefix)) return false;
    return !path.slice(prefix.length).includes('/');
  });
  return markdown.length === 1 ? markdown[0]! : null;
}
