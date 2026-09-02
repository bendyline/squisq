/**
 * @bendyline/squisq/table — the tabular-data contracts of the analytics arm.
 *
 * Three pieces, all pure and dependency-free:
 *
 *  - **View state** (`viewState.ts`): the `sort=`/`filter=` annotation param
 *    grammar — non-destructive, document-persisted sort/filter that shapes
 *    the grid, the bounded previews, and exports alike.
 *  - **Reference semantics** (`applyTableViewState.ts`): the one
 *    implementation of those semantics over a plain string matrix; the data
 *    readers apply it before windowing, and the grid's worker kernel is
 *    parity-tested against it.
 *  - **Provider contract** (`provider.ts`): `TableQueryProvider`, the async
 *    surface a grid renders against and query backends implement.
 */

export {
  EMPTY_TABLE_VIEW_STATE,
  isEmptyViewState,
  isNumericCellText,
  inferNumericColumn,
  makeTableCollator,
  parseTableViewState,
  serializeTableViewState,
  quoteViewToken,
} from './viewState.js';
export type {
  SortTerm,
  FilterOp,
  FilterClause,
  TableViewState,
  ViewIssue,
  ParsedTableViewState,
} from './viewState.js';

export { applyTableViewState } from './applyTableViewState.js';
export type { AppliedTableView } from './applyTableViewState.js';

export type {
  TableColumnKind,
  TableColumnSchema,
  TableSchema,
  TableCellValue,
  TableRowsPage,
  TableViewResult,
  TableCellEdit,
  TableEditResult,
  TableDistinctResult,
  TableQueryProvider,
} from './provider.js';
