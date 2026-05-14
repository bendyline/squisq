/**
 * PropertiesPanel — kind-aware editors for the canvas and the selected
 * layer. Plain controls only (no JsonEditor dependency) so the panel
 * stays focused on the image-editing vocabulary.
 */

import type { ImageEditDoc, ImageEditLayer } from '@bendyline/squisq/schemas';
import type { ImageEditorAction } from './state.js';
import { NoneIcon } from './icons.js';

export interface PropertiesPanelProps {
  doc: ImageEditDoc;
  selectedLayerId: string | null;
  dispatch: (action: ImageEditorAction) => void;
}

export function PropertiesPanel({ doc, selectedLayerId, dispatch }: PropertiesPanelProps) {
  const selected = selectedLayerId
    ? (doc.layers.find((l) => l.id === selectedLayerId) ?? null)
    : null;

  return (
    <div className="squisq-image-editor-properties" data-testid="image-editor-properties">
      <div className="squisq-image-editor-panel-header">Properties</div>
      <CanvasSection doc={doc} dispatch={dispatch} />
      {selected ? (
        <LayerSection layer={selected} dispatch={dispatch} />
      ) : (
        <div className="squisq-image-editor-properties-empty">No layer selected</div>
      )}
    </div>
  );
}

// ============================================
// Canvas section
// ============================================

function CanvasSection({
  doc,
  dispatch,
}: {
  doc: ImageEditDoc;
  dispatch: (a: ImageEditorAction) => void;
}) {
  const setCanvas = (patch: Partial<ImageEditDoc['canvas']>) => {
    dispatch({ type: 'set-canvas', canvas: { ...doc.canvas, ...patch } });
  };
  return (
    <fieldset className="squisq-image-editor-fieldset">
      <legend>Canvas</legend>
      <NumberField
        label="Width"
        value={doc.canvas.width}
        min={1}
        onChange={(v) => setCanvas({ width: Math.round(v) })}
      />
      <NumberField
        label="Height"
        value={doc.canvas.height}
        min={1}
        onChange={(v) => setCanvas({ height: Math.round(v) })}
      />
      <ColorField
        label="Background"
        value={doc.canvas.background ?? 'transparent'}
        allowTransparent
        onChange={(v) => setCanvas({ background: v })}
      />
    </fieldset>
  );
}

// ============================================
// Layer section
// ============================================

function LayerSection({
  layer,
  dispatch,
}: {
  layer: ImageEditLayer;
  dispatch: (a: ImageEditorAction) => void;
}) {
  const update = (patch: Partial<ImageEditLayer>) =>
    dispatch({ type: 'update-layer', layerId: layer.id, patch });

  return (
    <>
      <fieldset className="squisq-image-editor-fieldset">
        <legend>Layer</legend>
        <TextField label="Name" value={layer.name ?? ''} onChange={(name) => update({ name })} />
        <NumberField
          label="Opacity"
          value={layer.opacity ?? 1}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) => update({ opacity })}
        />
      </fieldset>

      <PositionFields layer={layer} update={update} />

      {layer.type === 'image' && <ImageFields layer={layer} update={update} />}
      {layer.type === 'text' && <TextFields layer={layer} update={update} />}
      {layer.type === 'shape' && <ShapeFields layer={layer} update={update} />}
    </>
  );
}

function PositionFields({
  layer,
  update,
}: {
  layer: ImageEditLayer;
  update: (patch: Partial<ImageEditLayer>) => void;
}) {
  const p = layer.position;
  const setPos = (patch: Partial<typeof p>) =>
    update({ position: { ...p, ...patch } } as Partial<ImageEditLayer>);
  return (
    <fieldset className="squisq-image-editor-fieldset">
      <legend>Position</legend>
      <NumberField
        label="X"
        value={typeof p.x === 'number' ? p.x : 0}
        onChange={(x) => setPos({ x: Math.round(x) })}
      />
      <NumberField
        label="Y"
        value={typeof p.y === 'number' ? p.y : 0}
        onChange={(y) => setPos({ y: Math.round(y) })}
      />
      <NumberField
        label="Width"
        value={typeof p.width === 'number' ? p.width : 0}
        onChange={(width) => setPos({ width: Math.round(width) })}
      />
      <NumberField
        label="Height"
        value={typeof p.height === 'number' ? p.height : 0}
        onChange={(height) => setPos({ height: Math.round(height) })}
      />
    </fieldset>
  );
}

