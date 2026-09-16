/**
 * Docked review pane — a right-side flex sibling of the editor, listing every
 * provider's findings grouped by provider.
 *
 * Grouped rather than merged into one document-ordered list, because the
 * providers are answering different questions. A spelling mistake and "this
 * section buries its point" interleaved by position reads as noise; under their
 * own headings each list is scannable.
 */

import { useReviewState } from './ReviewContext.js';
import type { ReviewFinding } from '@bendyline/squisq/review';
import type { ReactElement } from 'react';
import type { ReviewProviderStatus } from './runner.js';

export function ReviewPanel(): ReactElement | null {
  const state = useReviewState();
  if (!state || state.providers.length === 0) return null;

  const total = state.findings.length;

  return (
    <aside className="squisq-review-panel" aria-label="Review findings">
      <div className="squisq-review-panel-header">
        <span className="squisq-review-panel-title">
          Review
          <span className="squisq-review-panel-count">{total}</span>
        </span>
        <button
          type="button"
          className="squisq-review-panel-button"
          onClick={state.reviewNow}
          disabled={state.running}
        >
          {state.running ? 'Reviewing…' : 'Review now'}
        </button>
      </div>

      {state.providers.map((provider) => (
        <ProviderGroup key={provider.id} provider={provider} state={state} />
      ))}
    </aside>
  );
}

function ProviderGroup({
  provider,
  state,
}: {
  provider: ReviewProviderStatus;
  state: NonNullable<ReturnType<typeof useReviewState>>;
}): ReactElement {
  return (
    <section className="squisq-review-panel-group">
      <h3 className="squisq-review-panel-group-title">{provider.label}</h3>

      {provider.phase === 'preparing' && (
        <div className="squisq-review-panel-empty">Preparing…</div>
      )}
      {provider.phase === 'running' && <div className="squisq-review-panel-empty">Reviewing…</div>}
      {provider.phase === 'error' && (
        // The provider's own message, verbatim: a reviewer that cannot reach
        // its model and one whose engine is missing need different fixes.
        <div className="squisq-review-panel-empty" role="status">
          {provider.error ?? 'Review failed.'}
        </div>
      )}
      {provider.phase === 'ready' && provider.findings.length === 0 && (
        <div className="squisq-review-panel-empty">Nothing to report.</div>
      )}

      <ul className="squisq-review-panel-list">
        {provider.findings.map((finding) => (
          <li key={finding.id}>
            <Row finding={finding} onGo={state.goToFinding} onDismiss={state.dismissFinding} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({
  finding,
  onGo,
  onDismiss,
}: {
  finding: ReviewFinding;
  onGo: (id: string) => void;
  onDismiss: (id: string) => void;
}): ReactElement {
  return (
    <div className="squisq-review-panel-row">
      <button
        type="button"
        className="squisq-review-panel-row-main"
        onClick={() => onGo(finding.id)}
      >
        <span
          className={`squisq-review-dot squisq-review-dot--${finding.severity}`}
          // Severity is conveyed by the text below as well as the colour, so a
          // reader who cannot distinguish the dots loses nothing.
          aria-hidden
        />
        <span className="squisq-review-panel-row-body">
          <span className="squisq-review-panel-excerpt">{finding.originalText}</span>
          <span className="squisq-review-panel-message">{finding.message}</span>
          {finding.rationale && (
            <span className="squisq-review-panel-rationale">{finding.rationale}</span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="squisq-review-panel-button"
        title="Dismiss"
        aria-label={`Dismiss: ${finding.message}`}
        onClick={() => onDismiss(finding.id)}
      >
        ×
      </button>
    </div>
  );
}
