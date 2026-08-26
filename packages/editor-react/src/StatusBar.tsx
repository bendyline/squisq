/**
 * StatusBar
 *
 * Bottom status bar showing document statistics and host status.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { countBlocks } from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';

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
