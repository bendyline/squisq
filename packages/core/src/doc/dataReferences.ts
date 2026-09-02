/**
 * Data References
 *
 * Resolves `{[dataTable src=report_files/data/q3.csv]}`-style sidecar data
 * references into bounded table previews. The sibling of `resolveAudioMapping`:
 * an async, container-reading resolution step that runs before projection
 * (`buildPreviewDoc` / page / dashboard) and whose output is PROJECTION-ONLY —
 * a resolved doc must never be serialized back through `docToMarkdown`, or the
 * preview rows would be baked into the markdown.
 *
 * Core stays parser-free: actual CSV/XLSX/parquet decoding is supplied by the
 * caller through the `DataSourceReader` seam (implementations live in
 * `@bendyline/squisq-formats`).
 */

import type { Doc, Block, DocDiagnostic } from '../schemas/Doc.js';
import type { ContentContainer } from '../storage/ContentContainer.js';
import { TABLE_FED_TEMPLATES, resolveTemplateName } from './templates/templateNames.js';

// ── Conventions ──────────────────────────────────────────────────────

/** File extensions (lowercase, no dot) recognized as sidecar data files. */
export const DATA_FILE_EXTENSIONS = ['csv', 'tsv', 'xlsx', 'parquet'] as const;

/** Extensions addressable by `sheet`/`anchor` params (workbook formats). */
const WORKBOOK_EXTENSIONS = new Set(['xlsx']);

/** Lowercase extension of a path, or empty string. */
function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * True when `path` is a relative container path ending in a data extension.
 * Absolute/protocol URLs are never data sidecar references.
 */
export function isDataFilePath(path: string): boolean {
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(path)) return false;
  return (DATA_FILE_EXTENSIONS as readonly string[]).includes(extensionOf(path));
}

/**
 * The sidecar directory for a document's data files:
 * `<docbasename>_files/data/`. One helper owns the convention so importers,
 * the editor's drop pipeline, and hosts agree on where data lives.
 */
export function dataSidecarPrefix(docBasename: string): string {
  return `${docBasename}_files/data/`;
}

// ── Reader seam ──────────────────────────────────────────────────────

/** A bounded window of tabular data read from a sidecar file. */
export interface DataSourceTable {
  headers: string[];
  /** Preview window of data rows, cells stringified for display. */
  rows: string[][];
  align?: ('left' | 'center' | 'right' | null)[];
  /**
   * Full data-row count in the source AFTER any view-state filter (not just
   * the preview window). With no filter this is the raw row count.
   */
  totalRows: number;
  totalCols: number;
  /** Raw row count before filtering, when a filter was applied. */
  unfilteredTotalRows?: number;
  /** Problems parsing/applying `sort`/`filter` (see `@bendyline/squisq/table`). */
  viewIssues?: import('../table/viewState.js').ViewIssue[];
}

export interface DataSourceReadOptions {
  /** Worksheet name (workbook sources only). */
  sheet?: string;
  /** Top-left cell of the region, e.g. `'B7'` (workbook sources only). */
  anchor?: string;
  /** Whether row 1 of the source is a header row. Default true. */
  headerRow?: boolean;
  /** Maximum data rows to return in `rows`. */
  maxRows: number;
  /**
   * Raw view-state params (`{[dataTable … sort=… filter=…]}`). Readers parse
   * them against their REAL headers and apply `applyTableViewState` on the
   * full body BEFORE windowing to `maxRows` — the resolver cannot do it, the
   * rows are already gone by then. Problems surface via
   * `DataSourceTable.viewIssues`, never a throw.
   */
  sort?: string;
  filter?: string;
}

/**
 * Decodes one family of data files. `extensions` are lowercase without the
 * dot (`['csv', 'tsv']`). `read` may throw — the resolver converts failures
 * into diagnostics rather than propagating them.
 */
export interface DataSourceReader {
  extensions: readonly string[];
  read(data: ArrayBuffer, opts: DataSourceReadOptions): Promise<DataSourceTable>;
}

// ── Resolution ───────────────────────────────────────────────────────

export interface ResolveDataReferencesOptions {
  readers: readonly DataSourceReader[];
  /** Preview window size when a block has no `previewRows` param. Default 50. */
  maxPreviewRows?: number;
}

export interface ResolvedDataReferences {
  /** The doc with previews filled in — the SAME object when nothing changed. */
  doc: Doc;
  diagnostics: DocDiagnostic[];
}

const DEFAULT_MAX_PREVIEW_ROWS = 50;

/** Stats recorded on `templateData.srcStats` alongside the preview rows. */
export interface DataSourceStats {
  /** Data rows after any view-state filter. */
  totalRows: number;
  totalCols: number;
  previewRows: number;
  truncated: boolean;
  /** Raw source rows before filtering, when a filter was applied. */
  unfilteredTotalRows?: number;
}

/** True when the author already supplied table data for this block. */
function hasAuthoredData(block: Block): boolean {
  const provided = (key: string) =>
    !!(block.templateData && key in block.templateData) ||
    !!(block.templateOverrides && key in block.templateOverrides);
  return provided('headers') || provided('rows');
}

function isEligible(block: Block): block is Block & { templateOverrides: Record<string, string> } {
  return (
    !!block.templateOverrides?.src &&
    TABLE_FED_TEMPLATES.has(resolveTemplateName(block.template ?? ''))
  );
}

