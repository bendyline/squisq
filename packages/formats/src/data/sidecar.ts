/**
 * Sidecar naming shared by the spill-capable importers (`xlsxToContainer`,
 * `csvToContainer`): one place decides the document filename and the
 * `<docbasename>_files/data/<file>` path a spilled reference points at, so
 * the markdown `src` param and the container write can never disagree.
 */

import { dataSidecarPrefix } from '@bendyline/squisq/doc';
import { stringifyMarkdown, type MarkdownDocument } from '@bendyline/squisq/markdown';

/** Strip any path components from a user-supplied source file name. */
export function sanitizeSourceFileName(name: string | undefined, fallback: string): string {
  const base = (name ?? '').split(/[\\/]/).pop()?.trim() ?? '';
  return base || fallback;
}

/**
 * Doc basename slug for a source file name — the outside-in `slugStem`
 * rules (NFKD, strip marks, lowercase, non-alphanumeric → `-`), applied to
 * the name without its extension. `'Q3 Report.xlsx'` → `'q3-report'`.
 */
export function docSlugForFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const slug = stem
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'document';
}

/** Where a spill-capable import writes its document and sidecar. */
export interface DataSidecarPlan {
  /** Doc basename slug, e.g. `'q3-report'`. */
  slug: string;
  /** Document filename inside the container, e.g. `'q3-report.md'`. */
  markdownFilename: string;
  /** Sidecar file name (source name, path components stripped). */
  fileName: string;
  /** Container path the `src` param references, e.g. `'q3-report_files/data/Q3 Report.xlsx'`. */
  sidecarPath: string;
}

export function planDataSidecar(
  sourceName: string | undefined,
  fallbackName: string,
): DataSidecarPlan {
  const fileName = sanitizeSourceFileName(sourceName, fallbackName);
  const slug = docSlugForFileName(fileName);
  return {
    slug,
    markdownFilename: `${slug}.md`,
    fileName,
    sidecarPath: `${dataSidecarPrefix(slug)}${fileName}`,
  };
}

/**
 * The reference block a fully-sidecarred data file becomes: an annotated
 * heading (`# <title> {[dataTable src=…]}`) plus the graceful-degradation
 * body link. Built as an AST so annotation quoting and link escaping go
 * through the one stringifier that knows the rules.
 */
export function sidecarReferenceDoc(plan: DataSidecarPlan): MarkdownDocument {
  const title = plan.fileName.replace(/\.[^.]+$/, '');
  return {
    type: 'document',
    children: [
      {
        type: 'heading',
        depth: 1,
        children: [{ type: 'text', value: title }],
        templateAnnotation: { template: 'dataTable', params: { src: plan.sidecarPath } },
      },
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: plan.sidecarPath,
            children: [{ type: 'text', value: plan.fileName }],
          },
        ],
      },
    ],
  };
}

/** {@link sidecarReferenceDoc} as serialized markdown source. */
export function sidecarReferenceMarkdown(plan: DataSidecarPlan): string {
  return stringifyMarkdown(sidecarReferenceDoc(plan));
}
