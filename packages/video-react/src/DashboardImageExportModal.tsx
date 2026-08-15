/**
 * DashboardImageExportModal — configure, render, and save the document's
 * Dashboard rendition as a standalone raster image.
 *
 * Mirrors CoverImageExportModal's flow (shared helpers in
 * `imageExportShared.ts`), with dashboard-specific configuration: a named
 * resolution list (with implicit aspect-ratio families), custom pixel
 * dimensions, the layout picker (auto + built-ins + doc customs), and the
 * title-band toggle. Dimension rules come from `@bendyline/squisq-video`
 * so the browser dialog and the `squisq image` CLI accept identical input.
 */

import { useCallback, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Doc, MediaProvider, Theme } from '@bendyline/squisq/schemas';
import { DASHBOARD_AUTO_LAYOUT_ID, listDashboardLayouts } from '@bendyline/squisq/doc';
import {
  DASHBOARD_RESOLUTIONS,
  DEFAULT_DASHBOARD_RESOLUTION,
  MAX_DASHBOARD_IMAGE_DIMENSION,
  MIN_DASHBOARD_IMAGE_DIMENSION,
  validateDashboardImageDimensions,
  type DashboardResolutionId,
} from '@bendyline/squisq-video';
import { useModalDialog } from '@bendyline/squisq-react';
import { useFrameCapture } from './hooks/useFrameCapture.js';
import {
  IMAGE_FORMAT_DETAILS,
  canvasToImageBlob,
  chooseImageSaveTarget,
  downloadImageBlob,
  imageExportFilename,
  type ImageExportFormat,
} from './imageExportShared.js';

export type DashboardImageExportFormat = ImageExportFormat;

export interface DashboardImageExportModalProps {
  doc: Doc;
  mediaProvider?: MediaProvider | null;
  theme?: Theme;
  /** Initially selected resolution preset (default `'fhd'`). */
  defaultResolution?: DashboardResolutionId;
  /** Initially selected layout id or `'auto'`. */
  defaultLayout?: string;
  /** Initial title-band state (default true — the projection default). */
  defaultShowTitle?: boolean;
  defaultFileName?: string;
  colorScheme?: 'light' | 'dark';
  /** Optional host save flow. Return false when the user cancels. */
  saveOutput?: (blob: Blob, filename: string) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
}

/** Sentinel for the resolution select's custom width/height arm. */
const CUSTOM_RESOLUTION = 'custom';

/** Suggested dashboard title fallback derived from the export file name. */
function documentTitleFromFileName(fileName?: string): string {
  if (!fileName) return '';
  const base = fileName.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '').trim();
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.55)',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const labelStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  marginBottom: 12,
  fontSize: 13,
  fontWeight: 600,
};

