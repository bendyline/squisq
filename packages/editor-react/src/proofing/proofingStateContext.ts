/**
 * The proofing state's context on its own, so a consumer can read it without
 * importing the orchestration (`ProofingRoot` provides it). The shared editor
 * context menu reads it to lead a right-click on a squiggle with that
 * finding's suggestions.
 */

import { createContext, useContext } from 'react';
import type { ProofingState } from './useProofing';

export const ProofingStateContext = createContext<ProofingState | null>(null);

/** Proofing state, or `null` when the host injected no capability. */
export function useProofingState(): ProofingState | null {
  return useContext(ProofingStateContext);
}
