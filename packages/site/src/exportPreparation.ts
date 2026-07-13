import { markdownToDoc, docToMarkdown } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { applyTransform, extractDocImages } from '@bendyline/squisq/transform';

export interface ExportPreparationOptions {
  transformStyle?: string;
  themeId?: string;
  /** Plain semantic exports deliberately preserve the authored markdown. */
  applyTransform?: boolean;
}

function prepareDocFromMarkdown(
  markdown: MarkdownDocument,
  options: ExportPreparationOptions,
): Doc {
  let doc = markdownToDoc(markdown);
  if (options.applyTransform !== false && options.transformStyle) {
    doc = applyTransform(doc, options.transformStyle, {
      themeId: options.themeId || undefined,
      images: extractDocImages(doc.blocks),
    }).doc;
  }
  if (options.themeId && doc.themeId !== options.themeId) {
    doc = { ...doc, themeId: options.themeId };
  }
  return doc;
}

/** Prepare the visual Doc used by previews and video export. */
export function prepareExportDoc(source: string, options: ExportPreparationOptions = {}): Doc {
  return prepareDocFromMarkdown(parseMarkdown(source), options);
}

/** Prepare markdown-based formats while allowing plain HTML to stay lossless. */
export function prepareExportMarkdown(
  source: string,
  options: ExportPreparationOptions = {},
): MarkdownDocument {
  const markdown = parseMarkdown(source);
  const prepared =
    options.applyTransform === false || !options.transformStyle
      ? markdown
      : docToMarkdown(prepareDocFromMarkdown(markdown, options));
  if (!options.themeId) return prepared;
  return {
    ...prepared,
    frontmatter: { ...(prepared.frontmatter ?? {}), 'squisq-theme': options.themeId },
  };
}

function normalizeDocumentPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Build a workspace reader whose entry document is the live editor buffer.
 * Sibling documents still come from storage, but an unsaved entry can never be
 * silently replaced with its last persisted version during linked export.
 */
export function createEntryAwareDocumentReader(
  container: ContentContainer,
  entryPath: string,
  currentMarkdown: string,
): (path: string) => Promise<string | null> {
  const normalizedEntry = normalizeDocumentPath(entryPath);
  const decoder = new TextDecoder();
  return async (path: string) => {
    if (normalizeDocumentPath(path) === normalizedEntry) return currentMarkdown;
    const data = await container.readFile(path);
    return data ? decoder.decode(data) : null;
  };
}
