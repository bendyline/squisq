import type { Block, Doc } from '@bendyline/squisq/schemas';
import { isDataFilePath, resolveTemplateName } from '@bendyline/squisq/doc';

export interface SlideshowDataSource {
  blockId: string;
  src: string;
  ext: string;
  sheet?: string;
  anchor?: string;
  headerRow?: boolean;
  sort?: string;
  filter?: string;
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function blockHasAuthoredRows(block: Block): boolean {
  const owns = (record: Record<string, unknown> | undefined, key: string) =>
    !!record && Object.prototype.hasOwnProperty.call(record, key);
  return (
    owns(block.templateData, 'headers') ||
    owns(block.templateData, 'rows') ||
    owns(block.templateOverrides, 'headers') ||
    owns(block.templateOverrides, 'rows')
  );
}

/** Collect source descriptors without reading files or mutating the Doc. */
export function collectSlideshowDataSources(doc: Doc | null): Map<string, SlideshowDataSource> {
  const sources = new Map<string, SlideshowDataSource>();
  if (!doc) return sources;

  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      const overrides = block.templateOverrides;
      const src = overrides?.src;
      if (
        typeof src === 'string' &&
        isDataFilePath(src) &&
        resolveTemplateName(block.template ?? '') === 'dataTable' &&
        !blockHasAuthoredRows(block)
      ) {
        sources.set(block.id, {
          blockId: block.id,
          src,
          ext: extensionOf(src),
          ...(overrides?.sheet ? { sheet: overrides.sheet } : {}),
          ...(overrides?.anchor ? { anchor: overrides.anchor } : {}),
          ...(overrides?.headerRow !== undefined
            ? { headerRow: overrides.headerRow !== 'false' }
            : {}),
          ...(overrides?.sort ? { sort: overrides.sort } : {}),
          ...(overrides?.filter ? { filter: overrides.filter } : {}),
        });
      }
      if (block.children?.length) visit(block.children);
    }
  };

  visit(doc.blocks);
  return sources;
}
