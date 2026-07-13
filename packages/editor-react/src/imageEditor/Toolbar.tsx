/**
 * Toolbar — tool selector, layer-creation buttons, file-bin uploader,
 * and a Save/Export button. Versioning controls live in
 * `<ImageEditor>` so the toolbar stays purely about authoring tools.
 */

import { useRef, useState, useEffect } from 'react';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import type { ImageEditorAction, ImageEditorTool } from './state.js';
import { CropIcon, CursorIcon, PlusIcon, ShapeIcon, TextIcon } from './icons.js';
import { ShapePalette } from '../scene/ShapePalette.js';

export interface ToolbarProps {
  doc: ImageEditDoc;
  tool: ImageEditorTool;
  /** The currently armed shape palette kind. Used to highlight active redline shortcuts. */
  shapeKind?: string;
  dispatch: (a: ImageEditorAction) => void;
  /** Upload an image asset and return its sidecar-relative path. */
  uploadAsset: (file: Blob, suggestedName?: string) => Promise<string>;
  /** Shared image picker ref used by the toolbar and Layers panel. */
  imageInputRef?: React.RefObject<HTMLInputElement>;
  /** Trigger an export (PNG/JPEG/WebP) of the flattened canvas. */
  onExport: (format: 'png' | 'jpeg' | 'webp') => void;
  /** Force-flush the state.json (host's "save" button). */
  onSave?: () => void;
  /** Override the Save button label. Default: "Save". */
  saveLabel?: string;
  /** Override the Save button tooltip. Default: "Save state.json". */
  saveTitle?: string;
  /**
   * Optional extra controls rendered just before the Save / Export
   * buttons in the right-aligned tool group. Used by `<ImageEditor>` to
   * mount the version-history dropdown when versioning is enabled.
   */
  extraTools?: React.ReactNode;
  /** Current zoom level (1 = 100%). */
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomSet?: (zoom: number) => void;
  onZoomFit?: () => void;
  onZoom1to1?: () => void;
}

function RedlineArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <line
        x1="3"
        y1="12"
        x2="12"
        y2="3"
        stroke="#cc0000"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <polyline
        points="7,3 12,3 12,8"
        stroke="#cc0000"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function RedlineRectIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="12" height="9" stroke="#cc0000" strokeWidth="1.8" rx="0.5" />
    </svg>
  );
}

function RedlineTextIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <text x="1.5" y="13" fill="#cc0000" fontSize="13" fontFamily="sans-serif" fontWeight="bold">
        A
      </text>
    </svg>
  );
}

function ZoomRectIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <line
        x1="9.5"
        y1="9.5"
        x2="13.5"
        y2="13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="6"
        x2="8"
        y2="6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="6"
        y1="4"
        x2="6"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const REDLINE_TOOLS: Array<{ kind: string; icon: React.ReactNode; title: string }> = [
  { kind: 'redline-arrow', icon: <RedlineArrowIcon />, title: 'Redline arrow' },
  { kind: 'redline-rect', icon: <RedlineRectIcon />, title: 'Redline rectangle' },
  { kind: 'redline-text', icon: <RedlineTextIcon />, title: 'Redline text' },
];

const TOOLS: Array<{
  id: ImageEditorTool;
  icon: React.ReactNode;
  title: string;
}> = [
  { id: 'select', icon: <CursorIcon />, title: 'Select / move (V)' },
  { id: 'text', icon: <TextIcon />, title: 'Add text (T)' },
  { id: 'shape', icon: <ShapeIcon />, title: 'Add shape (S)' },
  { id: 'crop', icon: <CropIcon />, title: 'Crop (C)' },
  { id: 'zoom-rect', icon: <ZoomRectIcon />, title: 'Zoom to rectangle (Z)' },
];

