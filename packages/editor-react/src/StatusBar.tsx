/**
 * StatusBar
 *
 * Bottom status bar, showing what belongs to the view on screen. Three
 * groups: the document's statistics and proofing count at the start, the
 * active view's own status and controls in the middle (Slideshow's slide
 * navigation, the Blocks and Timeline views' block navigation — see
 * statusBar/StatusBarViewSlot.tsx), and the parse error plus host status at
 * the end.
 *
 * The middle group is centered in the bar, clear of the rounded corners a
 * phone's screen puts at either end of it. In a Use view that fills it, the
 * document's counts give way: they describe the source text, which is not
 * what is on screen (styles/status-bar.css).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { countBlocks } from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';
import { useProofingState } from './proofing/ProofingContext';
import { useStatusBarViewRegionRef } from './statusBar/statusBarViewTarget';

const STATS_DEBOUNCE_MS = 150;

export interface StatusBarProps {
  /** Additional class name */
  className?: string;
  /** Host-supplied status content rendered at the right edge. */
  slotRight?: ReactNode;
}

/** Whether `region` has content, by the same rule as CSS `:empty` (comments don't count). */
function hasViewContent(region: HTMLElement): boolean {
  return Array.from(region.childNodes).some(
    (node) => node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE,
  );
}

/** `1 line`, `2 lines`: an empty document used to read "1 lines". */
function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * Status bar: document statistics, the active view's status and controls,
 * parse errors, and optional host status.
 */
export function StatusBar({ className, slotRight }: StatusBarProps) {
  const { markdownSource, doc, parseError, activeView } = useEditorContext();
  const proofingState = useProofingState();
  const shareViewRegion = useStatusBarViewRegionRef();
  const barRef = useRef<HTMLDivElement>(null);
  const viewRegion = useRef<HTMLDivElement | null>(null);
  const viewRegionRef = useCallback(
    (element: HTMLDivElement | null) => {
      viewRegion.current = element;
      shareViewRegion?.(element);
    },
    [shareViewRegion],
  );
  const [statsSource, setStatsSource] = useState(markdownSource);

  // The stylesheet lays the bar out around the view region only while a view
  // has portalled content into it, and reads that from `data-view-content`
  // rather than `:has(> .squisq-status-view:not(:empty))`: WebKit (Safari, the
  // iOS app) can miss the portal's children arriving and keep matching the
  // empty region, leaving a phone's playback row pushed off the end of the bar
  // until something else restyles it. Set from the observer, outside React,
  // so it lands before the frame that first paints the content.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const region = viewRegion.current;
    if (!bar || !region) return;
    const sync = () => bar.toggleAttribute('data-view-content', hasViewContent(region));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(region, { childList: true });
    return () => observer.disconnect();
  }, []);

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
    <div
      ref={barRef}
      className={`squisq-status-bar ${className || ''}`}
      data-view-kind={activeView === 'preview' ? 'use' : 'edit'}
    >
      <div className="squisq-status-group squisq-status-doc">
        <span className="squisq-status-item squisq-status-words">
          {countLabel(stats.words, 'word')}
        </span>
        <span className="squisq-status-item squisq-status-chars">
          {countLabel(stats.chars, 'char')}
        </span>
        <span className="squisq-status-item squisq-status-lines">
          {countLabel(stats.lines, 'line')}
        </span>
        <span className="squisq-status-item squisq-status-blocks">
          {countLabel(blocks, 'block')}
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
      </div>
      {/* The active view portals its own status and controls in here. */}
      <div ref={viewRegionRef} className="squisq-status-view" />
      <div className="squisq-status-group squisq-status-end">
        {/* Only a failure earns a parse indicator; a standing "OK" read as a button. */}
        {parseError && (
          <span className="squisq-status-item squisq-status-error" title={parseError}>
            ⚠ Error
          </span>
        )}
        {slotRight}
      </div>
    </div>
  );
}
