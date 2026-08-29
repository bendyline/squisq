/**
 * Proofing state distribution. `ProofingRoot` sits INSIDE
 * `EditorProvider` and wraps the shell body: children pass through with
 * stable identity, so lint passes re-render only proofing consumers
 * (StatusBar segment, panel, menu) — never the editors themselves.
 * Consumers use the null-safe `useProofingState()` and render nothing
 * when the host injected no capability.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useEditorContext } from '../EditorContext';
import { useProofing, type ProofingState } from './useProofing';
import { ProofingMenu } from './ProofingMenu';

const ProofingStateContext = createContext<ProofingState | null>(null);

/** Proofing state, or `null` when the host injected no capability. */
// eslint-disable-next-line react-refresh/only-export-components -- hook is co-located with its provider by design, mirroring CustomTemplateContext
export function useProofingState(): ProofingState | null {
  return useContext(ProofingStateContext);
}

/** Mount point for proofing orchestration + the shared suggestions menu. */
export function ProofingRoot({ children }: { children: ReactNode }): JSX.Element {
  const { colorScheme } = useEditorContext();
  const state = useProofing();

  const menuFinding =
    state?.menuAnchor != null
      ? (state.findings.find((finding) => finding.id === state.menuAnchor?.findingId) ?? null)
      : null;

  return (
    <ProofingStateContext.Provider value={state}>
      {children}
      {state && state.menuAnchor && menuFinding && (
        <ProofingMenu
          anchor={state.menuAnchor}
          finding={menuFinding}
          colorScheme={colorScheme}
          onApply={(index) => {
            state.applySuggestion(menuFinding.id, index);
            state.closeMenu();
          }}
          onIgnore={() => {
            state.ignoreFinding(menuFinding.id);
            state.closeMenu();
          }}
          onAddToAppDictionary={() => {
            state.addToAppDictionary(menuFinding.id);
            state.closeMenu();
          }}
          onAddToDocWordList={() => {
            state.addToDocWordList(menuFinding.id);
            state.closeMenu();
          }}
          canAddToAppDictionary={state.canAddToAppDictionary}
          onClose={state.closeMenu}
        />
      )}
    </ProofingStateContext.Provider>
  );
}
