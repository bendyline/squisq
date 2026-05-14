/**
 * ImageVersionHistoryDropdown
 *
 * Toolbar-anchored popover that lists image-edit version snapshots from
 * the sidecar and lets the user revert to any of them.
 *
 * For each snapshot we render a small thumbnail (rasterized via
 * `exportImageEditDoc` at a thumbnail-sized scale) plus a one-line diff
 * summary describing what changed relative to the *previous* (older)
 * snapshot — e.g. "Resized 4800×920 → 1200×920", "Added text layer",
 * "Removed Background". This makes it possible to identify the right
 * snapshot to revert to without having to revert blindly.
 *
 * Thumbnails and diffs are computed lazily and cached by version path.
 * Loads happen in the background after the popover opens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exportImageEditDoc,
  type ImageEditDoc,
  type ImageEditLayer,
  type ImageEditVersionManager,
} from '@bendyline/squisq/imageEdit';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { Version } from '@bendyline/squisq/versions';

interface Props {
  versioning: ImageEditVersionManager;
  /**
   * Sidecar container backing the snapshots — same one passed to the
   * `<ImageEditor>`. Required for thumbnail rendering since
   * `exportImageEditDoc` reads asset bytes from the container.
   */
  container: ContentContainer;
  /** Called when the user picks a snapshot to load into the editor. */
  onRevert: (version: Version) => void | Promise<void>;
  /**
   * Persistence revision counter. When the host saves a new snapshot
   * (e.g. on flush), bumping this triggers a re-list so the popover
   * stays in sync without polling.
   */
  refreshKey?: number;
}

interface VersionMeta {
  doc: ImageEditDoc;
  thumbUrl: string | null;
}

const THUMB_MAX_DIM = 96;

