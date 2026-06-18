/**
 * LayerToolbar — contextual styling controls for the layer currently
 * selected in the TemplateDesigner. Renders a compact toolbar whose
 * controls depend on the layer type:
 *
 *   - text  → horizontal + vertical alignment, font size, bold, font
 *             family (the per-layer "Font" override), and color.
 *   - shape → shape kind, fill color, and border (stroke) color.
 *   - image → object-fit.
 *
 * Every control dispatches a single `setLayerAttr` via `onAttr(path,
 * value)`, where `path` is a dotted path into the layer (e.g.
 * `content.style.color`). The parent owns the command dispatch and the
 * selected-layer lookup, so this component stays a pure view over the
 * current layer.
 */

import type { Layer } from '@bendyline/squisq/schemas';
import { AVAILABLE_FONT_STACKS } from '@bendyline/squisq/schemas';
import { Icon } from '../Icon';

interface LayerToolbarProps {
  layer: Layer;
  /** Set a single dotted attribute path on the selected layer. */
  onAttr: (path: string, value: unknown) => void;
}

export function LayerToolbar({ layer, onAttr }: LayerToolbarProps) {
  return (
    <div className="squisq-layer-toolbar" role="toolbar" aria-label="Layer styling">
      {layer.type === 'text' && <TextControls layer={layer} onAttr={onAttr} />}
      {layer.type === 'shape' && <ShapeControls layer={layer} onAttr={onAttr} />}
      {layer.type === 'image' && <ImageControls layer={layer} onAttr={onAttr} />}
    </div>
  );
}

// ─── Text ───────────────────────────────────────────────────────

const FONT_SIZES: Array<[string, number]> = [
  ['Small', 24],
  ['Medium', 40],
  ['Large', 72],
  ['Huge', 120],
];

