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

import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CustomTemplateDefinition, Layer, ViewportConfig } from '@bendyline/squisq/schemas';
import { Scene, SelectTool, createTokenTool, buildTokenLayer, type SceneTool } from '../scene';
import { useMemoryLayerAdapter } from './useMemoryLayerAdapter';
import { normalizePositions } from './normalizePositions';
import { TokenPalette } from './TokenPalette';
import { TOKEN_DEFS, TOKEN_DRAG_MIME } from './tokenDefs';
import { LayerToolbar } from './LayerToolbar';

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

export function TemplateDesigner({ initial, onSave, onClose }: TemplateDesignerProps) {
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

  // Build the toolset once from the shared token definitions. Token
  // tools are factories so each one has its own state-free closure;
  // SelectTool is the singleton from scene/tools/SelectTool.ts.
  const tools: SceneTool[] = useMemo(
    () => [SelectTool, ...TOKEN_DEFS.map((d) => createTokenTool(d))],
    [],
  );

  const adapter = useMemoryLayerAdapter({
    initial: initial?.layers ?? [],
    tools,
  });

  // Drag-and-drop: a placeholder dragged from the palette and dropped on
  // the canvas adds the same layer the click-to-place TokenTool would,
  // at the drop point (`point` is already in viewport coordinates).
  const handleCanvasDrop = useCallback(
    (e: React.DragEvent, point: { x: number; y: number }) => {
      const id = e.dataTransfer.getData(TOKEN_DRAG_MIME);
      const def = TOKEN_DEFS.find((d) => d.id === id);
      if (!def) return;
      adapter.dispatch({ kind: 'addLayer', layer: buildTokenLayer(def, point) });
    },
    [adapter],
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
    onClose();
  };

  return createPortal(
    <div
      className="squisq-template-designer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Custom template designer"
      onClick={(e) => {
        // Click on the backdrop (not the panel) closes the modal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="squisq-template-designer-panel">
        <header className="squisq-template-designer-header">
          <h2 className="squisq-template-designer-title">
            {initial ? 'Edit custom template' : 'New custom template'}
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
          <TokenPalette activeToolId={activeToolId} onActivate={setActiveToolId} />
          <div className="squisq-template-designer-stage">
            <div className="squisq-template-designer-viewport-toggle">
              <span className="squisq-template-designer-viewport-label">Preview as</span>
              {VIEWPORT_OPTIONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`squisq-template-designer-viewport-btn${
                    previewViewportId === v.id
                      ? ' squisq-template-designer-viewport-btn--active'
                      : ''
                  }`}
                  onClick={() => setPreviewViewportId(v.id)}
                  title={`Preview at ${v.label}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {/* Contextual styling toolbar — appears when a layer is selected. */}
            {selectedLayer && (
              <LayerToolbar layer={selectedLayer} onAttr={handleLayerAttr} />
            )}
            <div className="squisq-template-designer-scene">
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
            </div>
          </div>
        </div>

        <footer className="squisq-template-designer-footer">
          <span className="squisq-template-designer-footer-hint">
            Layers are saved as % of a 1920×1080 canvas so the template adapts to any viewport.
          </span>
          <div className="squisq-template-designer-footer-actions">
            <button type="button" className="squisq-template-designer-btn" onClick={onClose}>
              Cancel
            </button>
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
              Save to this doc
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
