/**
 * VersionHistoryPanel
 *
 * Toolbar-anchored popover that lists prior version snapshots and lets
 * the user revert to one. Wraps the toolbar trigger button + popover
 * surface. Versioning state is read from the EditorContext — render this
 * component anywhere inside a provider that has `allowVersioning` and a
 * `container`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Version } from '@bendyline/squisq/versions';
import { useEditorContext } from './EditorContext';

interface PanelState {
  loading: boolean;
  versions: Version[];
  preview: { version: Version; content: string } | null;
  pendingRevert: Version | null;
  error: string | null;
}

const initialState: PanelState = {
  loading: false,
  versions: [],
  preview: null,
  pendingRevert: null,
  error: null,
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
  const { versioning, replaceAll } = useEditorContext();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>(initialState);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!versioning) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const versions = await versioning.listVersions();
      setState((s) => ({ ...s, loading: false, versions }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list versions';
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, [versioning]);

  // Refresh the list whenever the popover opens.
  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      // Reset transient UI when closing so the next open is clean.
      setState((s) => ({ ...s, preview: null, pendingRevert: null }));
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

  const handlePreview = useCallback(
    async (version: Version) => {
      if (!versioning) return;
      const content = await versioning.readVersion(version);
      if (content === null) {
        setState((s) => ({ ...s, error: 'Snapshot is no longer available.' }));
        return;
      }
      setState((s) => ({ ...s, preview: { version, content }, error: null }));
    },
    [versioning],
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
        setState((s) => ({ ...s, pendingRevert: null, preview: null }));
        await refresh();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Revert failed';
        setState((s) => ({ ...s, error: message }));
      }
    },
    [versioning, replaceAll, refresh],
  );

  const visibleVersions = useMemo(() => state.versions, [state.versions]);

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
        <div className="squisq-version-history-popover" role="dialog" aria-label="Version history">
          <div className="squisq-version-history-header">
            <span className="squisq-version-history-title">Version history</span>
          </div>
          {state.error && <div className="squisq-version-history-error">{state.error}</div>}
          {state.preview ? (
            <div className="squisq-version-history-preview-wrap">
              <div className="squisq-version-history-preview-header">
                <span>{dateFormatter.format(state.preview.version.timestamp)}</span>
                <button
                  type="button"
                  className="squisq-version-history-link"
                  onClick={() => setState((s) => ({ ...s, preview: null }))}
                >
                  Close preview
                </button>
              </div>
              <pre className="squisq-version-history-preview">{state.preview.content}</pre>
            </div>
          ) : state.loading ? (
            <div className="squisq-version-history-empty">Loading…</div>
          ) : visibleVersions.length === 0 ? (
            <div className="squisq-version-history-empty">
              No versions yet. Versions are saved automatically as you edit.
            </div>
          ) : (
            <ul className="squisq-version-history-list">
              {visibleVersions.map((v) => {
                const pending = state.pendingRevert !== null && state.pendingRevert.path === v.path;
                return (
                  <li key={v.path} className="squisq-version-history-row">
                    <span className="squisq-version-history-row__time">
                      {dateFormatter.format(v.timestamp)}
                    </span>
                    <span className="squisq-version-history-row__size">{formatBytes(v.size)}</span>
                    <span className="squisq-version-history-row__actions">
                      <button
                        type="button"
                        className="squisq-version-history-link"
                        onClick={() => handlePreview(v)}
                      >
                        Preview
                      </button>
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
                          Revert to this version? Your current draft will be saved as a new snapshot
                          first. Reverting will reset your editor undo state.
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
      )}
    </div>
  );
}
