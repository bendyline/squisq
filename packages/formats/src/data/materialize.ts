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

import {
  isDataFilePath,
  type DataSourceReadOptions,
  type DataSourceTable,
} from '@bendyline/squisq/doc';
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

function count(n: number): string {
  return n.toLocaleString('en-US');
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Rows a data reference shows in a document or page, which cannot carry the
 * file it points at; the reader follows the author's link for the rest.
 */
export const DATA_PREVIEW_ROWS = 100;

export interface MaterializeDataReferencesOptions {
  /**
   * Embed at most this many data rows per reference — a block's own
   * `previewRows` param wins — followed by a "Showing N of M rows" note when
   * rows were left out. Default: every row.
   */
  maxRows?: number;
  /**
   * A caller-owned memo of reader results, keyed by file and read options,
   * for a caller that materializes the same document repeatedly (a live
   * preview). The caller clears it when the files may have changed.
   */
  tableCache?: Map<string, Promise<DataSourceTable>>;
}

/**
 * Returns a copy of `markdownDoc` where every heading annotated with a
 * resolvable data `src` is followed by the source table (in full unless
 * `options.maxRows` bounds it). A reference whose heading is already followed
 * by a table keeps it — author data wins, as in `resolveDataReferences` — so
 * materializing twice adds nothing. The input document is returned unchanged
 * (same object) when nothing materialized.
 */
export async function materializeDataReferences(
  markdownDoc: MarkdownDocument,
  container: ContentContainer | null | undefined,
  onWarning?: (message: string) => void,
  options: MaterializeDataReferencesOptions = {},
): Promise<MarkdownDocument> {
  const readers = defaultDataReaders();
  const children: MarkdownBlockNode[] = [];
  let changed = false;

  for (const [index, node] of markdownDoc.children.entries()) {
    children.push(node);
    if (node.type !== 'heading') continue;
    const params = node.templateAnnotation?.params;
    const src = params?.src;
    if (!src || !isDataFilePath(src)) continue;
    if (markdownDoc.children[index + 1]?.type === 'table') continue;

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

    const previewRows = Number.parseInt(params?.previewRows ?? '', 10);
    const maxRows =
      options.maxRows === undefined
        ? Number.POSITIVE_INFINITY
        : previewRows > 0
          ? previewRows
          : options.maxRows;
    const readOptions: DataSourceReadOptions = {
      maxRows,
      ...(params?.sheet ? { sheet: params.sheet } : {}),
      ...(params?.anchor ? { anchor: params.anchor } : {}),
      ...(params?.headerRow !== undefined ? { headerRow: params.headerRow !== 'false' } : {}),
      // Exports honor the author's curated view: the sort/filter params
      // shape the embedded full table exactly as they shape previews.
      ...(params?.sort ? { sort: params.sort } : {}),
      ...(params?.filter ? { filter: params.filter } : {}),
    };
    const cacheKey = [
      src,
      readOptions.sheet ?? '',
      readOptions.anchor ?? '',
      String(readOptions.headerRow ?? ''),
      readOptions.sort ?? '',
      readOptions.filter ?? '',
      String(maxRows),
    ].join('\u0000');
    let pending = options.tableCache?.get(cacheKey);
    if (!pending) {
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
      pending = reader.read(bytes, readOptions);
      options.tableCache?.set(cacheKey, pending);
    }
    try {
      const table = await pending;
      const mdTable: MarkdownTable = {
        type: 'table',
        children: [tableRow(table.headers), ...table.rows.map(tableRow)],
      };
      children.push(mdTable);
      if (table.totalRows > table.rows.length) {
        children.push({
          type: 'paragraph',
          children: [
            {
              type: 'emphasis',
              children: [
                {
                  type: 'text',
                  value: `Showing ${count(table.rows.length)} of ${count(table.totalRows)} rows.`,
                },
              ],
            },
          ],
        });
      }
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
