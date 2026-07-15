/**
 * TemplateDesigner — modal Scene-backed editor for authoring a
 * `CustomTemplateDefinition`. Mounts the Scene with the in-memory
 * adapter, exposes a placeholder palette, and lets the user save the
 * result to either the current doc or the browser-local library.
 *
 * Responsiveness preview: a small viewport-aspect toggle (16:9 /
 * 9:16 / 1:1) re-mounts the Scene at the alternate viewport so the
 * author can see how their `%`-based layout will adapt. The
 * underlying layer array is the same; only the Scene's `viewport`
 * prop changes.
 *
 * Save flow: numeric position fields are normalized to `%`-strings
 * relative to the design canvas (always 1920×1080 in v1), then the
 * resulting Layer[] is bundled into a `CustomTemplateDefinition`
 * and handed to the host via `onSave`. The host decides whether to
 * persist to the doc, the library, or both.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MediaContext } from '@bendyline/squisq-react';
import type {
  CustomTemplateDefinition,
  ImageLayer,
  Layer,
  MediaProvider,
  ViewportConfig,
} from '@bendyline/squisq/schemas';
import {
  Scene,
  SelectTool,
  createTokenTool,
  createPlaceTool,
  buildTokenLayer,
  type SceneTool,
} from '../scene';
import { useMemoryLayerAdapter } from './useMemoryLayerAdapter';
import { normalizePositions } from './normalizePositions';
import { AddBin } from './AddBin';
import { TOKEN_DEFS, TOKEN_DRAG_MIME } from './tokenDefs';
import { SHAPE_DEFS, SHAPE_DRAG_MIME, buildShapeLayer } from './shapeDefs';
import { partitionFiles, processMediaFiles } from '../utils/dropUtils';
import { LayerToolbar } from './LayerToolbar';
import { useModalDialog } from '../modal/useModalDialog';

export type DesignerSaveTarget = 'doc' | 'library';

interface TemplateDesignerProps {
  /** Optional initial template to edit (vs starting from scratch). */
  initial?: CustomTemplateDefinition;
  /**
   * Called when the user clicks Save. The host decides where to
   * persist (usually via `CustomTemplateContext.upsertDocTemplate`
   * and/or `upsertLibraryTemplate`).
   */
  onSave: (def: CustomTemplateDefinition, target: DesignerSaveTarget) => void;
  /** Called when the user dismisses the modal without saving. */
  onClose: () => void;
  /**
   * Embedded mode: render the designer inline (no full-screen portal /
   * backdrop, no close button, no Cancel) so a host frame — e.g. the
   * Custom Layout Manager — can place it inside its own panel. The
   * designer fills its container and does NOT call `onClose` after a
   * save, so the host stays in control of selection.
   */
  embedded?: boolean;
  /**
   * Label for the primary (save-to-doc) button. Defaults to
   * "Save to this doc"; the Custom Layout Manager passes a plain "Save"
   * when the open layout already lives in the doc.
   */
  primarySaveLabel?: string;
  /**
   * Media storage. When provided, images dropped on the canvas (or
   * picked via the Add bin's Media section) are uploaded and pinned as a
   * full-bleed background layer, and the canvas resolves their URLs for
   * preview. Omit to disable media in the bin.
   */
  mediaProvider?: MediaProvider | null;
  /** Editor chrome scheme, copied onto the portal root for theme inheritance. */
  colorScheme?: 'light' | 'dark';
}

const DESIGN_CANVAS = { width: 1920, height: 1080 };

/**
 * Derive a technical name slug from a human label: lowercase, collapse
 * runs of non-alphanumerics to single hyphens, trim leading/trailing
 * hyphens, and drop any leading non-letter chars so the result matches
 * the `^[a-z][a-z0-9-]*$` rule enforced by `validate()`.
 */
function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/^-+|-+$/g, '');
}

const VIEWPORT_OPTIONS: {
  id: 'landscape' | 'portrait' | 'square';
  label: string;
  viewport: ViewportConfig;
}[] = [
  { id: 'landscape', label: '16:9', viewport: { width: 1920, height: 1080, name: 'Landscape' } },
  { id: 'portrait', label: '9:16', viewport: { width: 1080, height: 1920, name: 'Portrait' } },
  { id: 'square', label: '1:1', viewport: { width: 1080, height: 1080, name: 'Square' } },
];

