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
    const words = markdownSource.trim()
      ? markdownSource.trim().split(/\s+/).length
      : 0;
    const lines = markdownSource.split('\n').length;
    const blocks = doc?.blocks.length ?? 0;
    return { chars, words, lines, blocks };
  }, [markdownSource, doc]);

  return (
    <div className={`prodcore-status-bar ${className || ''}`}>
      <span className="prodcore-status-item">
        {stats.words} words
      </span>
      <span className="prodcore-status-item">
        {stats.chars} chars
      </span>
      <span className="prodcore-status-item">
        {stats.lines} lines
      </span>
      <span className="prodcore-status-item">
        {stats.blocks} blocks
      </span>
      <span className="prodcore-status-spacer" />
      {isParsing && (
        <span className="prodcore-status-item prodcore-status-parsing">
          Parsing…
        </span>
      )}
      {parseError && (
        <span className="prodcore-status-item prodcore-status-error" title={parseError}>
          ⚠ Error
        </span>
      )}
      {!isParsing && !parseError && (
        <span className="prodcore-status-item prodcore-status-ok">
          ✓ OK
        </span>
      )}
    </div>
  );
}
