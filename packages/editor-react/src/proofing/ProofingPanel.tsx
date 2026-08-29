/**
 * Docked findings pane — a right-side flex sibling of the editor (the
 * MediaBin / ThemeDesignerDock slot), listing the current view's
 * findings in document order with jump-to navigation.
 */

import { useProofingState } from './ProofingContext';

const CATEGORY_LABELS: Record<string, string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  style: 'Style',
};

export function ProofingPanel(): JSX.Element | null {
  const state = useProofingState();
  if (!state || !state.panelVisible || !state.enabled) return null;

  const { findings, activeFindingId } = state;

  return (
    <aside className="squisq-proof-panel" aria-label="Proofing findings">
      <div className="squisq-proof-panel-header">
        <span className="squisq-proof-panel-title">
          Proofing
          <span className="squisq-proof-panel-count">{findings.length}</span>
        </span>
        <span className="squisq-proof-panel-actions">
          <button
            type="button"
            className="squisq-proof-panel-button"
            title="Previous finding"
            aria-label="Previous finding"
            disabled={findings.length === 0}
            onClick={state.prevFinding}
          >
            ↑
          </button>
          <button
            type="button"
            className="squisq-proof-panel-button"
            title="Next finding"
            aria-label="Next finding"
            disabled={findings.length === 0}
            onClick={state.nextFinding}
          >
            ↓
          </button>
          <button
            type="button"
            className="squisq-proof-panel-button"
            title="Close panel"
            aria-label="Close proofing panel"
            onClick={() => state.setPanelVisible(false)}
          >
            ×
          </button>
        </span>
      </div>

      {state.status === 'loading' && (
        <div className="squisq-proof-panel-empty">Loading proofing engine…</div>
      )}
      {state.status === 'error' && (
        <div className="squisq-proof-panel-empty">
          Proofing failed to load.
          <button type="button" className="squisq-proof-panel-retry" onClick={state.retrySetup}>
            Retry
          </button>
        </div>
      )}
      {state.status === 'ready' && findings.length === 0 && (
        <div className="squisq-proof-panel-empty">No issues found.</div>
      )}

      <ul className="squisq-proof-panel-list">
        {findings.map((finding) => (
          <li key={finding.id}>
            <button
              type="button"
              className={
                finding.id === activeFindingId
                  ? 'squisq-proof-panel-row squisq-proof-panel-row--active'
                  : 'squisq-proof-panel-row'
              }
              onClick={() => state.selectFinding(finding.id)}
            >
              <span
                className={`squisq-proof-dot squisq-proof-dot--${finding.category}`}
                title={CATEGORY_LABELS[finding.category] ?? finding.category}
                aria-hidden
              />
              <span className="squisq-proof-panel-row-body">
                <span className="squisq-proof-panel-excerpt">{finding.originalText}</span>
                <span className="squisq-proof-panel-message">{finding.message}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
