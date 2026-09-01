/**
 * @bendyline/squisq-formats Data Module
 *
 * Sidecar data readers behind core's `DataSourceReader` seam: the
 * implementations `resolveDataReferences` uses to turn a
 * `{[dataTable src=report_files/data/q3.csv]}` reference into a bounded
 * table preview. CSV/TSV, XLSX (region-aware via the import pipeline), and
 * parquet (optional peer `hyparquet`, loaded lazily).
 *
 * @example
 * ```ts
 * import { defaultDataReaders } from '@bendyline/squisq-formats/data';
 * import { resolveDataReferences } from '@bendyline/squisq/doc';
 *
 * const { doc } = await resolveDataReferences(parsed, container, {
 *   readers: defaultDataReaders(),
 * });
 * ```
 */

export { csvDataReader, xlsxDataReader, parquetDataReader, defaultDataReaders } from './readers.js';
export { materializeDataReferences } from './materialize.js';
export {
  docSlugForFileName,
  planDataSidecar,
  sanitizeSourceFileName,
  sidecarReferenceDoc,
  sidecarReferenceMarkdown,
  type DataSidecarPlan,
} from './sidecar.js';
