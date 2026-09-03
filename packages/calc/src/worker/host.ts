/**
 * The worker-side dispatcher: one in-house engine driven by the protocol.
 * Pure (takes a `post` function, returns a message handler) so tests and
 * the in-process fallback can run it without a real Worker; `entry.ts`
 * wires it to the worker global scope.
 */

import { createInHouseEngine } from '../engine.js';
import type { CalcEngine } from '../types.js';
import type { CalcWorkerRequest, CalcWorkerResponse } from './protocol.js';

export function createCalcWorkerHost(
  post: (message: CalcWorkerResponse) => void,
): (message: CalcWorkerRequest) => void {
  let engine: CalcEngine | null = null;

  const fail = (id: number, err: unknown): void => {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  };

  return (message: CalcWorkerRequest): void => {
    try {
      switch (message.type) {
        case 'create':
          engine?.dispose();
          engine = createInHouseEngine(message.config);
          post({ type: 'ready', id: message.id });
          return;
        case 'dispose':
          engine?.dispose();
          engine = null;
          return;
        default:
          break;
      }
      if (!engine) {
        if ('id' in message) fail(message.id, new Error('engine not created'));
        return;
      }

      switch (message.type) {
        case 'loadWorkbook':
          void engine.loadWorkbook(message.seed).then(
            () => post({ type: 'done', id: message.id }),
            (err: unknown) => fail(message.id, err),
          );
          return;
        case 'setCellValue':
          engine.setCellValue(message.address, message.value);
          return;
        case 'setCellFormula':
          engine.setCellFormula(message.address, message.formula);
          return;
        case 'clearCell':
          engine.clearCell(message.address);
          return;
        case 'getCells':
          void engine.getCells(message.addresses).then(
            (states) => post({ type: 'cells', id: message.id, states }),
            (err: unknown) => fail(message.id, err),
          );
          return;
        case 'evaluateAll':
          void engine.evaluateAll(message.budgets).then(
            (result) => post({ type: 'evaluated', id: message.id, result }),
            (err: unknown) => fail(message.id, err),
          );
          return;
        case 'evaluateFormula':
          void engine.evaluateFormula(message.formula, message.context).then(
            (value) => post({ type: 'value', id: message.id, value }),
            (err: unknown) => fail(message.id, err),
          );
          return;
        case 'precedentsOf':
          void engine.precedentsOf(message.address).then(
            (ranges) => post({ type: 'ranges', id: message.id, ranges }),
            (err: unknown) => fail(message.id, err),
          );
          return;
        case 'dependentsOf':
          void engine.dependentsOf(message.address).then(
            (addresses) => post({ type: 'addresses', id: message.id, addresses }),
            (err: unknown) => fail(message.id, err),
          );
          return;
      }
    } catch (err: unknown) {
      if ('id' in message) fail(message.id, err);
    }
  };
}