/**
 * Resolve every `src`-referenced table/chart block against the container.
 *
 * - Author data wins: blocks that already carry `headers`/`rows` (data fence,
 *   `{[…]}` params) are left untouched.
 * - Failures never throw: a missing file, unknown extension, or reader error
 *   becomes a diagnostic and the block is left as-is — its body link still
 *   renders in every projection.
 * - Identity short-circuit: when no block changed, the input doc object is
 *   returned unchanged.
 */
export async function resolveDataReferences(
  doc: Doc,
  container: ContentContainer,
  options: ResolveDataReferencesOptions,
): Promise<ResolvedDataReferences> {
  const diagnostics: DocDiagnostic[] = [];
  const maxPreviewRows = options.maxPreviewRows ?? DEFAULT_MAX_PREVIEW_ROWS;

  const readerByExt = new Map<string, DataSourceReader>();
  for (const reader of options.readers) {
    for (const ext of reader.extensions) readerByExt.set(ext.toLowerCase(), reader);
  }

  // One read per distinct path per pass — MemoryContentContainer copies the
  // bytes on every readFile, so N blocks over one workbook must not read N×.
  const fileCache = new Map<string, Promise<ArrayBuffer | null>>();
  const readCached = (path: string): Promise<ArrayBuffer | null> => {
    let pending = fileCache.get(path);
    if (!pending) {
      pending = container.readFile(path).catch(() => null);
      fileCache.set(path, pending);
    }
    return pending;
  };

  /** Resolve one eligible block; null = leave the block untouched. */
  const resolveBlock = async (block: Block): Promise<Block | null> => {
    const overrides = block.templateOverrides!;
    const src = overrides.src;
    const ext = extensionOf(src);

    if (!isDataFilePath(src)) {
      diagnostics.push({
        severity: 'warning',
        code: 'data-src-no-reader',
        message: `Block "${block.id}": src "${src}" is not a relative data-file path (.${DATA_FILE_EXTENSIONS.join('/.')}).`,
        blockId: block.id,
      });
      return null;
    }

    const reader = readerByExt.get(ext);
    if (!reader) {
      diagnostics.push({
        severity: 'warning',
        code: 'data-src-no-reader',
        message: `Block "${block.id}": no data reader registered for ".${ext}" (src "${src}").`,
        blockId: block.id,
      });
      return null;
    }

    if ((overrides.sheet || overrides.anchor) && !WORKBOOK_EXTENSIONS.has(ext)) {
      diagnostics.push({
        severity: 'info',
        code: 'data-src-param-ignored',
        message: `Block "${block.id}": sheet/anchor only address workbook sources; ignored for ".${ext}".`,
        blockId: block.id,
      });
    }

    const bytes = await readCached(src);
    if (!bytes) {
      diagnostics.push({
        severity: 'warning',
        code: 'data-src-missing',
        message: `Block "${block.id}": data file "${src}" was not found in the document container.`,
        blockId: block.id,
      });
      return null;
    }

    const parsedPreviewRows = Number.parseInt(overrides.previewRows ?? '', 10);
    const maxRows =
      Number.isFinite(parsedPreviewRows) && parsedPreviewRows > 0
        ? parsedPreviewRows
        : maxPreviewRows;

    let table: DataSourceTable;
    try {
      table = await reader.read(bytes, {
        ...(overrides.sheet ? { sheet: overrides.sheet } : {}),
        ...(overrides.anchor ? { anchor: overrides.anchor } : {}),
        ...(overrides.headerRow !== undefined
          ? { headerRow: overrides.headerRow !== 'false' }
          : {}),
        ...(overrides.sort ? { sort: overrides.sort } : {}),
        ...(overrides.filter ? { filter: overrides.filter } : {}),
        maxRows,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      const sheetMiss = /sheet|worksheet/i.test(reason) && WORKBOOK_EXTENSIONS.has(ext);
      diagnostics.push({
        severity: sheetMiss ? 'warning' : 'error',
        code: sheetMiss ? 'data-src-sheet-missing' : 'data-src-parse',
        message: `Block "${block.id}": could not read "${src}": ${reason}`,
        blockId: block.id,
      });
      return null;
    }

    for (const issue of table.viewIssues ?? []) {
      diagnostics.push({
        severity: 'info',
        code: issue.code,
        message: `Block "${block.id}": ${issue.message}`,
        blockId: block.id,
      });
    }

    const srcStats: DataSourceStats = {
      totalRows: table.totalRows,
      totalCols: table.totalCols,
      previewRows: table.rows.length,
      truncated: table.rows.length < table.totalRows,
      ...(table.unfilteredTotalRows !== undefined
        ? { unfilteredTotalRows: table.unfilteredTotalRows }
        : {}),
    };

    return {
      ...block,
      templateData: {
        headers: table.headers,
        rows: table.rows,
        ...(table.align ? { align: table.align } : {}),
        srcStats,
        ...block.templateData,
      },
    };
  };

  let changed = false;

  const resolveBlocks = async (blocks: Block[]): Promise<Block[]> => {
    const next = await Promise.all(
      blocks.map(async (block) => {
        let replacement: Block | null = null;
        if (isEligible(block) && !hasAuthoredData(block)) {
          replacement = await resolveBlock(block);
        }
        let children = block.children;
        if (block.children && block.children.length > 0) {
          children = await resolveBlocks(block.children);
        }
        if (!replacement && children === block.children) return block;
        changed = true;
        const base = replacement ?? block;
        return children === block.children ? base : { ...base, children };
      }),
    );
    return next.some((b, i) => b !== blocks[i]) ? next : blocks;
  };

  const blocks = await resolveBlocks(doc.blocks);
  return {
    doc: changed ? { ...doc, blocks } : doc,
    diagnostics,
  };
}