export function ImageVersionHistoryDropdown({
  versioning,
  container,
  onRevert,
  refreshKey,
}: Props) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyTimestamp, setBusyTimestamp] = useState<number | null>(null);
  // Per-version metadata (doc + thumbnail). Keyed by version.path.
  const [meta, setMeta] = useState<Record<string, VersionMeta>>({});
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Track object URLs so we can revoke them on unmount / cache reset.
  const urlsRef = useRef<Set<string>>(new Set());

  // Re-load the list when the popover opens or when the host bumps refreshKey.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    versioning
      .listVersions()
      .then((list) => {
        if (cancelled) return;
        // Newest first.
        const sorted = [...list].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setVersions(sorted);
      })
      .catch(() => {
        if (cancelled) return;
        setVersions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, versioning, refreshKey]);

  // Lazily load doc + thumbnail for any version we don't have cached yet.
  // We do this sequentially to avoid hammering the canvas pipeline.
  useEffect(() => {
    if (!open) return;
    if (versions.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const v of versions) {
        if (cancelled) return;
        if (meta[v.path]) continue;
        try {
          const doc = await versioning.readVersion(v);
          if (cancelled) return;
          if (!doc) {
            setMeta((m) => ({ ...m, [v.path]: { doc: emptyDoc(), thumbUrl: null } }));
            continue;
          }
          let thumbUrl: string | null = null;
          try {
            const scale = computeThumbScale(doc.canvas.width, doc.canvas.height);
            const blob = await exportImageEditDoc(doc, container, {
              format: 'png',
              scale,
            });
            if (cancelled) return;
            thumbUrl = URL.createObjectURL(blob);
            urlsRef.current.add(thumbUrl);
          } catch {
            // Best-effort thumbnail — fall back to a placeholder.
            thumbUrl = null;
          }
          setMeta((m) => ({ ...m, [v.path]: { doc, thumbUrl } }));
        } catch {
          // Skip on read error; the row will render without a thumb.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, versions, versioning, container, meta]);

  // Revoke object URLs on unmount.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // When refreshKey changes, blow away the cache so newly-saved
  // snapshots are re-thumbnailed (and old thumbs aren't stale).
  useEffect(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    setMeta({});
  }, [refreshKey]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleRevert = useCallback(
    async (v: Version) => {
      setBusyTimestamp(v.timestamp.getTime());
      try {
        await onRevert(v);
        setOpen(false);
      } catch (err: unknown) {
        console.warn(
          '[squisq-editor] image-edit revert failed:',
          err instanceof Error ? err.message : err,
        );
      } finally {
        setBusyTimestamp(null);
      }
    },
    [onRevert],
  );

  return (
    <div className="squisq-image-editor-version-dropdown">
      <button
        ref={triggerRef}
        type="button"
        className="squisq-image-editor-tool-button squisq-image-editor-tool-button--with-label"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Version history"
        data-testid="image-editor-history-trigger"
      >
        <span>History</span>
        <span aria-hidden="true" style={{ fontSize: '0.8em' }}>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="squisq-image-editor-version-popover"
          role="menu"
          data-testid="image-editor-history-popover"
        >
          <div className="squisq-image-editor-version-popover__title">Version history</div>
          {loading && <div className="squisq-image-editor-version-popover__empty">Loading…</div>}
          {!loading && versions.length === 0 && (
            <div className="squisq-image-editor-version-popover__empty">No snapshots yet</div>
          )}
          {!loading && versions.length > 0 && (
            <ul className="squisq-image-editor-version-popover__list">
              {versions.map((v, i) => {
                const ts = v.timestamp.getTime();
                const m = meta[v.path];
                const isCurrent = i === 0;
                const isOriginal = i + 1 >= versions.length;
                // Diff is computed against the *next* (older) version in
                // the newest-first list. The oldest snapshot has no
                // older neighbor, so we label it "Original".
                const olderMeta = i + 1 < versions.length ? meta[versions[i + 1]!.path] : undefined;
                const summary = isOriginal
                  ? 'Original'
                  : m && olderMeta
                    ? summarizeDiff(olderMeta.doc, m.doc)
                    : '';
                return (
                  <li
                    key={ts}
                    className={
                      'squisq-image-editor-version-popover__row' +
                      (isCurrent ? ' squisq-image-editor-version-popover__row--current' : '')
                    }
                  >
                    <div className="squisq-image-editor-version-popover__thumb">
                      {m?.thumbUrl ? (
                        <img
                          src={m.thumbUrl}
                          alt=""
                          className="squisq-image-editor-version-popover__thumb-img"
                        />
                      ) : (
                        <div
                          className="squisq-image-editor-version-popover__thumb-placeholder"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="squisq-image-editor-version-popover__info">
                      <div className="squisq-image-editor-version-popover__when">
                        {isCurrent && (
                          <span className="squisq-image-editor-version-popover__badge">
                            Current
                          </span>
                        )}
                        {formatTimestamp(v.timestamp)}
                      </div>
                      <div className="squisq-image-editor-version-popover__summary" title={summary}>
                        {summary || (m ? '' : 'Loading…')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="squisq-image-editor-tool-button"
                      onClick={() => handleRevert(v)}
                      disabled={isCurrent || busyTimestamp === ts}
                      title={isCurrent ? 'This is the current version' : 'Revert to this version'}
                    >
                      {busyTimestamp === ts ? 'Loading…' : 'Revert'}
                    </button>
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

/**
 * Pick a `scale` factor for `exportImageEditDoc` so the rendered
 * thumbnail's longest side is at most `THUMB_MAX_DIM` pixels. Always
 * ≤1 to avoid up-rendering small canvases.
 */
function computeThumbScale(width: number, height: number): number {
  const longest = Math.max(width, height);
  if (longest <= THUMB_MAX_DIM) return 1;
  return THUMB_MAX_DIM / longest;
}

/**
 * Convert a Date to a human-readable local time.
 */
function formatTimestamp(stamp: Date): string {
  if (Number.isNaN(stamp.getTime())) return String(stamp);
  return stamp.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Build a one-line, human-readable summary of what changed between
 * two snapshots. Reports (in priority order):
 *
 *   1. Canvas size change      — "Resized 4800×920 → 1200×920"
 *   2. Layer additions/removals — "Added text", "Removed Background"
 *   3. Per-layer position/size  — "Moved Text", "Resized Image"
 *   4. Per-layer content/style  — "Edited Text"
 *
 * Returns "No changes" if the two docs are byte-equivalent in the
 * fields we compare.
 */
function summarizeDiff(prev: ImageEditDoc, next: ImageEditDoc): string {
  const parts: string[] = [];

  // 1. Canvas size.
  if (prev.canvas.width !== next.canvas.width || prev.canvas.height !== next.canvas.height) {
    parts.push(
      `Resized ${prev.canvas.width}×${prev.canvas.height} → ${next.canvas.width}×${next.canvas.height}`,
    );
  } else if (prev.canvas.background !== next.canvas.background) {
    parts.push('Changed background');
  }

  // 2. Layer add / remove (by id).
  const prevIds = new Set(prev.layers.map((l) => l.id));
  const nextIds = new Set(next.layers.map((l) => l.id));
  const added = next.layers.filter((l) => !prevIds.has(l.id));
  const removed = prev.layers.filter((l) => !nextIds.has(l.id));
  for (const l of added) parts.push(`Added ${describeLayer(l)}`);
  for (const l of removed) parts.push(`Removed ${describeLayer(l)}`);

  // 3 & 4. Per-layer changes for layers present in both.
  for (const n of next.layers) {
    const p = prev.layers.find((l) => l.id === n.id);
    if (!p) continue;
    const change = describeLayerChange(p, n);
    if (change) parts.push(change);
  }

  if (parts.length === 0) return 'No changes';
  // Cap to a sane length — the popover row is one line.
  return parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ` (+${parts.length - 3})` : '');
}

function describeLayer(layer: ImageEditLayer): string {
  const name = layer.name?.trim();
  return name && name.length > 0 ? `“${name}”` : layer.type;
}

function describeLayerChange(p: ImageEditLayer, n: ImageEditLayer): string | null {
  const label = describeLayer(n);
  const posChanged =
    p.position.x !== n.position.x ||
    p.position.y !== n.position.y ||
    p.position.width !== n.position.width ||
    p.position.height !== n.position.height;
  const sizeChanged =
    p.position.width !== n.position.width || p.position.height !== n.position.height;
  // Treat content + style as a single "edited" bucket.
  const contentChanged = JSON.stringify(p.content) !== JSON.stringify(n.content);

  if (sizeChanged && !contentChanged) return `Resized ${label}`;
  if (posChanged && !contentChanged) return `Moved ${label}`;
  if (contentChanged) return `Edited ${label}`;
  return null;
}

/**
 * Fallback used when a snapshot fails to load — keeps render code
 * branch-free without polluting the diff summary with errors.
 */
function emptyDoc(): ImageEditDoc {
  return {
    version: 1,
    canvas: { width: 0, height: 0, background: 'transparent' },
    layers: [],
  };
}
