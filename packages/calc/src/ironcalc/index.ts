/**
 * `@bendyline/squisq-calc/ironcalc` — the IronCalc backend behind the
 * `CalcEngine` contract, as its own SUBPATH entry so the root package
 * stays pure contract + in-house tier and bundlers only pull this code
 * (and its optional-peer dynamic import) when a host asks for it.
 *
 * `@ironcalc/wasm` is an OPTIONAL PEER reached only via dynamic `import()`
 * (the harper.js/hyparquet semantics): zero wasm bytes until
 * `createIronCalcEngine()` actually runs.
 */

export { createIronCalcEngine, isIronCalcAvailable } from './adapter.js';
export type { IronCalcEngineOptions } from './adapter.js';