export function TemplateDesigner({
  initial,
  onSave,
  onClose,
  embedded = false,
  primarySaveLabel = 'Save to this doc',
  mediaProvider = null,
  colorScheme = 'light',
}: TemplateDesignerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog({ rootRef: overlayRef, dialogRef, onClose });
  const [name, setName] = useState(initial?.name ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  // While true, the name auto-tracks the label (the 90% case). Editing
  // the name field manually pins it; clearing the name resumes tracking.
  const [nameAutoDerived, setNameAutoDerived] = useState(!initial?.name);

  const handleLabelChange = useCallback(
    (value: string) => {
      setLabel(value);
      if (nameAutoDerived) setName(slugifyLabel(value));
    },
    [nameAutoDerived],
  );

  const handleNameChange = useCallback(
    (value: string) => {
      // An empty name re-enables auto-derivation and re-syncs to the
      // current label; any text pins the name to what the user typed.
      if (value.trim() === '') {
        setNameAutoDerived(true);
        setName(slugifyLabel(label));
      } else {
        setNameAutoDerived(false);
        setName(value);
      }
    },
    [label],
  );
  const [previewViewportId, setPreviewViewportId] = useState<'landscape' | 'portrait' | 'square'>(
    'landscape',
  );

  // Build the toolset once. Each bin entry — placeholder token or shape —
  // gets a click-to-place tool. Gesture state is supplied by each Scene,
  // so the reusable tool definitions remain instance-safe.
  const tools: SceneTool[] = useMemo(
    () => [
      SelectTool,
      ...TOKEN_DEFS.map((d) => createTokenTool(d)),
      ...SHAPE_DEFS.map((s) =>
        createPlaceTool({ id: s.id, label: s.label, build: (p) => buildShapeLayer(s, p) }),
      ),
    ],
    [],
  );

  const adapter = useMemoryLayerAdapter({
    initial: initial?.layers ?? [],
    tools,
  });

  // Upload image files and pin each as a full-bleed background layer,
  // prepended so it sits behind everything (layers composite back-to-front).
  const addMediaBackgrounds = useCallback(
    async (files: File[]) => {
      if (!mediaProvider) return;
      const { media } = partitionFiles(files);
      if (media.length === 0) return;
      const paths = await processMediaFiles(media, mediaProvider);
      const backgrounds: ImageLayer[] = paths
        .filter((p): p is string => !!p)
        .map((src, i) => ({
          id: `bg-${Date.now().toString(36)}-${i}`,
          type: 'image',
          position: { x: 0, y: 0, width: DESIGN_CANVAS.width, height: DESIGN_CANVAS.height },
          content: { src, alt: '', fit: 'cover' },
        }));
      if (backgrounds.length === 0) return;
      adapter.setLayers([...backgrounds, ...adapter.layers]);
    },
    [adapter, mediaProvider],
  );

  // Drag-and-drop onto the canvas. A dragged placeholder or shape adds the
  // same layer its click-to-place tool would, at the drop point (`point`
  // is already in viewport coordinates). Dropped image files become
  // full-bleed background layers.
  const handleCanvasDrop = useCallback(
    (e: React.DragEvent, point: { x: number; y: number }) => {
      const tokenDef = TOKEN_DEFS.find((d) => d.id === e.dataTransfer.getData(TOKEN_DRAG_MIME));
      if (tokenDef) {
        adapter.dispatch({ kind: 'addLayer', layer: buildTokenLayer(tokenDef, point) });
        return;
      }
      const shapeDef = SHAPE_DEFS.find((s) => s.id === e.dataTransfer.getData(SHAPE_DRAG_MIME));
      if (shapeDef) {
        adapter.dispatch({ kind: 'addLayer', layer: buildShapeLayer(shapeDef, point) });
        return;
      }
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) void addMediaBackgrounds(files);
    },
    [adapter, addMediaBackgrounds],
  );

  // Track the selected layer so the contextual styling toolbar can edit
  // it. The Scene reports a set of ids; the designer is single-select for
  // styling purposes, so we take the first.
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const selectedLayer = adapter.layers.find((l) => l.id === selectedLayerId) ?? null;

  const handleLayerAttr = useCallback(
    (path: string, value: unknown) => {
      if (!selectedLayerId) return;
      adapter.dispatch({ kind: 'setLayerAttr', id: selectedLayerId, path, value });
    },
    [adapter, selectedLayerId],
  );

  const [activeToolId, setActiveToolId] = useState<string>('select');

  const currentViewport =
    VIEWPORT_OPTIONS.find((v) => v.id === previewViewportId)?.viewport ?? DESIGN_CANVAS;

  const validate = (): string | null => {
    const slug = name.trim();
    if (!slug) return 'Name is required.';
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      return 'Name must be lowercase letters, digits, and hyphens (no spaces).';
    }
    if (!label.trim()) return 'Label is required.';
    if (adapter.layers.length === 0) return 'Add at least one layer or placeholder.';
    return null;
  };

  const handleSave = (target: DesignerSaveTarget) => {
    const error = validate();
    if (error) {
      alert(error);
      return;
    }
    // Normalize against the design canvas so the saved template is
    // resolution-independent — see normalizePositions.ts.
    const layers: Layer[] = normalizePositions(adapter.layers, DESIGN_CANVAS);
    const def: CustomTemplateDefinition = {
      name: name.trim(),
      label: label.trim(),
      viewport: DESIGN_CANVAS,
      layers,
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    onSave(def, target);
    // Embedded hosts (the Custom Layout Manager) own selection state, so
    // staying mounted after a save lets the user keep editing.
    if (!embedded) onClose();
  };

  const panel = (
    <div
      ref={dialogRef}
      className={`squisq-template-designer-panel${
        embedded ? ' squisq-template-designer-panel--embedded' : ''
      }`}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : 'true'}
      aria-labelledby={embedded ? undefined : titleId}
      tabIndex={embedded ? undefined : -1}
    >
      {/* Standalone modal owns its title + close button. Embedded in the
          Custom Layout Manager, the host frame provides both, so the
          designer drops its header entirely. */}
      {!embedded && (
        <header className="squisq-template-designer-header">
          <h2 id={titleId} className="squisq-template-designer-title">
            {initial ? 'Edit layout' : 'New layout'}
          </h2>
          <button
            type="button"
            className="squisq-template-designer-close"
            onClick={onClose}
            aria-label="Close designer"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>
      )}

      <div className="squisq-template-designer-meta">
        <label className="squisq-template-designer-field">
          <span>Label</span>
          <input
            type="text"
            value={label}
            placeholder="Hero Section"
            onChange={(e) => handleLabelChange(e.target.value)}
          />
        </label>
        <label className="squisq-template-designer-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            placeholder="auto from label"
            onChange={(e) => handleNameChange(e.target.value)}
            spellCheck={false}
          />
          <span className="squisq-template-designer-field-hint">
            Auto-derived from the label — edit to override.
          </span>
        </label>
        <label className="squisq-template-designer-field">
          <span>Description</span>
          <input
            type="text"
            value={description}
            placeholder="One-sentence description (optional)"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>

      <div className="squisq-template-designer-body">
        <AddBin
          activeToolId={activeToolId}
          onActivate={setActiveToolId}
          canAddMedia={!!mediaProvider}
          onAddMediaFiles={(files) => void addMediaBackgrounds(files)}
        />
        <div className="squisq-template-designer-stage">
          {/* One controls row: the compact aspect-ratio dropdown plus the
              contextual layer styling controls (when a layer is selected),
              so the two share a row instead of stacking. */}
          <div className="squisq-template-designer-stage-bar">
            <span className="squisq-template-designer-viewport-label">Preview</span>
            <select
              className="squisq-layer-toolbar-select"
              aria-label="Preview aspect ratio"
              title="Preview aspect ratio"
              value={previewViewportId}
              onChange={(e) =>
                setPreviewViewportId(e.target.value as 'landscape' | 'portrait' | 'square')
              }
            >
              {VIEWPORT_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            {/* Contextual styling controls — appear when a layer is selected. */}
            {selectedLayer && (
              <>
                <div className="squisq-layer-toolbar-sep" aria-hidden="true" />
                <LayerToolbar layer={selectedLayer} onAttr={handleLayerAttr} />
              </>
            )}
          </div>
          <div className="squisq-template-designer-scene">
            {/* MediaContext lets image layers resolve uploaded media to
                  displayable (blob) URLs in the canvas, matching preview. */}
            <MediaContext.Provider value={mediaProvider}>
              <Scene
                viewport={currentViewport}
                layers={adapter.layers}
                tools={tools}
                activeToolId={activeToolId}
                onActiveToolIdChange={setActiveToolId}
                onCommand={adapter.dispatch}
                onSelectionChange={(ids) => setSelectedLayerId(ids.values().next().value ?? null)}
                onDrop={handleCanvasDrop}
                showToolbar={false}
              />
            </MediaContext.Provider>
          </div>
        </div>
      </div>

      <footer className="squisq-template-designer-footer">
        <span className="squisq-template-designer-footer-hint">
          Layers are saved as % of a 1920×1080 canvas so the layout adapts to any viewport.
        </span>
        <div className="squisq-template-designer-footer-actions">
          {!embedded && (
            <button type="button" className="squisq-template-designer-btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="squisq-template-designer-btn"
            onClick={() => handleSave('library')}
            title="Save to your browser-local library so other docs can use it"
          >
            Save to library
          </button>
          <button
            type="button"
            className="squisq-template-designer-btn squisq-template-designer-btn--primary"
            onClick={() => handleSave('doc')}
          >
            {primarySaveLabel}
          </button>
        </div>
      </footer>
    </div>
  );

  // Embedded: hand the bare panel back so a host frame can place it.
  if (embedded) return panel;

  // Standalone: full-screen modal over a click-to-dismiss backdrop.
  return createPortal(
    <div
      ref={overlayRef}
      className="squisq-editor-shell squisq-template-designer-overlay"
      data-theme={colorScheme}
      onClick={(e) => {
        // Click on the backdrop (not the panel) closes the modal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {panel}
    </div>,
    document.body,
  );
}
