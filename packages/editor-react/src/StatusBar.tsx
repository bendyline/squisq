/**
 * StatusBar
 *
 * Bottom status bar showing document statistics and parse status.
 */

import { useMemo } from 'react';
import { useEditorContext } from './EditorContext';

export interface StatusBarProps {
  /** Additional class name */
  className?: string;
}

/**
 * Status bar displaying document statistics: character count, word count,
 * block count, and parse/error status.
 */
export function StatusBar({ className }: StatusBarProps) {
  const { markdownSource, doc, parseError, isParsing } = useEditorContext();

  const stats = useMemo(() => {
    const chars = markdownSource.length;
    const words = markdownSource.trim() ? markdownSource.trim().split(/\s+/).length : 0;
    const lines = markdownSource.split('\n').length;
    const blocks = doc?.blocks.length ?? 0;
    return { chars, words, lines, blocks };
  }, [markdownSource, doc]);

  return (
    <div className={`squisq-status-bar ${className || ''}`}>
      <span className="squisq-status-item">{stats.words} words</span>
      <span className="squisq-status-item">{stats.chars} chars</span>
      <span className="squisq-status-item">{stats.lines} lines</span>
      <span className="squisq-status-item">{stats.blocks} blocks</span>
      <span className="squisq-status-spacer" />
      {isParsing && <span className="squisq-status-item squisq-status-parsing">Parsing…</span>}
      {parseError && (
        <span className="squisq-status-item squisq-status-error" title={parseError}>
          ⚠ Error
        </span>
      )}
      {!isParsing && !parseError && (
        <span className="squisq-status-item squisq-status-ok">✓ OK</span>
      )}
    </div>
  );
}
