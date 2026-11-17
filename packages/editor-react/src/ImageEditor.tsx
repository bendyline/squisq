/**
 * ImageEditor — top-level shell that wires together the toolbar,
 * canvas surface, layers panel, and properties panel against an
 * `ImageEditDoc` persisted in a sidecar `ContentContainer`.
 *
 * Hosts pass an already-scoped container (typically built with
 * `scopeContainer(parent, basename + '_files')`). On first mount, if
 * the sidecar has no `state.json`, the editor seeds it from
 * `initialSrc` — the source bytes are copied to `assets/source.<ext>`
 * so the doc is portable and round-trips through ZIP serialization.
 *
 * The export pipeline is `state.json` → SVG → raster blob via
 * `exportImageEditDoc` from `@bendyline/squisq/imageEdit`.
 */

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { exportImageEditDoc, type ImageEditExportFormat } from '@bendyline/squisq/imageEdit';
import type { ImageEditDoc, SurfaceScheme, Theme } from '@bendyline/squisq/schemas';
import { CanvasSurface } from './imageEditor/CanvasSurface.js';
import { ImageVersionHistoryDropdown } from './imageEditor/ImageVersionHistoryDropdown.js';
import { LayersPanel, type AddableLayerKind } from './imageEditor/LayersPanel.js';
import { PropertiesPanel } from './imageEditor/PropertiesPanel.js';
import { SidePanelDrawer } from './imageEditor/SidePanelDrawer.js';
import { Toolbar } from './imageEditor/Toolbar.js';
import { useImageEditor } from './imageEditor/useImageEditor.js';
import { useImageEditorTokens } from './imageEditor/useImageEditorTokens.js';
import {
  createShapeLayer,
  createLinearShapeLayer,
  isLinearShapeKind,
} from './imageEditor/createShapeLayer.js';

const ZOOM_STEPS = [0.0625, 0.083, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 8, 16];

export interface ImageEditorProps {
  /**
   * Scoped sidecar container for this image — typically
   * `scopeContainer(parent, basename + '_files')`.
   */
  filesContainer: ContentContainer;
  /**
   * Source URL used to seed `assets/source.<ext>` and layer 0 the
   * first time the sidecar is opened. Ignored once `state.json` exists.
   */
  initialSrc?: string;
  /** Override the state filename. Default: `state.json`. */
  stateFilename?: string;
  /** Enable version-history snapshots in `.versions/`. Default: `false`. */
  allowVersioning?: boolean;
  /** Auto-save idle delay (ms) for version snapshots. Default: `5000`. */
  versioningAutoSaveIdleMs?: number;
  /**
   * Called after the user clicks Export and the blob is produced. `doc` is
   * the layer state the blob was rendered from. A returned promise is
   * awaited: the Save button stays busy until it settles, and a rejection
   * is shown to the user as a failed save.
   */
  onExport?: (blob: Blob, format: ImageEditExportFormat, doc: ImageEditDoc) => void | Promise<void>;
  /**
   * What the toolbar's Save button does:
   *  - `'flush'` (default): write `state.json` to the sidecar.
   *  - `'export'`: rasterize the canvas in `saveFormat` and fire
   *    {@link onExport} — the same code path the Export menu uses.
   *    Hosts that want one-click "save and close" semantics use this.
   */
  saveBehavior?: 'flush' | 'export';
  /** Format used when `saveBehavior === 'export'`. Default: `'png'`. */
  saveFormat?: ImageEditExportFormat;
  /** Override the Save button label. Default: `'Save'`. */
  saveLabel?: string;
  /** Override the Save button tooltip. */
  saveTitle?: string;
  /**
   * Squisq Theme to color the editor chrome (toolbar, panels, controls).
   * Defaults to `DEFAULT_THEME`. Combined with {@link surface} the same
   * way `<JsonView>` and `<LinearDocView>` do.
   */
  theme?: Theme;
  /**
   * Surface scheme — `LIGHT_SURFACE`, `DARK_SURFACE`, an explicit
   * `SurfaceScheme` object, or `'auto'` to track the user's OS
   * `prefers-color-scheme`. When omitted, the theme's own background is
   * used as-is.
   */
  surface?: SurfaceScheme | 'auto';
  /** Optional className for the root element. */
  className?: string;
}

