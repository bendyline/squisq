/**
 * Outside-in document editing.
 *
 * A rendered document remains the user-facing file while its editable
 * Markdown source and media live in a hidden sibling companion directory:
 *
 *   Tucson.pptx
 *   Tucson_files/
 *     tucson.md
 *     hero.png
 *     .versions/
 *
 * Hosts own filesystem authority and transaction ordering. This module owns
 * the portable path/frontmatter contract plus registry-backed import/export.
 */

import {
  parseFrontmatter,
  setFrontmatterValues,
  splitFrontmatterBlock,
  stringifyMarkdown,
  type MarkdownDocument,
} from '@bendyline/squisq/markdown';
import { MemoryContentContainer, type ContentContainer } from '@bendyline/squisq/storage';
import { ConversionError } from '../registry/errors.js';
import { convert } from '../registry/convert.js';
import { defaultRegistry } from '../registry/registry.js';
import type { ConversionResult, ConvertOptions, FormatRegistry } from '../registry/types.js';

export const OUTSIDE_IN_FORMAT_IDS = ['html', 'docx', 'pdf', 'pptx', 'xlsx'] as const;

export type OutsideInFormatId = (typeof OUTSIDE_IN_FORMAT_IDS)[number];

const OUTSIDE_IN_FORMAT_SET = new Set<string>(OUTSIDE_IN_FORMAT_IDS);
const OUTSIDE_IN_VERSION_KEY = 'squisq-outside-in';
const OUTSIDE_IN_OUTPUT_KEY = 'squisq-output';
const OUTSIDE_IN_FORMAT_KEY = 'squisq-output-format';

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
}

export interface OutsideInMetadata {
  version: 1;
  format: OutsideInFormatId;
  target: string;
}

export interface ImportedOutsideInDocument {
  layout: OutsideInLayout;
  markdown: string;
  /** Imported media container. Hosts copy its non-Markdown members into the companion folder. */
  container: ContentContainer;
}

export interface RenderOutsideInOptions extends ConvertOptions {
  /** Required for HTML targets, which intentionally reference a shared runtime. */
  html?: {
    /** URL from the rendered HTML file to `_squisq/squisq-player.js`. */
    playerScriptPath: string;
    /** URL from the rendered HTML file to its companion media folder. */
    basePath?: string;
  };
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
  };
}

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

function rawFrontmatter(source: string): string | null {
  const block = splitFrontmatterBlock(source).frontmatter;
  if (!block) return null;
  const firstBreak = block.indexOf('\n');
  if (firstBreak < 0) return null;
  const withoutOpening = block.slice(firstBreak + 1);
  return withoutOpening.replace(/\r?\n---(?:\r?\n)?$/, '');
}

/** Read outside-in metadata without interpreting the output path as authority. */
export function readOutsideInMetadata(source: string): OutsideInMetadata | null {
  const yaml = rawFrontmatter(source);
  const frontmatter = yaml === null ? null : parseFrontmatter(yaml);
  if (!frontmatter) return null;
  const version = frontmatter[OUTSIDE_IN_VERSION_KEY];
  const target = frontmatter[OUTSIDE_IN_OUTPUT_KEY];
  const format = frontmatter[OUTSIDE_IN_FORMAT_KEY];
  if (version !== 1 || typeof target !== 'string' || typeof format !== 'string') return null;
  if (!OUTSIDE_IN_FORMAT_SET.has(format)) return null;
  return { version: 1, target, format: format as OutsideInFormatId };
}

/** Add or refresh the portable relationship while preserving unrelated frontmatter. */
export function withOutsideInMetadata(source: string, layout: OutsideInLayout): string {
  return setFrontmatterValues(source, {
    [OUTSIDE_IN_VERSION_KEY]: 1,
    [OUTSIDE_IN_OUTPUT_KEY]: layout.relativeTargetPath,
    [OUTSIDE_IN_FORMAT_KEY]: layout.format,
  });
}

function requireLayout(targetPath: string): OutsideInLayout {
  const layout = resolveOutsideInLayout(targetPath);
  if (layout) return layout;
  throw new ConversionError(
    'unknown-format',
    `Outside-in editing does not support the target "${targetPath}".`,
  );
}

function arrayBufferOf(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function importMarkdownDocument(
  data: ArrayBuffer,
  layout: OutsideInLayout,
  registry: FormatRegistry,
  options: ConvertOptions,
): Promise<{ markdownDoc: MarkdownDocument; container: ContentContainer }> {
  const definition = registry.get(layout.format);
  if (!definition || (!definition.importContainer && !definition.importDoc)) {
    throw new ConversionError(
      'unsupported-input',
      `Format "${layout.format}" cannot be imported for outside-in editing.`,
      { format: layout.format },
    );
  }

  if (definition.importContainer) {
    const container = await definition.importContainer(data, options);
    const imported = await container.readDocument();
    if (imported !== null) {
      const { parseMarkdown } = await import('@bendyline/squisq/markdown');
      return { markdownDoc: parseMarkdown(imported), container };
    }
    if (definition.importDoc) {
      return { markdownDoc: await definition.importDoc(data, options), container };
    }
    throw new ConversionError('invalid-input', 'Imported document did not contain Markdown.', {
      format: layout.format,
    });
  }

  const markdownDoc = await definition.importDoc!(data, options);
  return { markdownDoc, container: new MemoryContentContainer() };
}

/** Import a rendered target into editable Markdown plus any extracted media. */
export async function importOutsideInDocument(
  source: { data: ArrayBuffer | Uint8Array; targetPath: string },
  options: ConvertOptions = {},
): Promise<ImportedOutsideInDocument> {
  options.signal?.throwIfAborted();
  const layout = requireLayout(source.targetPath);
  const registry = options.registry ?? defaultRegistry();
  const imported = await importMarkdownDocument(arrayBufferOf(source.data), layout, registry, {
    ...options,
    registry,
    from: layout.format,
  });
  options.signal?.throwIfAborted();
  const markdownOptions = options.formatOptions?.md;
  const markdown = withOutsideInMetadata(
    stringifyMarkdown(imported.markdownDoc, markdownOptions?.stringify),
    layout,
  );
  return { layout, markdown, container: imported.container };
}

/** Regenerate the user-facing target from its Markdown source. */
export async function renderOutsideInDocument(
  source: {
    markdown: string | MarkdownDocument;
    targetPath: string;
    container?: ContentContainer;
  },
  options: RenderOutsideInOptions = {},
): Promise<ConversionResult> {
  const layout = requireLayout(source.targetPath);
  if (layout.format === 'html' && !options.html?.playerScriptPath) {
    throw new ConversionError(
      'missing-dependency',
      'Outside-in HTML export needs a shared Squisq player path.',
      { format: 'html' },
    );
  }

  const formatOptions = { ...(options.formatOptions ?? {}) };
  if (layout.format === 'html' && options.html) {
    formatOptions.html = {
      ...(formatOptions.html ?? {}),
      playerScriptPath: options.html.playerScriptPath,
      basePath: options.html.basePath ?? layout.companionName,
    };
  }

  return convert(
    {
      kind: 'markdown',
      markdown: source.markdown,
      container: source.container,
      baseName: layout.stem,
    },
    layout.format,
    {
      ...options,
      title: options.title ?? layout.stem,
      formatOptions,
    },
  );
}
