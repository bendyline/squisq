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
 * The registry-free path rules are also published alone as
 * `@bendyline/squisq-formats/outside-in-layout`.
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
import {
  OUTSIDE_IN_FORMAT_IDS,
  resolveOutsideInLayout,
  type OutsideInFormatId,
  type OutsideInLayout,
} from './layout.js';

// The pure path rules live in `./layout` (published alone as
// `/outside-in-layout`); this entry keeps the full contract in one place.
export {
  OUTSIDE_IN_FORMAT_IDS,
  chooseOutsideInMarkdownPath,
  isOutsideInTargetPath,
  resolveOutsideInLayout,
} from './layout.js';
export type { OutsideInFormatId, OutsideInLayout } from './layout.js';

const OUTSIDE_IN_FORMAT_SET = new Set<string>(OUTSIDE_IN_FORMAT_IDS);
const OUTSIDE_IN_VERSION_KEY = 'squisq-outside-in';
const OUTSIDE_IN_OUTPUT_KEY = 'squisq-output';
const OUTSIDE_IN_FORMAT_KEY = 'squisq-output-format';
export const OUTSIDE_IN_UPDATE_FROM_MARKDOWN_KEY = 'squisq-updatefrommarkdown';

export interface OutsideInMetadata {
  version: 1;
  format: OutsideInFormatId;
  target: string;
  /** Only an exact boolean true authorizes Markdown-driven regeneration. */
  updateFromMarkdown: boolean;
}

export interface ImportedOutsideInDocument {
  layout: OutsideInLayout;
  markdown: string;
  /** Imported media container. Hosts copy its non-Markdown members into the companion folder. */
  container: ContentContainer;
  /** Non-fatal fidelity notes from theme/layout inference. */
  warnings: string[];
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
  return {
    version: 1,
    target,
    format: format as OutsideInFormatId,
    updateFromMarkdown: frontmatter[OUTSIDE_IN_UPDATE_FROM_MARKDOWN_KEY] === true,
  };
}

/** Add or refresh the portable relationship while preserving unrelated frontmatter. */
export function withOutsideInMetadata(source: string, layout: OutsideInLayout): string {
  return setFrontmatterValues(source, {
    [OUTSIDE_IN_VERSION_KEY]: 1,
    [OUTSIDE_IN_OUTPUT_KEY]: layout.relativeTargetPath,
    [OUTSIDE_IN_FORMAT_KEY]: layout.format,
  });
}

/** True only when the companion explicitly opts into rendered-file updates. */
export function isOutsideInMarkdownEditingEnabled(source: string | MarkdownDocument): boolean {
  if (typeof source !== 'string') {
    return source.frontmatter?.[OUTSIDE_IN_UPDATE_FROM_MARKDOWN_KEY] === true;
  }
  const yaml = rawFrontmatter(source);
  const frontmatter = yaml === null ? null : parseFrontmatter(yaml);
  return frontmatter?.[OUTSIDE_IN_UPDATE_FROM_MARKDOWN_KEY] === true;
}

/**
 * Opt a companion into or out of Markdown-driven regeneration while keeping
 * the portable target relationship current.
 */
export function withOutsideInMarkdownEditing(
  source: string,
  layout: OutsideInLayout,
  enabled = true,
): string {
  return setFrontmatterValues(withOutsideInMetadata(source, layout), {
    [OUTSIDE_IN_UPDATE_FROM_MARKDOWN_KEY]: enabled,
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

async function retainImportedOfficeTheme(
  data: ArrayBuffer,
  layout: OutsideInLayout,
  markdownDoc: MarkdownDocument,
  options: ConvertOptions,
): Promise<string[]> {
  if (layout.format !== 'docx' && layout.format !== 'xlsx') return [];
  if (typeof markdownDoc.frontmatter?.['squisq-theme'] === 'string') return [];

  try {
    const [{ inferThemeFromFile }, themeCodec] = await Promise.all([
      import('../infer/index.js'),
      import('@bendyline/squisq/doc'),
    ]);
    const inferred = await inferThemeFromFile(data, {
      format: layout.format,
      nameHint: layout.stem,
      signal: options.signal,
    });
    const payload = themeCodec.writeCustomThemesToFrontmatter([inferred.theme]);
    if (payload) {
      markdownDoc.frontmatter = {
        ...(markdownDoc.frontmatter ?? {}),
        [themeCodec.FRONTMATTER_CUSTOM_THEMES_KEY]: payload,
        'squisq-theme': inferred.theme.id,
      };
    }
    return inferred.warnings;
  } catch (error: unknown) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    return [
      `The ${layout.format.toUpperCase()} content was imported, but its Office theme could not be retained: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

/** Import a rendered target into editable Markdown plus any extracted media. */
export async function importOutsideInDocument(
  source: { data: ArrayBuffer | Uint8Array; targetPath: string },
  options: ConvertOptions = {},
): Promise<ImportedOutsideInDocument> {
  options.signal?.throwIfAborted();
  const layout = requireLayout(source.targetPath);
  const data = arrayBufferOf(source.data);
  const registry = options.registry ?? defaultRegistry();
  // Outside-in CSV must keep its table in Markdown. The CSV container's
  // normal large-data spill mode would make the companion point at a copied
  // CSV sidecar, then leave the registry exporter with no table from which to
  // regenerate the visible target.
  const importOptions: ConvertOptions =
    layout.format === 'csv'
      ? {
          ...options,
          formatOptions: {
            ...options.formatOptions,
            csv: { ...options.formatOptions?.csv, sidecar: 'never' },
          },
        }
      : options;
  const imported = await importMarkdownDocument(data, layout, registry, {
    ...importOptions,
    registry,
    from: layout.format,
  });
  const warnings = await retainImportedOfficeTheme(data, layout, imported.markdownDoc, options);
  options.signal?.throwIfAborted();
  const markdownOptions = options.formatOptions?.md;
  const markdown = withOutsideInMetadata(
    stringifyMarkdown(imported.markdownDoc, markdownOptions?.stringify),
    layout,
  );
  return { layout, markdown, container: imported.container, warnings };
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
  if (!isOutsideInMarkdownEditingEnabled(source.markdown)) {
    throw new ConversionError(
      'invalid-input',
      `Outside-in editing is read-only until ${OUTSIDE_IN_UPDATE_FROM_MARKDOWN_KEY}: true is set.`,
      { format: layout.format },
    );
  }
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
