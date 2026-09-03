/**
 * @bendyline/squisq-grid-react — the virtualized data grid of the squisq
 * analytics arm.
 *
 * Three layers, all against core's `@bendyline/squisq/table` contracts:
 *
 *  - **Columnar store** (`store/columns.ts`): a neutral `IngestTable`
 *    (built by the host from the sidecar readers) becomes typed columns —
 *    Float64/dictionary/boolean — sized for 100k×20 comfortably.
 *  - **Worker kernel + client** (`store/kernel.ts`, `store/client.ts`):
 *    sort/filter/window/edit run in a zero-asset Blob-URL Web Worker (an
 *    in-process fallback covers SSR/tests); `TableStoreClient` implements
 *    `TableQueryProvider`.
 *  - **Renderer** (`DataGrid.tsx`): TanStack-Virtual rows, spreadsheet
 *    keyboard/selection/clipboard, inline editing with an `EditJournal`,
 *    themed via `--squisq-grid-*` tokens (import
 *    `@bendyline/squisq-grid-react/styles`).
 *
 * The Tiptap mount lives in `@bendyline/squisq-editor-react` (the data-card
 * widget lazy-imports this package); the grid itself has no editor
 * dependencies and works in any React host.
 */

export {
  buildColumnarTable,
  columnCellValue,
  type IngestCell,
  type IngestColumnHint,
  type IngestTable,
  type StoreColumn,
  type ColumnarTable,
} from './store/columns.js';

export {
  tableKernel,
  buildKernelSource,
  type KernelScope,
  type KernelRequest,
  type KernelResponse,
  type KernelColumnPayload,
  type KernelCellEdit,
} from './store/kernel.js';

export { TableStoreClient, LocalKernelHost, type TableStoreClientOptions } from './store/client.js';

export { EditJournal, journalFor, discardJournal, type JournalEntry } from './store/journal.js';

export {
  DataGrid,
  type DataGridProps,
  type FormulaCommitResult,
  type FormulaSupport,
} from './DataGrid.js';
