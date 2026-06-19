/**
 * LayerToolbar — contextual styling controls for the layer currently
 * selected in the TemplateDesigner. Renders a compact toolbar whose
 * controls depend on the layer type:
 *
 *   - text  → alignment, font size/weight/family, text color, plus a
 *             background fill (color · opacity · gradient) and border
 *             (color · thickness · style) — text is a rectangle too.
 *   - shape → shape kind, fill (color · opacity · gradient), and border
 *             (color · thickness · style).
 *   - image → object-fit.
 *
 * Fill and border editors are shared between text and shapes via
 * {@link FillEditor} / {@link BorderEditor}, parameterized by the dotted
 * attribute paths each layer type uses.
 *
 * Every control dispatches a single `setLayerAttr` via `onAttr(path,
 * value)`, where `path` is a dotted path into the layer (e.g.
 * `content.style.color`). The parent owns the command dispatch and the
 * selected-layer lookup, so this component stays a pure view over the
 * current layer.
 */

import type { Layer, LinearGradient, BorderStyle } from '@bendyline/squisq/schemas';
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
      {layer.type === 'path' && <PathControls layer={layer} onAttr={onAttr} />}
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
        className="squisq-layer-toolbar-select squisq-layer-toolbar-select--font"
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
      <Color
        label="Text color"
        value={style.color}
        onChange={(v) => onAttr('content.style.color', v)}
      />
      <Sep />
      <span className="squisq-layer-toolbar-label" title="Background fill">
        <Icon icon="fa-solid fa-fill-drip" />
      </span>
      <FillEditor
        label="Background"
        color={style.background}
        opacity={style.backgroundOpacity}
        gradient={style.backgroundGradient}
        defaultColor="#1f2937"
        noFillValue={undefined}
        colorPath="content.style.background"
        opacityPath="content.style.backgroundOpacity"
        gradientPath="content.style.backgroundGradient"
        onAttr={onAttr}
      />
      <Sep />
      <span className="squisq-layer-toolbar-label" title="Border">
        <Icon icon="fa-solid fa-border-top-left" />
      </span>
      <BorderEditor
        color={style.borderColor}
        width={style.borderWidth}
        style={style.borderStyle}
        defaultColor="#1e293b"
        noBorderValue={undefined}
        colorPath="content.style.borderColor"
        widthPath="content.style.borderWidth"
        stylePath="content.style.borderStyle"
        onAttr={onAttr}
      />
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

// ─── Shape (native) + Path (computed shape) ─────────────────────

/**
 * Fill + border controls shared by native `ShapeLayer`s and computed
 * `PathLayer` shapes — both keep fill/stroke under the same
 * `content.*` paths, so the editor is identical.
 */
function FillBorderControls({
  content,
  onAttr,
}: {
  content: {
    fill?: string;
    fillOpacity?: number;
    gradient?: LinearGradient;
    stroke?: string;
    strokeWidth?: number;
    borderStyle?: BorderStyle;
  };
  onAttr: LayerToolbarProps['onAttr'];
}) {
  return (
    <>
      <span className="squisq-layer-toolbar-label" title="Fill">
        <Icon icon="fa-solid fa-fill-drip" />
      </span>
      <FillEditor
        label="Fill"
        color={content.fill}
        opacity={content.fillOpacity}
        gradient={content.gradient}
        defaultColor="#3b82f6"
        noFillValue="none"
        colorPath="content.fill"
        opacityPath="content.fillOpacity"
        gradientPath="content.gradient"
        onAttr={onAttr}
      />
      <Sep />
      <span className="squisq-layer-toolbar-label" title="Border">
        <Icon icon="fa-solid fa-border-top-left" />
      </span>
      <BorderEditor
        color={content.stroke}
        width={content.strokeWidth}
        style={content.borderStyle}
        defaultColor="#1e293b"
        noBorderValue="none"
        colorPath="content.stroke"
        widthPath="content.strokeWidth"
        stylePath="content.borderStyle"
        onAttr={onAttr}
      />
    </>
  );
}

function ShapeControls({
  layer,
  onAttr,
}: {
  layer: Layer & { type: 'shape' };
  onAttr: LayerToolbarProps['onAttr'];
}) {
  return (
    <>
      <select
        className="squisq-layer-toolbar-select"
        aria-label="Shape"
        title="Shape"
        value={layer.content.shape}
        onChange={(e) => onAttr('content.shape', e.target.value)}
      >
        <option value="rect">Rectangle</option>
        <option value="circle">Ellipse</option>
        <option value="line">Line</option>
      </select>
      <Sep />
      <FillBorderControls content={layer.content} onAttr={onAttr} />
    </>
  );
}