function ImageFields({
  layer,
  update,
}: {
  layer: ImageEditLayer & { type: 'image' };
  update: (patch: Partial<ImageEditLayer>) => void;
}) {
  const c = layer.content;
  const setContent = (patch: Partial<typeof c>) =>
    update({ content: { ...c, ...patch } } as Partial<ImageEditLayer>);
  return (
    <fieldset className="squisq-image-editor-fieldset">
      <legend>Image</legend>
      <TextField label="Alt" value={c.alt ?? ''} onChange={(alt) => setContent({ alt })} />
      <SelectField
        label="Fit"
        value={c.fit ?? 'fill'}
        options={[
          ['fill', 'Fill'],
          ['contain', 'Contain'],
          ['cover', 'Cover'],
        ]}
        onChange={(fit) => setContent({ fit: fit as 'fill' | 'contain' | 'cover' })}
      />
    </fieldset>
  );
}

function TextFields({
  layer,
  update,
}: {
  layer: ImageEditLayer & { type: 'text' };
  update: (patch: Partial<ImageEditLayer>) => void;
}) {
  const c = layer.content;
  const setContent = (patch: Partial<typeof c>) =>
    update({ content: { ...c, ...patch } } as Partial<ImageEditLayer>);
  const setStyle = (patch: Partial<typeof c.style>) =>
    setContent({ style: { ...c.style, ...patch } });
  return (
    <fieldset className="squisq-image-editor-fieldset">
      <legend>Text</legend>
      <TextAreaField label="Text" value={c.text} onChange={(text) => setContent({ text })} />
      <NumberField
        label="Font size"
        value={c.style.fontSize}
        min={1}
        onChange={(fontSize) => setStyle({ fontSize: Math.round(fontSize) })}
      />
      <ColorField label="Color" value={c.style.color} onChange={(color) => setStyle({ color })} />
      <SelectField
        label="Weight"
        value={c.style.fontWeight ?? 'normal'}
        options={[
          ['normal', 'Normal'],
          ['bold', 'Bold'],
        ]}
        onChange={(fontWeight) => setStyle({ fontWeight: fontWeight as 'normal' | 'bold' })}
      />
      <SelectField
        label="Align"
        value={c.style.textAlign ?? 'left'}
        options={[
          ['left', 'Left'],
          ['center', 'Center'],
          ['right', 'Right'],
        ]}
        onChange={(textAlign) => setStyle({ textAlign: textAlign as 'left' | 'center' | 'right' })}
      />
    </fieldset>
  );
}

function ShapeFields({
  layer,
  update,
}: {
  layer: ImageEditLayer & { type: 'shape' };
  update: (patch: Partial<ImageEditLayer>) => void;
}) {
  const c = layer.content;
  const setContent = (patch: Partial<typeof c>) =>
    update({ content: { ...c, ...patch } } as Partial<ImageEditLayer>);
  return (
    <fieldset className="squisq-image-editor-fieldset">
      <legend>Shape</legend>
      <SelectField
        label="Shape"
        value={c.shape}
        options={[
          ['rect', 'Rectangle'],
          ['circle', 'Circle'],
          ['line', 'Line'],
        ]}
        onChange={(shape) => setContent({ shape: shape as 'rect' | 'circle' | 'line' })}
      />
      <ColorField
        label="Fill"
        value={c.fill ?? '#000000'}
        allowTransparent
        onChange={(fill) => setContent({ fill })}
      />
      <ColorField
        label="Stroke"
        value={c.stroke ?? '#000000'}
        allowTransparent
        onChange={(stroke) => setContent({ stroke })}
      />
      <NumberField
        label="Stroke width"
        value={c.strokeWidth ?? 0}
        min={0}
        onChange={(strokeWidth) => setContent({ strokeWidth })}
      />
      {c.shape === 'rect' && (
        <NumberField
          label="Corner radius"
          value={c.borderRadius ?? 0}
          min={0}
          onChange={(borderRadius) => setContent({ borderRadius: Math.round(borderRadius) })}
        />
      )}
    </fieldset>
  );
}

// ============================================
// Field primitives
// ============================================

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="squisq-image-editor-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="squisq-image-editor-field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="squisq-image-editor-field squisq-image-editor-field--multiline">
      <span>{label}</span>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="squisq-image-editor-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorField({
  label,
  value,
  allowTransparent,
  onChange,
}: {
  label: string;
  value: string;
  allowTransparent?: boolean;
  onChange: (v: string) => void;
}) {
  const isTransparent = value === 'transparent' || value === 'none';
  return (
    <label className="squisq-image-editor-field">
      <span>{label}</span>
      <span className="squisq-image-editor-color-row">
        <input
          type="color"
          value={isTransparent ? '#000000' : normalizeColor(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
        {allowTransparent && (
          <button
            type="button"
            onClick={() => onChange('transparent')}
            title="Set transparent"
            aria-label="Set transparent"
            className="squisq-image-editor-color-clear"
          >
            <NoneIcon />
          </button>
        )}
      </span>
    </label>
  );
}

function normalizeColor(v: string): string {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return (
      '#' +
      v
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
    );
  }
  return '#000000';
}
