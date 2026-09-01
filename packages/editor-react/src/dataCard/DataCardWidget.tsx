/**
 * DataCardWidget — the React surface of the Write-view data card ("the
 * rectangle"): file identity (icon, name, size), shape (`rows × cols`), a
 * tiny table preview, and a "Show in Files" affordance. Read-only; the
 * underlying paragraph (a plain markdown link) stays the source of truth.
 *
 * States: loading skeleton → resolved card; file absent from the media
 * provider → dashed error card; no reader / parse failure (e.g. parquet
 * without the optional peer) → metadata-only card. Never throws into the
 * editor.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { DATA_CARD_KEY } from './DataCardExtension';
import { dataLinkHrefOf } from './DataCardExtension';
import {
  dataExtensionOf,
  loadDataPreview,
  loadDataPreviewCached,
  type DataPreview,
} from './dataPreview';

export interface DataCardWidgetProps {
  editor: Editor;
  blockId: string;
  getMediaProvider: () => MediaProvider | null | undefined;
  getMediaRevision: () => number;
  onOpenFiles?: ((relativePath: string) => void) | undefined;
}

interface CardLink {
  href: string;
  label: string;
}

/** Resolve the claimed paragraph's link, re-reading on every transaction. */
function useCardLink(editor: Editor, blockId: string): CardLink | null {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('transaction', bump);
    return () => {
      editor.off('transaction', bump);
    };
  }, [editor]);

  return useMemo(() => {
    void version;
    const pos = DATA_CARD_KEY.getState(editor.state)?.entries.find((e) => e.id === blockId)?.pos;
    if (pos === undefined) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return null;
    const href = dataLinkHrefOf(node);
    if (!href) return null;
    return { href, label: node.textContent };
  }, [editor, blockId, version]);
}

/** Watch the media revision getter without re-rendering per keystroke. */
function useMediaRevision(getMediaRevision: () => number): number {
  const [revision, setRevision] = useState(() => getMediaRevision());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = getMediaRevision();
      setRevision((prev) => (prev === next ? prev : next));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [getMediaRevision]);
  return revision;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

type CardState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'meta'; size: number | null }
  | { kind: 'ready'; size: number | null; preview: DataPreview };

export function DataCardWidget({
  editor,
  blockId,
  getMediaProvider,
  getMediaRevision,
  onOpenFiles,
}: DataCardWidgetProps): JSX.Element | null {
  const link = useCardLink(editor, blockId);
  const revision = useMediaRevision(getMediaRevision);
  const [state, setState] = useState<CardState>({ kind: 'loading' });

  const href = link?.href ?? null;

  useEffect(() => {
    if (!href) return;
    const provider = getMediaProvider();
    if (!provider) {
      setState({ kind: 'meta', size: null });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      let size: number | null = null;
      try {
        const entries = await provider.listMedia();
        const entry = entries.find((e) => e.name === href);
        if (!entry) {
          if (!cancelled) setState({ kind: 'missing' });
          return;
        }
        size = entry.size;

        const preview = await loadDataPreviewCached(href, revision, async () => {
          const url = await provider.resolveUrl(href);
          // A provider that can't resolve returns the raw relative path;
          // fetching that from a widget context would 404 confusingly.
          if (url === href) return null;
          const response = await fetch(url);
          if (!response.ok) return null;
          const bytes = await response.arrayBuffer();
          return loadDataPreview(bytes, dataExtensionOf(href));
        });

        if (cancelled) return;
        setState(preview ? { kind: 'ready', size, preview } : { kind: 'meta', size });
      } catch {
        if (!cancelled) setState({ kind: 'meta', size });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [href, revision, getMediaProvider]);

  if (!link || !href) return null;
  const fileName = href.split('/').pop() ?? href;

  return (
    <div
      className={`squisq-data-card${state.kind === 'missing' ? ' squisq-data-card--missing' : ''}`}
      data-proof-exempt="true"
    >
      <div className="squisq-data-card-header">
        <span className="squisq-data-card-icon" aria-hidden="true">
          {'\u{1F4CA}'}
        </span>
        <span className="squisq-data-card-name" title={href}>
          {fileName}
        </span>
        <span className="squisq-data-card-meta">
          {state.kind === 'missing' && 'not found in this document’s files'}
          {state.kind === 'loading' && 'loading…'}
          {(state.kind === 'ready' || state.kind === 'meta') && state.size !== null && (
            <>{formatBytes(state.size)}</>
          )}
          {state.kind === 'ready' &&
            state.preview.totalRows !== null &&
            state.preview.totalCols !== null && (
              <>
                {' · '}
                {state.preview.totalRows.toLocaleString()} × {state.preview.totalCols} cells
              </>
            )}
        </span>
        {onOpenFiles && state.kind !== 'missing' && (
          <button
            type="button"
            className="squisq-data-card-action"
            onClick={() => onOpenFiles(href)}
          >
            Show in Files
          </button>
        )}
      </div>
      {state.kind === 'ready' && state.preview.rows.length > 0 && (
        <div className="squisq-data-card-preview">
          <table>
            <thead>
              <tr>
                {state.preview.columns.map((column, i) => (
                  <th key={i}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.preview.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {state.preview.totalRows !== null &&
            state.preview.totalRows > state.preview.rows.length && (
              <div className="squisq-data-card-truncation">
                showing {state.preview.rows.length} of {state.preview.totalRows.toLocaleString()}{' '}
                rows
              </div>
            )}
        </div>
      )}
    </div>
  );
}

export default DataCardWidget;
