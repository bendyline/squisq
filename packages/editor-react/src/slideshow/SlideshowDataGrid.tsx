/**
 * Interactive slideshow adapter for data-table sidecars.
 *
 * The canonical player Doc intentionally carries only a bounded preview so
 * PPTX/video/static renderers stay deterministic and memory-bounded. In the
 * editor's interactive Slideshow view, the visible table layer can instead
 * resolve the original sidecar and mount the real virtualized DataGrid. This
 * keeps the package boundary clean: squisq-react owns a renderer seam, while
 * editor-react (which already depends on formats + grid-react) owns file
 * ingestion and worker lifetime.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import { parseTableViewState, type TableViewState } from '@bendyline/squisq/table';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { DataGrid, TableStoreClient, type IngestTable } from '@bendyline/squisq-grid-react';
import type { TableLayerContentRendererProps } from '@bendyline/squisq-react';
import { ingestSidecarBytes } from '../dataCard/ingestAdapters';
import { collectSlideshowDataSources, type SlideshowDataSource } from './slideshowDataSources';

interface SlideshowDataGridContextValue {
  container: ContentContainer | null;
  mediaRevision: number;
  sources: ReadonlyMap<string, SlideshowDataSource>;
}

const EMPTY_CONTEXT: SlideshowDataGridContextValue = {
  container: null,
  mediaRevision: 0,
  sources: new Map(),
};

const SlideshowDataGridContext = createContext<SlideshowDataGridContextValue>(EMPTY_CONTEXT);

interface SlideshowDataGridProviderProps {
  doc: Doc | null;
  container?: ContentContainer | null;
  mediaRevision: number;
  children: ReactNode;
}

export function SlideshowDataGridProvider({
  doc,
  container,
  mediaRevision,
  children,
}: SlideshowDataGridProviderProps) {
  const sources = useMemo(() => collectSlideshowDataSources(doc), [doc]);
  const value = useMemo(
    () => ({ container: container ?? null, mediaRevision, sources }),
    [container, mediaRevision, sources],
  );
  return (
    <SlideshowDataGridContext.Provider value={value}>{children}</SlideshowDataGridContext.Provider>
  );
}

type RemoteGridState =
  | { key: string; status: 'idle' | 'loading' }
  | {
      key: string;
      status: 'ready';
      provider: TableStoreClient;
      ingest: IngestTable;
      initialView: TableViewState;
    }
  | { key: string; status: 'error' };

const EMPTY_VIEW: TableViewState = { sort: [], filter: [] };

function sourceKey(source: SlideshowDataSource | undefined): string {
  if (!source) return '';
  return [
    source.blockId,
    source.src,
    source.sheet ?? '',
    source.anchor ?? '',
    String(source.headerRow ?? ''),
    source.sort ?? '',
    source.filter ?? '',
  ].join('\u0000');
}

function columnWidthsFor(ingest: IngestTable, availableWidth: number, fontSize: number): number[] {
  if (ingest.headers.length === 0) return [];
  const widths = ingest.headers.map((header, col) => {
    let chars = header.length;
    for (const row of ingest.cells.slice(0, 100)) {
      chars = Math.max(chars, String(row[col] ?? '').length);
    }
    // A few high-cardinality prose cells should make their column useful,
    // without forcing the neighboring identifier/date columns off-screen.
    return Math.max(fontSize * 4.5, Math.min(chars, 38) * fontSize * 0.58 + fontSize * 1.5);
  });
  const total = widths.reduce((sum, value) => sum + value, 0);
  if (total >= availableWidth) return widths;
  const bonus = (availableWidth - total) / widths.length;
  return widths.map((value) => value + bonus);
}

function sourceForBlock(
  sources: ReadonlyMap<string, SlideshowDataSource>,
  block: Block,
): SlideshowDataSource | undefined {
  const sourceBlockId = (block as Block & { sourceBlockId?: string }).sourceBlockId;
  return sources.get(block.id) ?? (sourceBlockId ? sources.get(sourceBlockId) : undefined);
}

/** The TableLayer renderer mounted only for interactive Slideshow surfaces. */
export function SlideshowDataGridRenderer({
  block,
  layer,
  width,
  height,
  fallback,
}: TableLayerContentRendererProps) {
  const { container, mediaRevision, sources } = useContext(SlideshowDataGridContext);
  const source = sourceForBlock(sources, block);
  const activeSourceKey = sourceKey(source);
  const [remote, setRemote] = useState<RemoteGridState>({ key: '', status: 'idle' });

  useEffect(() => {
    if (!container || !source) {
      setRemote({ key: activeSourceKey, status: 'idle' });
      return;
    }

    let cancelled = false;
    let ownedProvider: TableStoreClient | null = null;
    setRemote({ key: activeSourceKey, status: 'loading' });

    void (async () => {
      try {
        const bytes = await container.readFile(source.src);
        if (!bytes) throw new Error('data sidecar not found');
        const { ingest } = await ingestSidecarBytes(bytes, source.ext, {
          ...(source.sheet ? { sheet: source.sheet } : {}),
          ...(source.anchor ? { anchor: source.anchor } : {}),
          ...(source.headerRow !== undefined ? { headerRow: source.headerRow } : {}),
        });
        const provider = new TableStoreClient(ingest);
        ownedProvider = provider;
        await provider.describe();
        if (cancelled) {
          provider.dispose();
          ownedProvider = null;
          return;
        }
        const initialView = parseTableViewState(source.sort, source.filter, ingest.headers).view;
        setRemote({ key: activeSourceKey, status: 'ready', provider, ingest, initialView });
      } catch {
        if (!cancelled) setRemote({ key: activeSourceKey, status: 'error' });
      }
    })();

    return () => {
      cancelled = true;
      ownedProvider?.dispose();
    };
    // The serialized key is the stable identity of the source descriptor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceKey, container, mediaRevision]);

  const currentRemote = remote.key === activeSourceKey ? remote : undefined;
  const previewRows = useMemo(
    () => (Array.isArray(layer.content.rows) ? layer.content.rows : []),
    [layer.content.rows],
  );
  const previewHeaders = useMemo(
    () => (Array.isArray(layer.content.headers) ? layer.content.headers : []),
    [layer.content.headers],
  );
  const useLocalGrid =
    (!source || currentRemote?.status === 'error') &&
    previewRows.length > (layer.content.maxVisibleRows ?? 10);
  const localProvider = useMemo(
    () =>
      useLocalGrid ? new TableStoreClient({ headers: previewHeaders, cells: previewRows }) : null,
    [previewHeaders, previewRows, useLocalGrid],
  );
  useEffect(() => () => localProvider?.dispose(), [localProvider]);

  const ready = currentRemote?.status === 'ready' ? currentRemote : undefined;
  const provider = ready?.provider ?? localProvider;
  const ingest =
    ready?.ingest ?? (localProvider ? { headers: previewHeaders, cells: previewRows } : undefined);
  const initialView = ready?.initialView ?? EMPTY_VIEW;
  const [view, setView] = useState<TableViewState>(initialView);
  useEffect(() => setView(initialView), [initialView, provider]);

  if (!provider || !ingest) return <>{fallback}</>;

  const { style } = layer.content;
  const rowHeight = Math.max(32, style.fontSize * 2.1);
  const footerHeight = Math.max(28, style.fontSize * 1.5);
  const scrollerHeight = Math.max(rowHeight * 2, height - footerHeight);
  const widths = columnWidthsFor(ingest, width - 2, style.fontSize);
  const gridStyle = {
    width: `${width}px`,
    height: `${height}px`,
    fontFamily: style.fontFamily ?? 'system-ui, sans-serif',
    '--squisq-grid-font-size': `${style.fontSize}px`,
    '--squisq-grid-header-font-family':
      style.headerFontFamily ?? style.fontFamily ?? 'system-ui, sans-serif',
    '--squisq-grid-footer-font-size': `${style.fontSize * 0.6}px`,
    '--squisq-grid-bg': style.cellBackground,
    '--squisq-grid-text': style.cellColor,
    '--squisq-grid-text-muted': style.cellColor,
    '--squisq-grid-text-on-accent': style.headerColor,
    '--squisq-grid-border': style.borderColor,
    '--squisq-grid-border-subtle': style.borderColor,
    '--squisq-grid-header-bg': style.headerBackground,
    '--squisq-grid-header-text': style.headerColor,
    '--squisq-grid-input-bg': style.cellBackground,
    '--squisq-grid-row-hover': `color-mix(in srgb, ${style.headerBackground} 12%, ${style.cellBackground})`,
    '--squisq-grid-selection-bg': `color-mix(in srgb, ${style.headerBackground} 22%, ${style.cellBackground})`,
    '--squisq-grid-selection-border': style.headerBackground,
    '--squisq-grid-focus-ring': style.headerBackground,
    '--squisq-grid-accent': style.headerBackground,
    '--squisq-grid-resize-handle': style.headerBackground,
  } as CSSProperties;

  return (
    <div className="squisq-slideshow-data-grid" style={gridStyle}>
      <DataGrid
        provider={provider}
        view={view}
        onViewChange={setView}
        height={scrollerHeight}
        rowHeight={rowHeight}
        showFilters={false}
        defaultColumnWidths={widths}
      />
    </div>
  );
}