/** Imperative handle for hosts that run the save pipeline themselves (e.g. on close). */
export interface ImageEditorHandle {
  /** The current layer state, or null while the editor is still loading. */
  getDoc(): ImageEditDoc | null;
  /**
   * Run the toolbar Save action. With `saveBehavior: 'export'` this
   * flushes, rasterizes, and awaits `onExport`; resolves false when any
   * step failed (the editor shows the error).
   */
  save(): Promise<boolean>;
}

export const ImageEditor = forwardRef<ImageEditorHandle, ImageEditorProps>(
  function ImageEditor(props, ref) {
    const {
      filesContainer,
      initialSrc,
      stateFilename,
      allowVersioning,
      versioningAutoSaveIdleMs,
      onExport,
      saveBehavior = 'flush',
      saveFormat = 'png',
      saveLabel,
      saveTitle,
      theme,
      surface,
      className,
    } = props;

    const tokens = useImageEditorTokens(theme, surface);

    const { state, dispatch, flush, resolveAssetUrl, uploadAsset, versioning, ready, error } =
      useImageEditor({
        container: filesContainer,
        initialSrc,
        stateFilename,
        allowVersioning,
        versioningAutoSaveIdleMs,
      });

    // Bumped after every save/version write so the history popover
    // re-lists without polling.
    const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

    const surfaceRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [zoom, setZoom] = useState(1.0);

    const handleZoomIn = useCallback(() => {
      setZoom((z) => ZOOM_STEPS.find((s) => s > z + 0.001) ?? 16);
    }, []);
    const handleZoomOut = useCallback(() => {
      setZoom((z) => [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? 0.0625);
    }, []);
    const handleZoomSet = useCallback((z: number) => {
      setZoom(Math.max(0.0625, Math.min(16, z)));
    }, []);
    const handleZoom1to1 = useCallback(() => setZoom(1), []);
    const handleZoomFit = useCallback(() => {
      if (!state || !surfaceRef.current) return;
      const { clientWidth, clientHeight } = surfaceRef.current;
      const PADDING = 32;
      const fitZ = Math.min(
        (clientWidth - PADDING) / state.doc.canvas.width,
        (clientHeight - PADDING) / state.doc.canvas.height,
      );
      setZoom(Math.max(0.0625, Math.min(16, fitZ)));
    }, [state]);

    // ID of a newly-created text layer that should immediately enter inline editing.
    const [requestEditLayerId, setRequestEditLayerId] = useState<string | null>(null);

    // A save on a phone-sized photo takes a noticeable moment (rasterize,
    // encode, write). Show it, and show failures instead of leaving the user
    // to guess why the picture did not change.
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const handleExport = useCallback(
      async (format: ImageEditExportFormat): Promise<boolean> => {
        if (!state) return false;
        const doc = state.doc;
        setSaveError(null);
        setSaving(true);
        try {
          const blob = await exportImageEditDoc(doc, filesContainer, { format });
          if (onExport) {
            await onExport(blob, format, doc);
          } else {
            // Default behavior: trigger a browser download.
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `image.${format === 'jpeg' ? 'jpg' : format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
          return true;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('[squisq-editor] image export failed:', message);
          setSaveError(message);
          return false;
        } finally {
          setSaving(false);
        }
      },
      [state, filesContainer, onExport],
    );

    /**
     * Save-and-close pipeline. Critical: we must `await flush()` *before*
     * triggering the export, otherwise the parent modal may close (via the
     * `onExport` chain) before the debounced state.json write fires —
     * losing any layer/edit changes since the last debounce. We also save
     * a version snapshot so the history dropdown captures the moment of
     * save and the user can revert later.
     */
    const handleSaveAndClose = useCallback(async (): Promise<boolean> => {
      try {
        await flush();
        if (versioning) {
          try {
            await versioning.saveVersion();
            setHistoryRefreshKey((k) => k + 1);
          } catch (err: unknown) {
            console.warn(
              '[squisq-editor] image-edit save-version failed:',
              err instanceof Error ? err.message : err,
            );
          }
        }
        return await handleExport(saveFormat);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[squisq-editor] image-edit save-and-close failed:', message);
        setSaveError(message);
        return false;
      }
    }, [flush, versioning, handleExport, saveFormat]);

    const docRef = useRef<ImageEditDoc | null>(null);
    docRef.current = state?.doc ?? null;
    const saveRef = useRef<() => Promise<boolean>>(async () => false);
    saveRef.current =
      saveBehavior === 'export'
        ? handleSaveAndClose
        : async () => {
            try {
              await flush();
              return true;
            } catch {
              return false;
            }
          };
    // A host-triggered save (e.g. closing) that lands while the toolbar's save
    // is still running joins it instead of writing the picture twice.
    const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
    const runSave = useCallback((): Promise<boolean> => {
      if (!inFlightSaveRef.current) {
        inFlightSaveRef.current = saveRef.current().finally(() => {
          inFlightSaveRef.current = null;
        });
      }
      return inFlightSaveRef.current;
    }, []);
    useImperativeHandle(
      ref,
      () => ({
        getDoc: () => docRef.current,
        save: runSave,
      }),
      [runSave],
    );

    /**
     * Revert `state.json` (and the in-memory editor state) to a prior
     * snapshot. We delegate to `versioning.revertToVersion` so the
     * sidecar write happens through the same code path as direct API
     * use, including a snapshot of the *current* state before overwrite
     * — that way the user can undo a revert via the same dropdown.
     */
    const handleRevertToVersion = useCallback(
      async (version: import('@bendyline/squisq/versions').Version) => {
        if (!versioning) return;
        // Cancel any pending debounced write so it can't clobber the
        // reverted state.json after we replace it.
        try {
          await flush();
        } catch {
          /* swallow — best effort */
        }
        const result = await versioning.revertToVersion(version);
        if (!result.reverted) return;
        const doc = await versioning.readVersion(version);
        if (doc) {
          dispatch({ type: 'load', doc });
          // Bump the history list so the just-saved \"pre-revert\"
          // snapshot shows up in the dropdown.
          setHistoryRefreshKey((k) => k + 1);
        }
      },
      [dispatch, flush, versioning],
    );

    const handleCreateTextAt = useCallback(
      (x: number, y: number) => {
        const id = `layer-${Math.random().toString(36).slice(2, 10)}`;
        dispatch({
          type: 'add-layer',
          layer: {
            id,
            type: 'text',
            name: 'Text',
            position: { x: Math.round(x), y: Math.round(y), width: 240, height: 48 },
            content: {
              text: 'New text',
              style: { fontSize: 32, color: '#111111', fontFamily: 'sans-serif' },
            },
          },
        });
        dispatch({ type: 'set-tool', tool: 'select' });
        setRequestEditLayerId(id);
      },
      [dispatch],
    );

    const shapeKind = state?.shapeKind ?? 'rectangle';
    const shapeDragDraw = isLinearShapeKind(shapeKind);

    const handleCreateShapeAt = useCallback(
      (x: number, y: number) => {
        const layer = createShapeLayer(shapeKind, x, y);
        const id = `layer-${Math.random().toString(36).slice(2, 10)}`;
        dispatch({ type: 'add-layer', layer: { ...layer, id } });
        dispatch({ type: 'set-tool', tool: 'select' });
        if (layer.type === 'text') {
          setRequestEditLayerId(id);
        }
      },
      [dispatch, shapeKind],
    );

    const handleCreateShapeFromPoints = useCallback(
      (x1: number, y1: number, x2: number, y2: number) => {
        dispatch({ type: 'add-layer', layer: createLinearShapeLayer(shapeKind, x1, y1, x2, y2) });
        dispatch({ type: 'set-tool', tool: 'select' });
      },
      [dispatch, shapeKind],
    );

    const handleAddLayer = useCallback(
      (kind: AddableLayerKind) => {
        if (!state) return;
        if (kind === 'image') {
          imageInputRef.current?.click();
          return;
        }

        const { width, height } = state.doc.canvas;
        if (kind === 'text') {
          handleCreateTextAt(Math.max(0, (width - 240) / 2), Math.max(0, (height - 48) / 2));
          return;
        }
        handleCreateShapeAt(width / 2, height / 2);
      },
      [handleCreateShapeAt, handleCreateTextAt, state],
    );

    if (error) {
      return (
        <div
          className={['squisq-image-editor', className].filter(Boolean).join(' ')}
          style={tokens.style}
        >
          <div className="squisq-image-editor-error">
            Failed to load image editor: {error.message}
          </div>
        </div>
      );
    }

    if (!ready || !state) {
      return (
        <div
          className={['squisq-image-editor', className].filter(Boolean).join(' ')}
          style={tokens.style}
        >
          <div className="squisq-image-editor-loading">Loading image editor…</div>
        </div>
      );
    }

    return (
      <div
        className={['squisq-image-editor', className].filter(Boolean).join(' ')}
        style={tokens.style}
        data-testid="image-editor"
      >
        <Toolbar
          doc={state.doc}
          tool={state.tool}
          shapeKind={state.shapeKind}
          dispatch={dispatch}
          uploadAsset={uploadAsset}
          imageInputRef={imageInputRef}
          onExport={handleExport}
          onSave={saveBehavior === 'export' ? () => void runSave() : flush}
          saving={saving}
          saveLabel={saveLabel ?? (saveBehavior === 'export' ? 'Save and close' : 'Save')}
          saveTitle={
            saveTitle ??
            (saveBehavior === 'export'
              ? `Rasterize and save as ${saveFormat.toUpperCase()}`
              : 'Save state.json')
          }
          extraTools={
            versioning ? (
              <ImageVersionHistoryDropdown
                versioning={versioning}
                container={filesContainer}
                onRevert={handleRevertToVersion}
                refreshKey={historyRefreshKey}
              />
            ) : null
          }
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomSet={handleZoomSet}
          onZoomFit={handleZoomFit}
          onZoom1to1={handleZoom1to1}
        />
        {saveError && (
          <div className="squisq-image-editor-save-error" role="alert">
            <span>Couldn’t save the image: {saveError}</span>
            <button
              type="button"
              className="squisq-image-editor-save-error__dismiss"
              onClick={() => setSaveError(null)}
              aria-label="Dismiss save error"
            >
              ×
            </button>
          </div>
        )}
        <div className="squisq-image-editor-body">
          <div className="squisq-image-editor-center">
            <CanvasSurface
              doc={state.doc}
              selectedLayerId={state.selectedLayerId}
              tool={state.tool}
              resolveAssetUrl={resolveAssetUrl}
              dispatch={dispatch}
              onCreateTextAt={handleCreateTextAt}
              onCreateShapeAt={handleCreateShapeAt}
              onCreateShapeFromPoints={handleCreateShapeFromPoints}
              shapeDragDraw={shapeDragDraw}
              zoom={zoom}
              onSetZoom={handleZoomSet}
              surfaceRef={surfaceRef}
              requestEditLayerId={requestEditLayerId}
            />
          </div>
          <SidePanelDrawer>
            <LayersPanel
              doc={state.doc}
              selectedLayerId={state.selectedLayerId}
              dispatch={dispatch}
              onAddLayer={handleAddLayer}
            />
            <PropertiesPanel
              doc={state.doc}
              selectedLayerId={state.selectedLayerId}
              dispatch={dispatch}
            />
          </SidePanelDrawer>
        </div>
      </div>
    );
  },
);
