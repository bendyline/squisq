/**
 * StatusBar
 *
 * Bottom status bar showing document statistics and host status.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { countBlocks } from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';
import { useProofingState } from './proofing/ProofingContext';

const STATS_DEBOUNCE_MS = 150;

export interface StatusBarProps {
  /** Additional class name */
  className?: string;
  /** Host-supplied status content rendered at the right edge. */
  slotRight?: ReactNode;
}

/**
 * Status bar displaying document statistics: character count, word count,
 * block count, parse errors, and optional host status.
 */
export function StatusBar({ className, slotRight }: StatusBarProps) {
  const { markdownSource, doc, parseError } = useEditorContext();
  const proofingState = useProofingState();
  const [statsSource, setStatsSource] = useState(markdownSource);

  useEffect(() => {
    if (statsSource === markdownSource) return;
    const timeout = setTimeout(() => setStatsSource(markdownSource), STATS_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [markdownSource, statsSource]);

  // Full-document text scans are intentionally idle-debounced so a keypress
  // only schedules cheap work. Block counting is independent and runs only
  // when the debounced parse publishes a new Doc.
  const stats = useMemo(() => {
    const chars = statsSource.length;
    const words = statsSource.trim() ? statsSource.trim().split(/\s+/).length : 0;
    const lines = statsSource.split('\n').length;
    return { chars, words, lines };
  }, [statsSource]);
  const blocks = useMemo(() => (doc ? countBlocks(doc.blocks) : 0), [doc]);

  return (
    <div className={`squisq-status-bar ${className || ''}`}>
      <span className="squisq-status-item">{stats.words} words</span>
      <span className="squisq-status-item">{stats.chars} chars</span>
      <span className="squisq-status-item">{stats.lines} lines</span>
      <span className="squisq-status-item">
        {blocks} {blocks === 1 ? 'block' : 'blocks'}
      </span>
      {proofingState && proofingState.enabled && (
        <button
          type="button"
          className={`squisq-status-item squisq-proof-status${
            proofingState.status === 'error' ? ' squisq-proof-status--error' : ''
          }`}
          title={
            proofingState.status === 'error'
              ? `Proofing failed: ${proofingState.errorMessage ?? 'unknown error'} — click to retry`
              : 'Toggle the proofing panel'
          }
          onClick={() => {
            if (proofingState.status === 'error') proofingState.retrySetup();
            else proofingState.setPanelVisible(!proofingState.panelVisible);
          }}
        >
          {proofingState.status === 'loading' && 'Proofing…'}
          {proofingState.status === 'error' && '⚠ Proofing'}
          {proofingState.status === 'ready' &&
            (proofingState.findings.length > 0
              ? `${proofingState.findings.length} ${
                  proofingState.findings.length === 1 ? 'issue' : 'issues'
                }`
              : '✓ Proofing')}
          {proofingState.status === 'idle' && 'Proofing'}
        </button>
      )}
      <span className="squisq-status-spacer" />
      {parseError && (
        <span className="squisq-status-item squisq-status-error" title={parseError}>
          ⚠ Error
        </span>
      )}
      {!parseError && <span className="squisq-status-item squisq-status-ok">✓ OK</span>}
      {slotRight}
    </div>
  );
}
