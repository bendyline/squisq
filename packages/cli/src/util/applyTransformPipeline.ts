/**
 * applyTransformPipeline
 *
 * Shared `--theme` / `--transform` option handling for the convert and video
 * commands: option validation plus the transform application pipeline.
 *
 * Validation split (mirrors the original convert behavior):
 * - Transform styles can be validated up front — the style registry is static.
 * - Theme ids are validated only after the input has been read, so custom
 *   themes inlined in the doc (frontmatter `squisq-custom-themes` or
 *   `Doc.customThemes`) are admitted rather than rejected as "unknown".
 */

import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';

/**
 * Throw if `style` is not a registered transform style id.
 */
export async function assertValidTransformStyle(style: string): Promise<void> {
  const { getTransformStyleIds } = await import('@bendyline/squisq/transform');
  const styles = getTransformStyleIds();
  if (!styles.includes(style)) {
    throw new Error(`Unknown transform style "${style}". Available: ${styles.join(', ')}`);
  }
}

/**
 * Throw if `themeId` is neither a built-in theme nor a custom theme declared
 * by the document. Custom themes are read from the markdown frontmatter when
 * a MarkdownDocument is available, otherwise from `Doc.customThemes` (the
 * pre-built Doc JSON case).
 */
export async function assertValidThemeId(
  themeId: string,
  source: { markdownDoc?: MarkdownDocument | null; doc?: Doc | null },
): Promise<void> {
  const { getAvailableThemes } = await import('@bendyline/squisq/schemas');
  const builtins = getAvailableThemes();

  let customIds: string[] = [];
  if (source.markdownDoc) {
    const { readCustomThemesFromFrontmatter } = await import('@bendyline/squisq/doc');
    customIds = (readCustomThemesFromFrontmatter(source.markdownDoc.frontmatter) ?? []).map(
      (t) => t.id,
    );
  } else if (source.doc?.customThemes) {
    customIds = source.doc.customThemes.map((t) => t.id);
  }

  if (!builtins.includes(themeId) && !customIds.includes(themeId)) {
    throw new Error(
      `Unknown theme "${themeId}". Available: ${[...builtins, ...customIds].join(', ')}`,
    );
  }
}

/**
 * Apply a transform style to a Doc.
 * Pipeline: Doc → extractDocImages → applyTransform → Doc
 */
export async function applyTransformToDoc(
  doc: Doc,
  transformStyle: string,
  themeId?: string,
): Promise<Doc> {
  const { applyTransform, extractDocImages } = await import('@bendyline/squisq/transform');

  // Extract image metadata from the doc for transform interleaving
  const images = extractDocImages(doc.blocks);

  const result = applyTransform(doc, transformStyle, {
    themeId,
    images,
  });

  return result.doc;
}

/**
 * Apply a transform style to a MarkdownDocument.
 * Pipeline: MarkdownDocument → Doc → applyTransform → docToMarkdown → MarkdownDocument
 */
export async function applyTransformToMarkdown(
  markdownDoc: MarkdownDocument,
  transformStyle: string,
  themeId?: string,
  autoTemplates?: boolean,
): Promise<MarkdownDocument> {
  const { markdownToDoc, docToMarkdown } = await import('@bendyline/squisq/doc');

  const doc = markdownToDoc(markdownDoc, { autoTemplates });
  const transformed = await applyTransformToDoc(doc, transformStyle, themeId);

  return docToMarkdown(transformed);
}
