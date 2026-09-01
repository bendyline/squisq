/**
 * Materialize `{[dataTable src=…]}` sidecar references into inline markdown
 * tables — the FULL data, not the bounded preview. Used by exports that
 * embed values (XLSX: a src-referenced block would otherwise contribute no
 * table and silently vanish from the workbook).
 *
 * Never throws: a missing container, unreadable file, or absent reader
 * degrades to an `onWarning` message and the reference block is left as-is
 * (its body link simply doesn't survive a tables-only export).
 */

import { isDataFilePath } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownTable,
  MarkdownTableRow,
} from '@bendyline/squisq/markdown';
import { defaultDataReaders } from './readers.js';

function tableRow(cells: string[]): MarkdownTableRow {
  return {
    type: 'tableRow',
    children: cells.map((value) => ({
      type: 'tableCell',
      children: value ? [{ type: 'text', value }] : [],
    })),
  };
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Returns a copy of `markdownDoc` where every heading annotated with a
 * resolvable data `src` is followed by the full source table. The input
 * document is returned unchanged (same object) when nothing materialized.
 */
export async function materializeDataReferences(
  markdownDoc: MarkdownDocument,
  container: ContentContainer | null | undefined,
  onWarning?: (message: string) => void,
): Promise<MarkdownDocument> {
  const readers = defaultDataReaders();
  const children: MarkdownBlockNode[] = [];
  let changed = false;

  for (const node of markdownDoc.children) {
    children.push(node);
    if (node.type !== 'heading') continue;
    const params = node.templateAnnotation?.params;
    const src = params?.src;
    if (!src || !isDataFilePath(src)) continue;

    const label = params?.sheet && params?.anchor ? `${params.sheet}!${params.anchor}` : src;
    if (!container) {
      onWarning?.(
        `Data reference "${src}" could not be embedded: the export has no source container to read it from.`,
      );
      continue;
    }

    const ext = extensionOf(src);
    const reader = readers.find((r) => r.extensions.includes(ext));
    if (!reader) {
      onWarning?.(`Data reference "${src}" could not be embedded: no reader for ".${ext}".`);
      continue;
    }

    let bytes: ArrayBuffer | null = null;
    try {
      bytes = await container.readFile(src);
    } catch {
      bytes = null;
    }
    if (!bytes) {
      onWarning?.(`Data reference "${src}" could not be embedded: file not found in container.`);
      continue;
    }

    try {
      const table = await reader.read(bytes, {
        maxRows: Number.POSITIVE_INFINITY,
        ...(params?.sheet ? { sheet: params.sheet } : {}),
        ...(params?.anchor ? { anchor: params.anchor } : {}),
        ...(params?.headerRow !== undefined ? { headerRow: params.headerRow !== 'false' } : {}),
      });
      const mdTable: MarkdownTable = {
        type: 'table',
        children: [tableRow(table.headers), ...table.rows.map(tableRow)],
      };
      children.push(mdTable);
      changed = true;
      if (ext === 'xlsx') {
        onWarning?.(
          `Region ${label} exported as values; formulas in the sidecar workbook were not carried over.`,
        );
      }
    } catch (err: unknown) {
      onWarning?.(
        `Data reference "${src}" could not be embedded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return changed ? { ...markdownDoc, children } : markdownDoc;
}
