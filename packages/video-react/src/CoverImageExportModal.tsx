/**
 * CoverImageExportModal — configure, render, and save a managed cover as a
 * standalone raster image.
 */

import { useCallback, useId, useRef, useState, type CSSProperties } from 'react';
import type { Doc, MediaProvider, Theme } from '@bendyline/squisq/schemas';
import type { CoverSlideTemplate } from '@bendyline/squisq/doc';
import { useModalDialog } from '@bendyline/squisq-react';
import { useFrameCapture } from './hooks/useFrameCapture.js';

export type CoverImageExportFormat = 'png' | 'jpeg' | 'webp';

export interface CoverImageExportModalProps {
  doc: Doc;
  mediaProvider?: MediaProvider | null;
  theme?: Theme;
  coverSlideTemplate?: CoverSlideTemplate;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultFileName?: string;
  colorScheme?: 'light' | 'dark';
  /** Optional host save flow. Return false when the user cancels. */
  saveOutput?: (blob: Blob, filename: string) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
}

interface CoverImageWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface CoverImageFileHandle {
  createWritable(): Promise<CoverImageWritable>;
}

interface CoverImagePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<CoverImageFileHandle>;
}

const MIN_DIMENSION = 64;
const MAX_DIMENSION = 7680;
const MAX_PIXELS = 33_177_600;

/**
 * Named output sizes offered alongside the 1×/2× viewport scales. These are
 * platform targets, so they set absolute pixels regardless of the document's
 * viewport.
 */
export const COVER_IMAGE_SIZE_PRESETS: readonly {
  label: string;
  width: number;
  height: number;
}[] = [{ label: 'YouTube cover', width: 1280, height: 720 }];

const FORMAT_DETAILS: Record<
  CoverImageExportFormat,
  { extension: string; mime: string; label: string }
> = {
  png: { extension: 'png', mime: 'image/png', label: 'PNG — lossless' },
  jpeg: { extension: 'jpg', mime: 'image/jpeg', label: 'JPEG — smaller file' },
  webp: { extension: 'webp', mime: 'image/webp', label: 'WebP — compact' },
};

export function validateCoverImageDimensions(width: number, height: number): string | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    return 'Width and height must be whole numbers.';
  }
  if (
    width < MIN_DIMENSION ||
    height < MIN_DIMENSION ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return `Width and height must be between ${MIN_DIMENSION} and ${MAX_DIMENSION} pixels.`;
  }
  if (width * height > MAX_PIXELS) {
    return 'Resolution is too large. Choose a size at or below 33 megapixels.';
  }
  return null;
}

export function coverImageFilename(
  requestedName: string | undefined,
  format: CoverImageExportFormat,
): string {
  const extension = FORMAT_DETAILS[format].extension;
  const base =
    requestedName
      ?.replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('')
      .trim()
      .replace(/[. ]+$/g, '') || 'document';
  return `${base}-cover.${extension}`;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: CoverImageExportFormat,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode the cover image.'));
      },
      FORMAT_DETAILS[format].mime,
      format === 'png' ? undefined : quality,
    );
  });
}

