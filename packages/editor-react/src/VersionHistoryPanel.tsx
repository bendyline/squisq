/**
 * VersionHistoryPanel
 *
 * Toolbar-anchored popover that lists prior version snapshots and lets
 * the user revert to one. When a snapshot is selected, a Monaco diff
 * view appears to the left of the list comparing the snapshot (original,
 * left) with the current editor content (modified, right).
 *
 * Wraps the toolbar trigger button + popover surface. Versioning state
 * is read from the EditorContext — render this component anywhere inside
 * a provider that has `allowVersioning` and a `container`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { Version } from '@bendyline/squisq/versions';
import { useEditorContext } from './EditorContext';
import { useMonacoLoader } from './useMonacoLoader';

interface LazyDiffEditorProps {
  original: string;
  modified: string;
  theme: 'vs' | 'vs-dark';
}

const lazyLoadingStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  color: 'var(--squisq-editor-muted-foreground, #6a6258)',
  fontSize: 12,
};

/**
 * Defers the `<DiffEditor>` mount until the lazy monaco namespace +
 * `loader.config()` are in place. Without the gate, the
 * `@monaco-editor/react` singleton loader would fall back to its CDN
 * default for any consumer that hasn't already mounted `<RawEditor>`.
 *
 * This wrapper is what makes `useMonacoLoader` worth using here —
 * VersionHistoryPanel itself is always present in the toolbar, so
 * subscribing at its level would defeat the lazy-load. The hook only
 * fires when a snapshot is actually selected.
 */
function LazyDiffEditor({ original, modified, theme }: LazyDiffEditorProps) {
  const { ready } = useMonacoLoader();
  if (!ready) {
    return <div style={lazyLoadingStyle}>Loading diff…</div>;
  }
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language="markdown"
      theme={theme}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        fontSize: 12,
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        overviewRulerLanes: 0,
        renderOverviewRuler: false,
      }}
    />
  );
}

interface PanelState {
  loading: boolean;
  versions: Version[];
  /** The snapshot currently shown in the diff view, with its content. */
  selected: { version: Version; content: string } | null;
  pendingRevert: Version | null;
  error: string | null;
  /** Stamp captured each time the popover opens — labels the synthetic
   *  "Current" row so it reads as a moment in time alongside the
   *  snapshots. */
  currentStamp: Date;
  /** Cached content of the most recent snapshot, used to detect (and
   *  hide) a snapshot that's byte-identical to the current draft so the
   *  synthetic Current row alone represents that state. Compared against
   *  the live `markdownSource` on every render, so the suppressed row
   *  re-appears as soon as the user types. */
  latestSnapshotContent: string | null;
}

