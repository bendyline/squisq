/** Error-value constructors and guards shared by every module. */

import type { CalcErrorCode, CalcErrorValue, CalcValue } from './types.js';

const CODES: readonly CalcErrorCode[] = [
  '#DIV/0!',
  '#N/A',
  '#NAME?',
  '#NULL!',
  '#NUM!',
  '#REF!',
  '#VALUE!',
  '#SPILL!',
  '#CALC!',
];

const INSTANCES: ReadonlyMap<CalcErrorCode, CalcErrorValue> = new Map(
  CODES.map((code) => [code, Object.freeze({ kind: 'calc-error' as const, code })]),
);

export function calcError(code: CalcErrorCode): CalcErrorValue {
  return INSTANCES.get(code)!;
}

export function isCalcError(value: CalcValue | unknown): value is CalcErrorValue {
  return (
    typeof value === 'object' && value !== null && (value as CalcErrorValue).kind === 'calc-error'
  );
}

export const ERROR_CODES: readonly CalcErrorCode[] = CODES;

/** `"#N/A"` → the error value; null for ordinary text. */
export function parseErrorLiteral(text: string): CalcErrorValue | null {
  const upper = text.toUpperCase() as CalcErrorCode;
  return INSTANCES.get(upper) ?? null;
}

export const DIV0 = calcError('#DIV/0!');
export const NA = calcError('#N/A');
export const NAME_ERROR = calcError('#NAME?');
export const NULL_ERROR = calcError('#NULL!');
export const NUM_ERROR = calcError('#NUM!');
export const REF_ERROR = calcError('#REF!');
export const VALUE_ERROR = calcError('#VALUE!');
export const CALC_ERROR = calcError('#CALC!');