function TextControls({
  layer,
  onAttr,
}: {
  layer: Layer & { type: 'text' };
  onAttr: LayerToolbarProps['onAttr'];
}) {
  const style = layer.content.style;
  return (
    <>
      <SegGroup
        label="Horizontal align"
        value={style.textAlign ?? 'left'}
        onChange={(v) => onAttr('content.style.textAlign', v)}
        options={[
          { value: 'left', icon: 'fa-solid fa-align-left', title: 'Align left' },
          { value: 'center', icon: 'fa-solid fa-align-center', title: 'Align center' },
          { value: 'right', icon: 'fa-solid fa-align-right', title: 'Align right' },
        ]}
      />
      <SegGroup
        label="Vertical align"
        value={style.verticalAlign ?? 'top'}
        onChange={(v) => onAttr('content.style.verticalAlign', v)}
        options={[
          { value: 'top', icon: 'fa-solid fa-arrow-up', title: 'Align top' },
          { value: 'middle', icon: 'fa-solid fa-grip-lines', title: 'Align middle' },
          { value: 'bottom', icon: 'fa-solid fa-arrow-down', title: 'Align bottom' },
        ]}
      />
      <Sep />
      <select
        className="squisq-layer-toolbar-select"
        aria-label="Font size"
        title="Font size"
        value={nearestSize(style.fontSize)}
        onChange={(e) => onAttr('content.style.fontSize', Number(e.target.value))}
      >
        {FONT_SIZES.map(([l, v]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`squisq-layer-toolbar-btn${
          style.fontWeight === 'bold' ? ' squisq-layer-toolbar-btn--active' : ''
        }`}
        aria-label="Bold"
        aria-pressed={style.fontWeight === 'bold'}
        title="Bold"
        onClick={() =>
          onAttr('content.style.fontWeight', style.fontWeight === 'bold' ? 'normal' : 'bold')
        }
      >
        <Icon icon="fa-solid fa-bold" />
      </button>
      <Sep />
      <span className="squisq-layer-toolbar-label">
        <Icon icon="fa-solid fa-font" />
      </span>
      <select
        className="squisq-layer-toolbar-select"
        aria-label="Font"
        title="Font"
        value={style.fontFamily ?? ''}
        onChange={(e) => onAttr('content.style.fontFamily', e.target.value || undefined)}
      >
        <option value="">Default</option>
        {AVAILABLE_FONT_STACKS.map((s) => (
          <option key={s.id} value={s.family}>
            {s.label}
          </option>
        ))}
      </select>
      <Color label="Text color" value={style.color} onChange={(v) => onAttr('content.style.color', v)} />
    </>
  );
}

/** Snap an arbitrary font size to the nearest named preset for the select. */
function nearestSize(size: number): number {
  let best = FONT_SIZES[0][1];
  for (const [, v] of FONT_SIZES) {
    if (Math.abs(v - size) < Math.abs(best - size)) best = v;
  }
  return best;
}

// ─── Shape ──────────────────────────────────────────────────────

function ShapeControls({
  layer,
  onAttr,
}: {
  layer: Layer & { type: 'shape' };
  onAttr: LayerToolbarProps['onAttr'];
}) {
  const c = layer.content;
  return (
    <>
      <select
        className="squisq-layer-toolbar-select"
        aria-label="Shape"
        title="Shape"
        value={c.shape}
        onChange={(e) => onAttr('content.shape', e.target.value)}
      >
        <option value="rect">Rectangle</option>
        <option value="circle">Ellipse</option>
        <option value="line">Line</option>
      </select>
      <Sep />
      <Color
        label="Fill color"
        value={c.fill && c.fill !== 'none' ? c.fill : '#3b82f6'}
        onChange={(v) => onAttr('content.fill', v)}
        clearLabel="No fill"
        onClear={() => onAttr('content.fill', 'none')}
        cleared={!c.fill || c.fill === 'none'}
      />
      <Color
        label="Border color"
        value={c.stroke && c.stroke !== 'none' ? c.stroke : '#1e293b'}
        onChange={(v) => onAttr('content.stroke', v)}
        clearLabel="No border"
        onClear={() => onAttr('content.stroke', 'none')}
        cleared={!c.stroke || c.stroke === 'none'}
      />
    </>
  );
}

// ─── Image ──────────────────────────────────────────────────────

function ImageControls({
  layer,
  onAttr,
}: {
  layer: Layer & { type: 'image' };
  onAttr: LayerToolbarProps['onAttr'];
}) {
  return (
    <select
      className="squisq-layer-toolbar-select"
      aria-label="Image fit"
      title="How the image fills its box"
      value={layer.content.fit ?? 'cover'}
      onChange={(e) => onAttr('content.fit', e.target.value)}
    >
      <option value="cover">Fit: Cover</option>
      <option value="contain">Fit: Contain</option>
      <option value="fill">Fit: Stretch</option>
    </select>
  );
}

// ─── Shared controls ────────────────────────────────────────────

interface SegOption {
  value: string;
  icon: string;
  title: string;
}

function SegGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SegOption[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="squisq-layer-toolbar-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`squisq-layer-toolbar-btn${
            value === o.value ? ' squisq-layer-toolbar-btn--active' : ''
          }`}
          aria-label={o.title}
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          <Icon icon={o.icon} />
        </button>
      ))}
    </div>
  );
}

function Color({
  label,
  value,
  onChange,
  onClear,
  clearLabel,
  cleared,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  cleared?: boolean;
}) {
  return (
    <span className="squisq-layer-toolbar-color" title={label}>
      <input
        type="color"
        aria-label={label}
        value={normalizeColor(value)}
        onChange={(e) => onChange(e.target.value)}
        style={cleared ? { opacity: 0.4 } : undefined}
      />
      {onClear && (
        <button
          type="button"
          className={`squisq-layer-toolbar-btn${cleared ? ' squisq-layer-toolbar-btn--active' : ''}`}
          aria-label={clearLabel ?? 'None'}
          title={clearLabel ?? 'None'}
          onClick={onClear}
        >
          <Icon icon="fa-solid fa-ban" />
        </button>
      )}
    </span>
  );
}

function Sep() {
  return <div className="squisq-layer-toolbar-sep" aria-hidden="true" />;
}

/** Coerce an arbitrary CSS color to a 6-digit hex the color input accepts. */
function normalizeColor(v: string): string {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return '#' + v.slice(1).split('').map((c) => c + c).join('');
  }
  return '#000000';
}
