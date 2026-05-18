/**
 * Toolbar — tool selector, layer-creation buttons, file-bin uploader,
 * and a Save/Export button. Versioning controls live in
 * `<ImageEditor>` so the toolbar stays purely about authoring tools.
 */

import { useRef, useState, useEffect } from 'react';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import type { ImageEditorAction, ImageEditorTool } from './state.js';
import { CropIcon, CursorIcon, PlusIcon, ShapeIcon, TextIcon } from './icons.js';

export interface ToolbarProps {
  doc: ImageEditDoc;
  tool: ImageEditorTool;
  dispatch: (a: ImageEditorAction) => void;
  /** Upload an image asset and return its sidecar-relative path. */
  uploadAsset: (file: Blob, suggestedName?: string) => Promise<string>;
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
}

const TOOLS: Array<{
  id: ImageEditorTool;
  icon: React.ReactNode;
  title: string;
}> = [
  { id: 'select', icon: <CursorIcon />, title: 'Select / move (V)' },
  { id: 'text', icon: <TextIcon />, title: 'Add text (T)' },
  { id: 'shape', icon: <ShapeIcon />, title: 'Add shape (S)' },
  { id: 'crop', icon: <CropIcon />, title: 'Crop (C)' },
];

export function Toolbar({
  doc,
  tool,
  dispatch,
  uploadAsset,
  onExport,
  onSave,
  saveLabel = 'Save',
  saveTitle = 'Save state.json',
  extraTools,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={tool === t.id}
            className={['squisq-image-editor-tool-button', tool === t.id ? 'is-active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => dispatch({ type: 'set-tool', tool: t.id })}
            title={t.title}
            aria-label={t.title}
          >
            {t.icon}
          </button>
        ))}
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
