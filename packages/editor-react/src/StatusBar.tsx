/**
 * StatusBar
 *
 * Bottom status bar showing document statistics and host status.
 */

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { countBlocks } from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';

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
  const { markdownSource, doc, parseError, isParsing } = useEditorContext();

  const stats = useMemo(() => {
    const chars = markdownSource.length;
    const words = markdownSource.trim() ? markdownSource.trim().split(/\s+/).length : 0;
    const lines = markdownSource.split('\n').length;
    const blocks = doc ? countBlocks(doc.blocks) : 0;
    return { chars, words, lines, blocks };
  }, [markdownSource, doc]);

  return (
    <div className={`squisq-status-bar ${className || ''}`}>
      <span className="squisq-status-item">{stats.words} words</span>
      <span className="squisq-status-item">{stats.chars} chars</span>
      <span className="squisq-status-item">{stats.lines} lines</span>
      <span className="squisq-status-item">
        {stats.blocks} {stats.blocks === 1 ? 'block' : 'blocks'}
      </span>
      <span className="squisq-status-spacer" />
      {parseError && (
        <span className="squisq-status-item squisq-status-error" title={parseError}>
          ⚠ Error
        </span>
      )}
      {!isParsing && !parseError && (
        <span className="squisq-status-item squisq-status-ok">✓ OK</span>
      )}
      {slotRight}
    </div>
  );
}
