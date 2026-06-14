/**
 * ShapeProperties — inspector for the current selection in a drawing.
 *
 * For a selected connector: end/start markers, line style, and routing
 * (→ `setConnectorStyle`). For a selected shape: fill and stroke color
 * (→ `setShapeParam`). Driven by the Scene's surfaced selection + the
 * drawing adapter's selected connector; mirrors the image editor's
 * PropertiesPanel (selection-id + dispatch).
 */

import type { SceneEdge } from './commands/SceneCommand';
import type { ConnectorStyleInput } from './adapters/DrawingAdapter';

interface ShapePropertiesProps {
  selectedEdge: SceneEdge | null;
  selectedShapeId: string | null;
  onConnectorStyle: (id: string, style: ConnectorStyleInput) => void;
  onShapeParam: (id: string, key: string, value: string) => void;
}

const MARKERS = ['none', 'arrow', 'open', 'diamond', 'circle', 'square'];
const ROUTINGS = ['straight', 'orthogonal', 'curved'];
const LINE_STYLES = ['solid', 'dashed', 'dotted'];

function lineStyleOf(dasharray: string | undefined): string {
  if (dasharray === '8 6') return 'dashed';
  if (dasharray === '2 6') return 'dotted';
  return 'solid';
}

export function ShapeProperties({
  selectedEdge,
  selectedShapeId,
  onConnectorStyle,
  onShapeParam,
}: ShapePropertiesProps) {
  if (selectedEdge) {
    const e = selectedEdge;
    const set = (style: ConnectorStyleInput) => onConnectorStyle(e.id, style);
    return (
      <div className="squisq-shape-properties" role="group" aria-label="Connector properties">
        <div className="squisq-shape-properties-title">Connector</div>
        <Field label="End">
          <Select
            value={e.endMarker ?? 'arrow'}
            options={MARKERS}
            onChange={(v) => set({ endStyle: v })}
          />
        </Field>
        <Field label="Start">
          <Select
            value={e.startMarker ?? 'none'}
            options={MARKERS}
            onChange={(v) => set({ startStyle: v })}
          />
        </Field>
        <Field label="Line">
          <Select
            value={lineStyleOf(e.dasharray)}
            options={LINE_STYLES}
            onChange={(v) => set({ lineStyle: v })}
          />
        </Field>
        <Field label="Routing">
          <Select
            value={e.routing ?? 'straight'}
            options={ROUTINGS}
            onChange={(v) => set({ routing: v })}
          />
        </Field>
      </div>
    );
  }

  if (selectedShapeId) {
    const id = selectedShapeId;
    return (
      <div className="squisq-shape-properties" role="group" aria-label="Shape properties">
        <div className="squisq-shape-properties-title">Shape</div>
        <Field label="Fill">
          <input
            type="color"
            aria-label="Fill color"
            onChange={(ev) => onShapeParam(id, 'fill', ev.target.value)}
          />
          <button
            type="button"
            className="squisq-shape-properties-clear"
            onClick={() => onShapeParam(id, 'fill', 'none')}
          >
            none
          </button>
        </Field>
        <Field label="Stroke">
          <input
            type="color"
            aria-label="Stroke color"
            onChange={(ev) => onShapeParam(id, 'stroke', ev.target.value)}
          />
        </Field>
      </div>
    );
  }

  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="squisq-shape-properties-field">
      <span className="squisq-shape-properties-label">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
