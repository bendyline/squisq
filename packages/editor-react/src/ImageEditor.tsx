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

import { useCallback, useState } from 'react';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { exportImageEditDoc, type ImageEditExportFormat } from '@bendyline/squisq/imageEdit';
import type { SurfaceScheme, Theme } from '@bendyline/squisq/schemas';
import { CanvasSurface } from './imageEditor/CanvasSurface.js';
import { ImageVersionHistoryDropdown } from './imageEditor/ImageVersionHistoryDropdown.js';
import { LayersPanel } from './imageEditor/LayersPanel.js';
import { PropertiesPanel } from './imageEditor/PropertiesPanel.js';
import { Toolbar } from './imageEditor/Toolbar.js';
import { useImageEditor } from './imageEditor/useImageEditor.js';
import { useImageEditorTokens } from './imageEditor/useImageEditorTokens.js';

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
  /** Called after the user clicks Export and the blob is produced. */
  onExport?: (blob: Blob, format: ImageEditExportFormat) => void;
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

export function ImageEditor(props: ImageEditorProps) {
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

  const handleExport = useCallback(
    async (format: ImageEditExportFormat) => {
      if (!state) return;
      try {
        const blob = await exportImageEditDoc(state.doc, filesContainer, { format });
        if (onExport) {
          onExport(blob, format);
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
      } catch (err: unknown) {
        console.warn(
          '[squisq-editor] image export failed:',
          err instanceof Error ? err.message : err,
        );
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
  const handleSaveAndClose = useCallback(async () => {
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
      await handleExport(saveFormat);
    } catch (err: unknown) {
      console.warn(
        '[squisq-editor] image-edit save-and-close failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }, [flush, versioning, handleExport, saveFormat]);

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
      dispatch({
        type: 'add-layer',
        layer: {
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
    },
    [dispatch],
  );

  const handleCreateShapeAt = useCallback(
    (x: number, y: number) => {
      dispatch({
        type: 'add-layer',
        layer: {
          type: 'shape',
          name: 'Rectangle',
          position: {
            x: Math.round(x - 60),
            y: Math.round(y - 40),
            width: 120,
            height: 80,
          },
          content: {
            shape: 'rect',
            fill: '#3399ff',
            stroke: '#1a4d80',
            strokeWidth: 2,
            borderRadius: 8,
          },
        },
      });
      dispatch({ type: 'set-tool', tool: 'select' });
    },
    [dispatch],
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
        dispatch={dispatch}
        uploadAsset={uploadAsset}
        onExport={handleExport}
        onSave={saveBehavior === 'export' ? handleSaveAndClose : flush}
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
      />
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
          />
        </div>
        <div className="squisq-image-editor-side">
          <LayersPanel
            doc={state.doc}
            selectedLayerId={state.selectedLayerId}
            dispatch={dispatch}
          />
          <PropertiesPanel
            doc={state.doc}
            selectedLayerId={state.selectedLayerId}
            dispatch={dispatch}
          />
        </div>
      </div>
    </div>
  );
}
