/**
 * Proofing state distribution. `ProofingRoot` sits INSIDE
 * `EditorProvider` and wraps the shell body: children pass through with
 * stable identity, so lint passes re-render only proofing consumers
 * (StatusBar segment, panel, menu) — never the editors themselves.
 * Consumers use the null-safe `useProofingState()` and render nothing
 * when the host injected no capability.
 */

import type { ReactNode } from 'react';
import { useEditorContext } from '../EditorContext';
import { useProofing } from './useProofing';
import { ProofingMenu } from './ProofingMenu';
import { ProofingTooltip } from './ProofingTooltip';
import { ProofingStateContext } from './proofingStateContext';

// eslint-disable-next-line react-refresh/only-export-components -- hook is co-located with its provider by design, mirroring CustomTemplateContext
export { useProofingState } from './proofingStateContext';

export interface ProofingRootProps {
  children: ReactNode;
  /**
   * The host's link delegate (`EditorShell`'s `onLinkClick`). With one, a
   * finger on a squiggled link gets a card that offers "Open link" instead of
   * the link opening out from under it.
   */
  onLinkClick?: (href: string) => boolean | undefined;
}

/** Mount point for proofing orchestration + the shared suggestions menu. */
export function ProofingRoot({ children, onLinkClick }: ProofingRootProps): JSX.Element {
  const { colorScheme } = useEditorContext();
  const state = useProofing({ canOpenLinks: onLinkClick != null });

  const menuFinding =
    state?.menuAnchor != null
      ? (state.findings.find((finding) => finding.id === state.menuAnchor?.findingId) ?? null)
      : null;
  // The menu wins when both are live — it is the same explanation with
  // the full action list, opened deliberately.
  const hoverFinding =
    state?.hoverAnchor != null && !state.menuAnchor
      ? (state.findings.find((finding) => finding.id === state.hoverAnchor?.findingId) ?? null)
      : null;
  // Set only when a finger or pen raised the surface on a squiggled link.
  const menuLink = state?.menuAnchor?.linkHref;
  const hoverLink = state?.hoverAnchor?.linkHref;

  return (
    <ProofingStateContext.Provider value={state}>
      {children}
      {state && state.menuAnchor && menuFinding && (
        <ProofingMenu
          anchor={state.menuAnchor}
          finding={menuFinding}
          colorScheme={colorScheme}
          onOpenLink={
            menuLink
              ? () => {
                  state.closeMenu();
                  onLinkClick?.(menuLink);
                }
              : undefined
          }
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
      {state && state.hoverAnchor && hoverFinding && (
        <ProofingTooltip
          anchor={state.hoverAnchor}
          finding={hoverFinding}
          colorScheme={colorScheme}
          onApply={(index) => {
            state.applySuggestion(hoverFinding.id, index);
            state.closeHover();
          }}
          onIgnore={() => {
            state.ignoreFinding(hoverFinding.id);
            state.closeHover();
          }}
          onAddToAppDictionary={() => {
            state.addToAppDictionary(hoverFinding.id);
            state.closeHover();
          }}
          onAddToDocWordList={() => {
            state.addToDocWordList(hoverFinding.id);
            state.closeHover();
          }}
          canAddToAppDictionary={state.canAddToAppDictionary}
          linkHref={hoverLink}
          onOpenLink={() => {
            state.closeHover();
            if (hoverLink) onLinkClick?.(hoverLink);
          }}
          onMore={(x, y) =>
            state.openMenu({ findingId: hoverFinding.id, x, y, linkHref: hoverLink })
          }
          onHold={state.holdHover}
          onRelease={state.releaseHover}
        />
      )}
    </ProofingStateContext.Provider>
  );
}
