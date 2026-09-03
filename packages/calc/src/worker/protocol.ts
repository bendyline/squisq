/**
 * Message protocol between the worker-engine client proxy and the worker
 * host. Every payload is structured-clone-safe plain data (the whole
 * `CalcEngine` surface already is). Fire-and-forget mutations carry no id;
 * everything that answers carries a sequence id the client awaits on.
 */

import type {
  CalcBudgets,
  CalcCellAddress,
  CalcCellState,
  CalcEngineConfig,
  CalcEvaluationResult,
  CalcRangeAddress,
  CalcScalar,
  CalcValue,
  CalcWorkbookSeed,
} from '../types.js';

export type CalcWorkerRequest =
  | { type: 'create'; id: number; config: SerializableEngineConfig }
  | { type: 'loadWorkbook'; id: number; seed: CalcWorkbookSeed }
  | { type: 'setCellValue'; address: CalcCellAddress; value: CalcScalar | null }
  | { type: 'setCellFormula'; address: CalcCellAddress; formula: string }
  | { type: 'clearCell'; address: CalcCellAddress }
  | { type: 'getCells'; id: number; addresses: CalcCellAddress[] }
  | { type: 'evaluateAll'; id: number; budgets?: CalcBudgets }
  | { type: 'evaluateFormula'; id: number; formula: string; context?: CalcCellAddress }
  | { type: 'precedentsOf'; id: number; address: CalcCellAddress }
  | { type: 'dependentsOf'; id: number; address: CalcCellAddress }
  | { type: 'dispose' };

export type CalcWorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'done'; id: number }
  | { type: 'cells'; id: number; states: CalcCellState[] }
  | { type: 'evaluated'; id: number; result: CalcEvaluationResult }
  | { type: 'value'; id: number; value: CalcValue }
  | { type: 'ranges'; id: number; ranges: CalcRangeAddress[] }
  | { type: 'addresses'; id: number; addresses: CalcCellAddress[] }
  | { type: 'error'; id: number; message: string };

/** `CalcEngineConfig` minus the uncloneable clock (the worker uses its own). */
export type SerializableEngineConfig = Omit<CalcEngineConfig, 'now'>;

/** The transport seam: a real Worker, or an in-process bridge for tests/Node. */
export interface CalcWorkerTransport {
  post(message: CalcWorkerRequest): void;
  onMessage(handler: (message: CalcWorkerResponse) => void): void;
  terminate(): void;
}