export function DashboardImageExportModal({
  doc,
  mediaProvider,
  theme,
  defaultResolution = DEFAULT_DASHBOARD_RESOLUTION,
  defaultLayout = DASHBOARD_AUTO_LAYOUT_ID,
  defaultShowTitle = true,
  defaultFileName,
  colorScheme = 'light',
  saveOutput,
  onClose,
}: DashboardImageExportModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const capture = useFrameCapture();
  const [format, setFormat] = useState<DashboardImageExportFormat>('png');
  const [resolution, setResolution] = useState<string>(defaultResolution);
  const defaultPreset =
    DASHBOARD_RESOLUTIONS.find((preset) => preset.id === defaultResolution) ??
    DASHBOARD_RESOLUTIONS[1];
  const [customWidth, setCustomWidth] = useState<number>(defaultPreset.width);
  const [customHeight, setCustomHeight] = useState<number>(defaultPreset.height);
  const [layout, setLayout] = useState(defaultLayout);
  const [showTitle, setShowTitle] = useState(defaultShowTitle);
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dark = colorScheme === 'dark';
  const surface = dark ? '#111827' : '#ffffff';
  const control = dark ? '#0f172a' : '#ffffff';
  const text = dark ? '#f8fafc' : '#1f2937';
  const muted = dark ? '#94a3b8' : '#6b7280';
  const border = dark ? '#475569' : '#cbd5e1';

  const layoutOptions = useMemo(() => listDashboardLayouts(doc), [doc]);
  const isCustom = resolution === CUSTOM_RESOLUTION;
  const activePreset = DASHBOARD_RESOLUTIONS.find((preset) => preset.id === resolution);
  const width = isCustom ? customWidth : (activePreset?.width ?? defaultPreset.width);
  const height = isCustom ? customHeight : (activePreset?.height ?? defaultPreset.height);
  const dimensionError = isCustom ? validateDashboardImageDimensions(width, height) : null;
  const filename = imageExportFilename(defaultFileName, 'dashboard', format);

  const handleClose = useCallback(() => {
    if (busy) return;
    capture.destroy();
    onClose();
  }, [busy, capture, onClose]);

  useModalDialog({
    rootRef: overlayRef,
    dialogRef,
    closeOnEscape: !busy,
    onClose: handleClose,
  });

  const handleExport = useCallback(async () => {
    if (dimensionError) return;
    setError(null);

    try {
      // Request the native picker before rendering so browsers still consider
      // the call part of the user's click activation.
      const saveTarget = saveOutput ? undefined : await chooseImageSaveTarget(filename, format);
      if (saveTarget === null) return;

      setBusy(true);
      await capture.init(
        doc,
        {
          width,
          height,
          animationsEnabled: false,
          theme,
          mediaProvider: mediaProvider ?? undefined,
          displayMode: 'dashboard',
          dashboard: {
            layout,
            title: showTitle,
            documentTitle: documentTitleFromFileName(defaultFileName),
          },
        },
        'off',
      );
      const canvas = await capture.captureCanvasFrame(0);
      const blob = await canvasToImageBlob(canvas, format, quality);

      if (saveOutput) {
        const saved = await saveOutput(blob, filename);
        if (saved === false) {
          capture.destroy();
          return;
        }
      } else if (saveTarget) {
        const writable = await saveTarget.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        downloadImageBlob(blob, filename);
      }
      capture.destroy();
      onClose();
    } catch (caught: unknown) {
      capture.destroy();
      setError(
        caught instanceof Error ? caught.message : 'The dashboard image could not be exported.',
      );
    } finally {
      setBusy(false);
    }
  }, [
    capture,
    defaultFileName,
    dimensionError,
    doc,
    filename,
    format,
    height,
    layout,
    mediaProvider,
    onClose,
    quality,
    saveOutput,
    showTitle,
    theme,
    width,
  ]);

  const fieldStyle: CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 34,
    border: `1px solid ${border}`,
    borderRadius: 4,
    background: control,
    color: text,
    padding: '6px 8px',
    colorScheme,
  };

  const builtInLayouts = layoutOptions.filter((option) => !option.custom);
  const customLayouts = layoutOptions.filter((option) => option.custom);

  return (
    <div
      ref={overlayRef}
      style={overlayStyle}
      data-color-scheme={colorScheme}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          width: 'min(440px, calc(100vw - 32px))',
          padding: 24,
          border: `1px solid ${border}`,
          borderRadius: 8,
          background: surface,
          color: text,
          boxShadow: '0 18px 48px rgba(0, 0, 0, 0.28)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          colorScheme,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} style={{ margin: '0 36px 18px 0', fontSize: 19 }}>
          Export dashboard as image
        </h2>
        <button
          type="button"
          aria-label="Close dashboard image export"
          disabled={busy}
          onClick={handleClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 32,
            height: 32,
            border: 0,
            background: 'transparent',
            color: text,
            fontSize: 24,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          <span aria-hidden="true">×</span>
        </button>

        <label style={labelStyle}>
          Format
          <select
            aria-label="Image format"
            value={format}
            disabled={busy}
            onChange={(event) => setFormat(event.target.value as DashboardImageExportFormat)}
            style={fieldStyle}
          >
            {Object.entries(IMAGE_FORMAT_DETAILS).map(([value, details]) => (
              <option key={value} value={value}>
                {details.label}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Resolution
          <select
            aria-label="Image resolution"
            value={resolution}
            disabled={busy}
            onChange={(event) => setResolution(event.target.value)}
            style={fieldStyle}
          >
            {DASHBOARD_RESOLUTIONS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value={CUSTOM_RESOLUTION}>Custom…</option>
          </select>
        </label>

        {isCustom && (
          <div style={rowStyle}>
            <label style={labelStyle}>
              Width
              <input
                aria-label="Image width"
                type="number"
                min={MIN_DASHBOARD_IMAGE_DIMENSION}
                max={MAX_DASHBOARD_IMAGE_DIMENSION}
                step={1}
                value={customWidth}
                disabled={busy}
                onChange={(event) => setCustomWidth(Number(event.target.value))}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              Height
              <input
                aria-label="Image height"
                type="number"
                min={MIN_DASHBOARD_IMAGE_DIMENSION}
                max={MAX_DASHBOARD_IMAGE_DIMENSION}
                step={1}
                value={customHeight}
                disabled={busy}
                onChange={(event) => setCustomHeight(Number(event.target.value))}
                style={fieldStyle}
              />
            </label>
          </div>
        )}

        <label style={labelStyle}>
          Layout
          <select
            aria-label="Dashboard layout"
            value={layout}
            disabled={busy}
            onChange={(event) => setLayout(event.target.value)}
            style={fieldStyle}
          >
            <option value={DASHBOARD_AUTO_LAYOUT_ID}>Auto</option>
            {builtInLayouts.map((option) => (
              <option key={option.id} value={option.id}>
                {`${option.label} (${option.capacity})`}
              </option>
            ))}
            {customLayouts.length > 0 && (
              <optgroup label="Custom">
                {customLayouts.map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${option.label} (${option.capacity})`}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            checked={showTitle}
            disabled={busy}
            onChange={(event) => setShowTitle(event.target.checked)}
          />
          Include document title
        </label>

        {format !== 'png' && (
          <label style={labelStyle}>
            Quality: {Math.round(quality * 100)}%
            <input
              aria-label="Image quality"
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={quality}
              disabled={busy}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
          </label>
        )}

        <p style={{ margin: '0 0 12px', color: muted, fontSize: 12 }}>
          {width.toLocaleString()} × {height.toLocaleString()} pixels
        </p>

        {(dimensionError || error) && (
          <p role="alert" style={{ margin: '0 0 12px', color: dark ? '#fca5a5' : '#b91c1c' }}>
            {dimensionError ?? error}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" disabled={busy} onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !!dimensionError}
            onClick={() => void handleExport()}
            style={{ minWidth: 132 }}
          >
            {busy ? 'Rendering…' : 'Choose location…'}
          </button>
        </div>
      </div>
    </div>
  );
}
