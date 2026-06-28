/**
 * ScenePropsBar — compact, inline per-selection style controls that live
 * INSIDE the contextual toolbar (next to the tool / create buttons), rather
 * than in a separate floating panel.
 *
 * It's intentionally generic: the host (SceneBlockWidget / DiagramWidget)
 * decides what the current selection exposes — color swatches (Fill / Stroke
 * / text Color) and/or dropdowns (a connector's markers, line style, routing)
 * — and passes them as plain `colors` / `selects` descriptors. Renders
 * nothing when the selection has no styleable props.
 */

interface ScenePropColor {
  label: string;
  /** Current color (`#rrggbb`); shown in the swatch. */
  value?: string;
  /** Show a "none" button that clears the color (emits `'none'`). */
  allowNone?: boolean;
  onChange: (value: string) => void;
}

interface ScenePropSelect {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}

export interface ScenePropsBarProps {
  colors?: readonly ScenePropColor[];
  selects?: readonly ScenePropSelect[];
}

export function ScenePropsBar({ colors = [], selects = [] }: ScenePropsBarProps) {
  if (colors.length === 0 && selects.length === 0) return null;
  return (
    <div className="squisq-scene-block-props" role="group" aria-label="Selection style">
      {colors.map((c) => (
        <span className="squisq-scene-prop" key={c.label}>
          <span className="squisq-scene-prop-label">{c.label}</span>
          <input
            type="color"
            className="squisq-scene-prop-color"
            aria-label={`${c.label} color`}
            value={toHexInput(c.value)}
            onChange={(e) => c.onChange(e.target.value)}
          />
          {c.allowNone && (
            <button
              type="button"
              className="squisq-scene-prop-clear"
              onClick={() => c.onChange('none')}
            >
              none
            </button>
          )}
        </span>
      ))}
      {selects.map((s) => (
        <label className="squisq-scene-prop" key={s.label}>
          <span className="squisq-scene-prop-label">{s.label}</span>
          <select
            className="squisq-scene-prop-select"
            value={s.value}
            onChange={(e) => s.onChange(e.target.value)}
          >
            {s.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

/** Coerce an arbitrary color (or `none`/undefined) to a `#rrggbb` the native
 * color input can display. Non-hex values fall back to black. */
function toHexInput(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

export default ScenePropsBar;