function PathControls({
  layer,
  onAttr,
}: {
  layer: Layer & { type: 'path' };
  onAttr: LayerToolbarProps['onAttr'];
}) {
  // Computed shapes (diamond, star, arrows…) carry the same fill/stroke
  // fields as native shapes — no shape-kind select since the geometry is
  // fixed by the placed shape.
  return <FillBorderControls content={layer.content} onAttr={onAttr} />;
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

// ─── Fill editor (color · opacity · gradient) ───────────────────

const GRADIENT_DIRECTIONS: Array<[string, number, string]> = [
  ['↓', 0, 'Top to bottom'],
  ['→', 90, 'Left to right'],
  ['↘', 45, 'Diagonal ↘'],
  ['↙', 135, 'Diagonal ↙'],
];

function FillEditor({
  label,
  color,
  opacity,
  gradient,
  defaultColor,
  noFillValue,
  colorPath,
  opacityPath,
  gradientPath,
  onAttr,
}: {
  label: string;
  color: string | undefined;
  opacity: number | undefined;
  gradient: LinearGradient | undefined;
  /** Solid swatch shown when no color is set yet. */
  defaultColor: string;
  /** Value written when the user clears the fill (`'none'` for shapes,
   *  `undefined` for text backgrounds). */
  noFillValue: 'none' | undefined;
  colorPath: string;
  opacityPath: string;
  gradientPath: string;
  onAttr: LayerToolbarProps['onAttr'];
}) {
  const isGradient = !!gradient;
  const swatch = color && color !== 'none' ? color : defaultColor;
  return (
    <>
      <select
        className="squisq-layer-toolbar-select"
        aria-label={`${label} style`}
        title={`${label} style`}
        value={isGradient ? 'gradient' : 'solid'}
        onChange={(e) => {
          if (e.target.value === 'gradient') {
            onAttr(gradientPath, { from: swatch, to: '#ffffff', angle: 0 });
          } else {
            onAttr(gradientPath, undefined);
          }
        }}
      >
        <option value="solid">Solid</option>
        <option value="gradient">Gradient</option>
      </select>
      {isGradient ? (
        <>
          <Color
            label={`${label} start color`}
            value={gradient!.from}
            onChange={(v) => onAttr(gradientPath, { ...gradient, from: v })}
          />
          <Color
            label={`${label} end color`}
            value={gradient!.to}
            onChange={(v) => onAttr(gradientPath, { ...gradient, to: v })}
          />
          <select
            className="squisq-layer-toolbar-select"
            aria-label={`${label} direction`}
            title={`${label} direction`}
            value={String(gradient!.angle ?? 0)}
            onChange={(e) => onAttr(gradientPath, { ...gradient, angle: Number(e.target.value) })}
          >
            {GRADIENT_DIRECTIONS.map(([glyph, deg, title]) => (
              <option key={deg} value={deg} title={title}>
                {glyph}
              </option>
            ))}
          </select>
        </>
      ) : (
        <Color
          label={`${label} color`}
          value={swatch}
          onChange={(v) => onAttr(colorPath, v)}
          clearLabel="No fill"
          onClear={() => onAttr(colorPath, noFillValue)}
          cleared={!color || color === 'none'}
        />
      )}
      <Opacity
        label={`${label} opacity`}
        value={opacity}
        onChange={(v) => onAttr(opacityPath, v)}
      />
    </>
  );
}

// ─── Border editor (color · thickness · style) ──────────────────

function BorderEditor({
  color,
  width,
  style,
  defaultColor,
  noBorderValue,
  colorPath,
  widthPath,
  stylePath,
  onAttr,
}: {
  color: string | undefined;
  width: number | undefined;
  style: BorderStyle | undefined;
  defaultColor: string;
  noBorderValue: 'none' | undefined;
  colorPath: string;
  widthPath: string;
  stylePath: string;
  onAttr: LayerToolbarProps['onAttr'];
}) {
  return (
    <>
      <Color
        label="Border color"
        value={color && color !== 'none' ? color : defaultColor}
        onChange={(v) => onAttr(colorPath, v)}
        clearLabel="No border"
        onClear={() => onAttr(colorPath, noBorderValue)}
        cleared={!color || color === 'none'}
      />
      <input
        type="number"
        className="squisq-layer-toolbar-number"
        aria-label="Border thickness"
        title="Border thickness"
        min={0}
        max={80}
        step={1}
        value={width ?? 0}
        onChange={(e) => onAttr(widthPath, Number(e.target.value))}
      />
      <select
        className="squisq-layer-toolbar-select"
        aria-label="Border style"
        title="Border style"
        value={style ?? 'solid'}
        onChange={(e) => onAttr(stylePath, e.target.value)}
      >
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
    </>
  );
}

function Opacity({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const pct = Math.round((value ?? 1) * 100);
  return (
    <label className="squisq-layer-toolbar-opacity" title={`${label} (${pct}%)`}>
      <input
        type="range"
        aria-label={label}
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
    </label>
  );
}

function Sep() {
  return <div className="squisq-layer-toolbar-sep" aria-hidden="true" />;
}

/** Coerce an arbitrary CSS color to a 6-digit hex the color input accepts. */
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