export function Toolbar({
  doc,
  tool,
  shapeKind,
  dispatch,
  uploadAsset,
  imageInputRef,
  onExport,
  onSave,
  saveLabel = 'Save',
  saveTitle = 'Save state.json',
  extraTools,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomSet,
  onZoomFit,
  onZoom1to1,
}: ToolbarProps) {
  const internalImageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = imageInputRef ?? internalImageInputRef;
  const [shapePaletteOpen, setShapePaletteOpen] = useState(false);

  const onFilePicked = async (file: File) => {
    try {
      const path = await uploadAsset(file, file.name);
      // Place the imported image centered at its native size up to canvas.
      const dims = await probeDims(file);
      const w = Math.min(dims.width, doc.canvas.width);
      const h = Math.min(dims.height, doc.canvas.height);
      dispatch({
        type: 'add-layer',
        layer: {
          type: 'image',
          name: file.name,
          position: {
            x: Math.round((doc.canvas.width - w) / 2),
            y: Math.round((doc.canvas.height - h) / 2),
            width: w,
            height: h,
          },
          content: { src: path, alt: file.name, fit: 'fill' },
        },
      });
    } catch (err: unknown) {
      console.warn(
        '[squisq-editor] image upload failed:',
        err instanceof Error ? err.message : err,
      );
    }
  };

  return (
    <div className="squisq-image-editor-toolbar" data-testid="image-editor-toolbar">
      <div className="squisq-image-editor-tool-group" role="radiogroup" aria-label="Tools">
        {TOOLS.map((t) => {
          const button = (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tool === t.id}
              className={['squisq-image-editor-tool-button', tool === t.id ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                if (t.id === 'shape') {
                  // The Shape tool owns a palette popover: clicking it both
                  // arms the shape tool and toggles the palette so the user
                  // can choose which shape to drop next.
                  dispatch({ type: 'set-tool', tool: 'shape' });
                  setShapePaletteOpen((o) => !o);
                  return;
                }
                setShapePaletteOpen(false);
                dispatch({ type: 'set-tool', tool: t.id });
              }}
              title={t.title}
              aria-label={t.title}
              aria-haspopup={t.id === 'shape' ? 'dialog' : undefined}
              aria-expanded={t.id === 'shape' ? shapePaletteOpen : undefined}
            >
              {t.icon}
            </button>
          );
          if (t.id !== 'shape') return button;
          return (
            <span key={t.id} className="squisq-image-editor-shape-trigger">
              {button}
              {shapePaletteOpen && (
                <ShapePalette
                  ignoreOutsideSelector=".squisq-image-editor-toolbar"
                  onPick={(kind) => {
                    dispatch({ type: 'set-shape-kind', kind });
                    dispatch({ type: 'set-tool', tool: 'shape' });
                    setShapePaletteOpen(false);
                  }}
                  onClose={() => setShapePaletteOpen(false)}
                />
              )}
            </span>
          );
        })}
      </div>

      <div className="squisq-image-editor-tool-group" role="group" aria-label="Redline shortcuts">
        {REDLINE_TOOLS.map((rt) => {
          const active = tool === 'shape' && shapeKind === rt.kind;
          return (
            <button
              key={rt.kind}
              type="button"
              className={['squisq-image-editor-tool-button', active ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                dispatch({ type: 'set-shape-kind', kind: rt.kind });
                dispatch({ type: 'set-tool', tool: 'shape' });
                setShapePaletteOpen(false);
              }}
              title={rt.title}
              aria-label={rt.title}
              aria-pressed={active}
            >
              {rt.icon}
            </button>
          );
        })}
      </div>

      <div className="squisq-image-editor-tool-group">
        <button
          type="button"
          className="squisq-image-editor-tool-button squisq-image-editor-tool-button--with-label"
          onClick={() => fileInputRef.current?.click()}
          title="Import image as new layer"
          aria-label="Import image as new layer"
        >
          <PlusIcon />
          <span>Image</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFilePicked(file);
            e.target.value = '';
          }}
        />
      </div>

      {(onZoomIn || onZoomOut) && (
        <div className="squisq-image-editor-tool-group squisq-image-editor-tool-group--zoom">
          <button
            type="button"
            className="squisq-image-editor-tool-button"
            onClick={onZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <input
            type="number"
            className="squisq-image-editor-zoom-input"
            value={Math.round((zoom ?? 1) * 100)}
            min={6}
            max={1600}
            step={1}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v > 0) onZoomSet?.(v / 100);
            }}
            aria-label="Zoom percentage"
            title="Zoom %"
          />
          <span className="squisq-image-editor-zoom-label">%</span>
          <button
            type="button"
            className="squisq-image-editor-tool-button"
            onClick={onZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="squisq-image-editor-tool-button squisq-image-editor-tool-button--with-label"
            onClick={onZoom1to1}
            title="1:1 pixels"
          >
            1:1
          </button>
          <button
            type="button"
            className="squisq-image-editor-tool-button squisq-image-editor-tool-button--with-label"
            onClick={onZoomFit}
            title="Fit to window"
          >
            Fit
          </button>
        </div>
      )}

      <div className="squisq-image-editor-tool-group squisq-image-editor-tool-group--right">
        {extraTools}
        {onSave && (
          <button
            type="button"
            className="squisq-image-editor-tool-button"
            onClick={onSave}
            title={saveTitle}
          >
            {saveLabel}
          </button>
        )}
        <ExportDropdown onExport={onExport} />
      </div>
    </div>
  );
}

/**
 * Single export dropdown listing all output formats. Replaces the
 * earlier split "Export PNG / Other format…" pair so the toolbar reads
 * as one Export control with a stable label and consistent sizing.
 */
function ExportDropdown({ onExport }: { onExport: (f: 'png' | 'jpeg' | 'webp') => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
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

  const pick = (f: 'png' | 'jpeg' | 'webp') => {
    setOpen(false);
    onExport(f);
  };

  return (
    <span ref={wrapRef} className="squisq-image-editor-version-dropdown">
      <button
        ref={triggerRef}
        type="button"
        className="squisq-image-editor-tool-button squisq-image-editor-tool-button--with-label"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export image"
      >
        <span>Export</span>
        <span aria-hidden="true" style={{ fontSize: '0.8em' }}>
          ▾
        </span>
      </button>
      {open && (
        <div className="squisq-image-editor-version-popover" role="menu" style={{ minWidth: 160 }}>
          <ul className="squisq-image-editor-version-popover__list" style={{ maxHeight: 'none' }}>
            {(
              [
                { f: 'png', label: 'PNG' },
                { f: 'jpeg', label: 'JPEG' },
                { f: 'webp', label: 'WebP' },
              ] as const
            ).map(({ f, label }) => (
              <li key={f} className="squisq-image-editor-version-popover__row">
                <button
                  type="button"
                  role="menuitem"
                  className="squisq-image-editor-tool-button squisq-image-editor-tool-button--menu"
                  onClick={() => pick(f)}
                >
                  Export as {label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

function probeDims(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 200, height: 200 });
    };
    img.src = url;
  });
}
