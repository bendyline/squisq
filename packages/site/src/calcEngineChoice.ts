export type CalcEngineChoice = 'in-house' | 'ironcalc';

export const CALC_ENGINE_STORAGE_KEY = 'squisq-site:calcEngine';

export function loadCalcEngineChoice(): CalcEngineChoice {
  if (typeof localStorage === 'undefined') return 'in-house';
  return localStorage.getItem(CALC_ENGINE_STORAGE_KEY) === 'ironcalc' ? 'ironcalc' : 'in-house';
}
