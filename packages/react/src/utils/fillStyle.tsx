/**
 * Shared fill / border helpers for the SVG layer renderers (shape, path,
 * and the text-box background). Keeping the gradient `<defs>` markup and
 * the dash-pattern math in one place means rect, circle, path, and text
 * all paint fills and borders identically.
 */

import type {
  LinearGradient,
  BorderStyle,
  ShapePattern,
  ShapeFilter,
} from '@bendyline/squisq/schemas';

/**
 * SVG `stroke-dasharray` for a border style, scaled by stroke width so the
 * pattern stays proportional. `solid`/undefined → no dashes.
 */
export function borderDashArray(
  style: BorderStyle | undefined,
  strokeWidth: number | undefined,
): string | undefined {
  if (!style || style === 'solid') return undefined;
  const w = Math.max(1, strokeWidth ?? 1);
  if (style === 'dotted') return `${w} ${w * 2}`;
  return `${w * 3} ${w * 2}`; // dashed
}

/**
 * Gradient line endpoints in objectBoundingBox units (0–1) for an angle in
 * degrees: 0 = top→bottom, 90 = left→right, increasing clockwise.
 */
function gradientVector(angle = 0): { x1: number; y1: number; x2: number; y2: number } {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = Math.cos(a);
  return { x1: 0.5 - dx / 2, y1: 0.5 - dy / 2, x2: 0.5 + dx / 2, y2: 0.5 + dy / 2 };
}

/** Stable id for a layer's gradient def. */
export function gradientDefId(layerId: string): string {
  return `squisq-grad-${layerId}`;
}

/**
 * Resolve a fill to an SVG `fill` value plus the gradient `<defs>` to
 * render (or null). When a gradient is present it wins over the solid
 * color; otherwise the color (or undefined) is returned verbatim.
 */
export function resolveFill(
  layerId: string,
  color: string | undefined,
  gradient: LinearGradient | undefined,
  pattern?: ShapePattern,
): { fill: string | undefined; def: JSX.Element | null } {
  if (pattern) {
    const id = `squisq-pattern-${layerId}`;
    return { fill: `url(#${id})`, def: patternDef(id, pattern) };
  }
  if (gradient) {
    const id = gradientDefId(layerId);
    const v = gradientVector(gradient.angle);
    return {
      fill: `url(#${id})`,
      def: (
        <linearGradient id={id} x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}>
          <stop offset="0%" stopColor={gradient.from} />
          <stop offset="100%" stopColor={gradient.to} />
        </linearGradient>
      ),
    };
  }
  return { fill: color, def: null };
}

/**
 * Native SVG `<pattern>` def for a repeating shape fill — fully vector,
 * identical in the player and headless frame capture.
 */
function patternDef(id: string, pattern: ShapePattern): JSX.Element {
  const size = pattern.size ?? 24;
  const opacity = pattern.opacity ?? 1;
  const color = pattern.color;
  return (
    <pattern
      id={id}
      width={size}
      height={size}
      patternUnits="userSpaceOnUse"
      // Diagonal tiles rotate the whole pattern; dots/grid stay axis-aligned.
      patternTransform={pattern.kind === 'diagonal' ? 'rotate(45)' : undefined}
    >
      {pattern.kind === 'dots' && (
        <circle cx={size / 2} cy={size / 2} r={Math.max(1, size / 12)} fill={color} opacity={opacity} />
      )}
      {pattern.kind === 'grid' && (
        <path
          d={`M ${size} 0 L 0 0 0 ${size}`}
          fill="none"
          stroke={color}
          strokeWidth={1}
          opacity={opacity}
        />
      )}
      {pattern.kind === 'diagonal' && (
        <line x1={0} y1={0} x2={0} y2={size} stroke={color} strokeWidth={1} opacity={opacity} />
      )}
    </pattern>
  );
}

/**
 * SVG filter def for a shape's procedural filter (static film grain via
 * feTurbulence). Returns the def plus the `filter` attribute value.
 */
export function resolveShapeFilter(
  layerId: string,
  filter: ShapeFilter | undefined,
): { filterAttr: string | undefined; def: JSX.Element | null } {
  if (!filter || filter.type !== 'noise') return { filterAttr: undefined, def: null };
  const id = `squisq-noise-${layerId}`;
  const opacity = filter.opacity ?? 0.05;
  return {
    filterAttr: `url(#${id})`,
    def: (
      <filter id={id} x="0%" y="0%" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={filter.baseFrequency ?? 0.8}
          numOctaves={2}
          stitchTiles="stitch"
          result="noise"
        />
        <feColorMatrix in="noise" type="saturate" values="0" result="mono" />
        <feComponentTransfer in="mono" result="faded">
          <feFuncA type="linear" slope={opacity} intercept={0} />
        </feComponentTransfer>
        <feComposite in="faded" in2="SourceGraphic" operator="in" />
      </filter>
    ),
  };
}