async function chooseSaveTarget(
  filename: string,
  format: CoverImageExportFormat,
): Promise<CoverImageFileHandle | null | undefined> {
  const picker = (window as unknown as CoverImagePickerWindow).showSaveFilePicker;
  if (!picker) return undefined;
  const details = FORMAT_DETAILS[format];
  try {
    return await picker.call(window, {
      suggestedName: filename,
      types: [
        {
          description: `${details.label.split(' —')[0]} image`,
          accept: { [details.mime]: [`.${details.extension}`] },
        },
      ],
    });
  } catch (caught: unknown) {
    if (caught instanceof DOMException && caught.name === 'AbortError') return null;
    throw caught;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

export function CoverImageExportModal({
  doc,
  mediaProvider,
  theme,
  coverSlideTemplate,
  defaultWidth = 1920,
  defaultHeight = 1080,
  defaultFileName,
  colorScheme = 'light',
  saveOutput,
  onClose,
}: CoverImageExportModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const capture = useFrameCapture();
  const [format, setFormat] = useState<CoverImageExportFormat>('png');
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dark = colorScheme === 'dark';
  const surface = dark ? '#111827' : '#ffffff';
  const control = dark ? '#0f172a' : '#ffffff';
  const text = dark ? '#f8fafc' : '#1f2937';
  const muted = dark ? '#94a3b8' : '#6b7280';
  const border = dark ? '#475569' : '#cbd5e1';
  const filename = coverImageFilename(defaultFileName, format);
  const dimensionError = validateCoverImageDimensions(width, height);

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
    if (dimensionError || !doc.startBlock) return;
    setError(null);

    try {
      // Request the native picker before rendering so browsers still consider
      // the call part of the user's click activation.
      const saveTarget = saveOutput ? undefined : await chooseSaveTarget(filename, format);
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
          showCoverSlide: true,
          coverSlideTemplate,
        },
        'off',
      );
      await capture.setCoverVisible(true);
      const canvas = await capture.captureCanvasFrame(0);
      const blob = await canvasToBlob(canvas, format, quality);

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
        downloadBlob(blob, filename);
      }
      capture.destroy();
      onClose();
    } catch (caught: unknown) {
      capture.destroy();
      setError(caught instanceof Error ? caught.message : 'The cover image could not be exported.');
    } finally {
      setBusy(false);
    }
  }, [
    capture,
    coverSlideTemplate,
    dimensionError,
    doc,
    filename,
    format,
    height,
    mediaProvider,
    onClose,
    quality,
    saveOutput,
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
          Export cover slide
        </h2>
        <button
          type="button"
          aria-label="Close cover image export"
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
            onChange={(event) => setFormat(event.target.value as CoverImageExportFormat)}
            style={fieldStyle}
          >
            {Object.entries(FORMAT_DETAILS).map(([value, details]) => (
              <option key={value} value={value}>
                {details.label}
              </option>
            ))}
          </select>
        </label>

        <div style={rowStyle}>
          <label style={labelStyle}>
            Width
            <input
              aria-label="Image width"
              type="number"
              min={MIN_DIMENSION}
              max={MAX_DIMENSION}
              step={1}
              value={width}
              disabled={busy}
              onChange={(event) => setWidth(Number(event.target.value))}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            Height
            <input
              aria-label="Image height"
              type="number"
              min={MIN_DIMENSION}
              max={MAX_DIMENSION}
              step={1}
              value={height}
              disabled={busy}
              onChange={(event) => setHeight(Number(event.target.value))}
              style={fieldStyle}
            />
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '-2px 0 14px' }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setWidth(defaultWidth);
              setHeight(defaultHeight);
            }}
          >
            1×
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setWidth(defaultWidth * 2);
              setHeight(defaultHeight * 2);
            }}
          >
            2×
          </button>
          {COVER_IMAGE_SIZE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy}
              title={`${preset.width} × ${preset.height} pixels`}
              onClick={() => {
                setWidth(preset.width);
                setHeight(preset.height);
              }}
            >
              {preset.label}
            </button>
          ))}
          <span style={{ alignSelf: 'center', color: muted, fontSize: 12 }}>
            {width.toLocaleString()} × {height.toLocaleString()} pixels
          </span>
        </div>

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

        {(dimensionError || error) && (
          <p role="alert" style={{ margin: '0 0 12px', color: dark ? '#fca5a5' : '#b91c1c' }}>
            {dimensionError ?? error}
          </p>
        )}
        {!doc.startBlock && (
          <p role="alert" style={{ margin: '0 0 12px', color: dark ? '#fca5a5' : '#b91c1c' }}>
            This document does not have a cover slide to export.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" disabled={busy} onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !!dimensionError || !doc.startBlock}
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