const initialState: PanelState = {
  loading: false,
  versions: [],
  selected: null,
  pendingRevert: null,
  error: null,
  currentStamp: new Date(),
  latestSnapshotContent: null,
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function VersionHistoryPanel() {
  const { versioning, replaceAll, markdownSource, theme } = useEditorContext();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>(initialState);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!versioning) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const versions = await versioning.listVersions();
      // Cache the latest snapshot's content so we can hide it when it
      // matches the live draft (the Current row already represents it).
      const latest = versions[0];
      const latestSnapshotContent = latest ? await versioning.readVersion(latest) : null;
      setState((s) => ({ ...s, loading: false, versions, latestSnapshotContent }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list versions';
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, [versioning]);

  // Refresh the list whenever the popover opens.
  useEffect(() => {
    if (open) {
      setState((s) => ({ ...s, currentStamp: new Date() }));
      void refresh();
    } else {
      // Reset transient UI when closing so the next open is clean.
      setState((s) => ({ ...s, selected: null, pendingRevert: null }));
    }
  }, [open, refresh]);

  // Click-outside to close, mirroring the toolbar overflow menu.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback(
    async (version: Version) => {
      if (!versioning) return;
      // Toggle off if this version is already selected.
      if (state.selected?.version.path === version.path) {
        setState((s) => ({ ...s, selected: null }));
        return;
      }
      const content = await versioning.readVersion(version);
      if (content === null) {
        setState((s) => ({ ...s, error: 'Snapshot is no longer available.' }));
        return;
      }
      setState((s) => ({ ...s, selected: { version, content }, error: null }));
    },
    [versioning, state.selected],
  );

  const handleRevertConfirm = useCallback(
    async (version: Version) => {
      if (!versioning) return;
      try {
        const result = await versioning.revertToVersion(version, { snapshotCurrent: true });
        if (!result.reverted) {
          setState((s) => ({ ...s, error: 'Revert failed — snapshot missing.' }));
          return;
        }
        const reverted = await versioning.readVersion(version);
        if (reverted !== null) {
          replaceAll(reverted);
        }
        setState((s) => ({ ...s, pendingRevert: null, selected: null }));
        await refresh();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Revert failed';
        setState((s) => ({ ...s, error: message }));
      }
    },
    [versioning, replaceAll, refresh],
  );

  // Hide the most recent snapshot when its content is byte-identical to
  // the live draft — the Current row already represents that state, and
  // the diff against it would be empty anyway.
  const latestMatchesCurrent =
    state.latestSnapshotContent !== null && state.latestSnapshotContent === markdownSource;
  const visibleVersions = useMemo(
    () => (latestMatchesCurrent ? state.versions.slice(1) : state.versions),
    [state.versions, latestMatchesCurrent],
  );
  const currentSize = useMemo(
    () => new TextEncoder().encode(markdownSource).byteLength,
    [markdownSource],
  );
  const hasDiff = state.selected !== null;
  const diffTheme = theme === 'dark' ? 'vs-dark' : 'vs';

  if (!versioning) return null;

  return (
    <div className="squisq-version-history" ref={containerRef}>
      <button
        type="button"
        className={`squisq-toolbar-button squisq-version-history-trigger${
          open ? ' squisq-toolbar-button--active' : ''
        }`}
        data-tooltip="Version history"
        aria-label="Version history"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
          <polyline points="2.5,2.5 2.5,4.5 4.5,4.5" />
          <polyline points="8,4.5 8,8 11,9.5" />
        </svg>
      </button>
      {open && (
        <div
          className={`squisq-version-history-popover${
            hasDiff ? ' squisq-version-history-popover--with-diff' : ''
          }`}
          role="dialog"
          aria-label="Version history"
        >
          {hasDiff && state.selected && (
            <div className="squisq-version-history-diff">
              <div className="squisq-version-history-diff-header">
                <span className="squisq-version-history-diff-label">
                  <strong>Snapshot</strong> {dateFormatter.format(state.selected.version.timestamp)}
                </span>
                <span className="squisq-version-history-diff-label">
                  <strong>Current</strong>
                </span>
              </div>
              <div className="squisq-version-history-diff-body">
                <LazyDiffEditor
                  original={state.selected.content}
                  modified={markdownSource}
                  theme={diffTheme}
                />
              </div>
            </div>
          )}
          <div className="squisq-version-history-list-pane">
            <div className="squisq-version-history-header">
              <span className="squisq-version-history-title">Version history</span>
            </div>
            {state.error && <div className="squisq-version-history-error">{state.error}</div>}
            {state.loading ? (
              <div className="squisq-version-history-empty">Loading…</div>
            ) : visibleVersions.length === 0 ? (
              <div className="squisq-version-history-empty">
                No versions yet. Versions are saved automatically as you edit.
              </div>
            ) : (
              <ul className="squisq-version-history-list">
                <li
                  className={`squisq-version-history-row squisq-version-history-row--current${
                    state.selected === null ? ' squisq-version-history-row--selected' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="squisq-version-history-row-select"
                    onClick={() => setState((s) => ({ ...s, selected: null }))}
                  >
                    <span className="squisq-version-history-row__time">
                      <strong>Current</strong> &middot; {dateFormatter.format(state.currentStamp)}
                    </span>
                    <span className="squisq-version-history-row__size">
                      {formatBytes(currentSize)}
                    </span>
                  </button>
                </li>
                {visibleVersions.map((v) => {
                  const pending =
                    state.pendingRevert !== null && state.pendingRevert.path === v.path;
                  const selected = state.selected?.version.path === v.path;
                  return (
                    <li
                      key={v.path}
                      className={`squisq-version-history-row${
                        selected ? ' squisq-version-history-row--selected' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="squisq-version-history-row-select"
                        onClick={() => void handleSelect(v)}
                      >
                        <span className="squisq-version-history-row__time">
                          {dateFormatter.format(v.timestamp)}
                        </span>
                        <span className="squisq-version-history-row__size">
                          {formatBytes(v.size)}
                        </span>
                      </button>
                      <span className="squisq-version-history-row__actions">
                        <button
                          type="button"
                          className="squisq-version-history-link"
                          onClick={() => setState((s) => ({ ...s, pendingRevert: v }))}
                        >
                          Revert
                        </button>
                      </span>
                      {pending && (
                        <div className="squisq-version-history-confirm">
                          <span>
                            Revert to this version? Your current draft will be saved as a new
                            snapshot first. Reverting will reset your editor undo state.
                          </span>
                          <span className="squisq-version-history-confirm-actions">
                            <button
                              type="button"
                              className="squisq-version-history-link"
                              onClick={() => setState((s) => ({ ...s, pendingRevert: null }))}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="squisq-version-history-link squisq-version-history-link--primary"
                              onClick={() => handleRevertConfirm(v)}
                            >
                              Revert
                            </button>
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
