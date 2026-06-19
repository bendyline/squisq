/**
 * ShapeGlyph — a tiny SVG preview of a shape kind for the Add bin's
 * shape buttons. Uses the same {@link shapePath} geometry the placed
 * `PathLayer` will use, so the button icon matches what lands on the
 * canvas. Native kinds (rect / circle / line) are drawn directly since
 * `shapePath` returns null for them.
 */

import { shapePath } from '@bendyline/squisq/doc';

const W = 30;
const H = 24;
const PAD = 3;

interface ShapeGlyphProps {
  kind: string;
  rounded?: boolean;
}

export function ShapeGlyph({ kind, rounded }: ShapeGlyphProps) {
  const x = PAD;
  const y = PAD;
  const w = W - PAD * 2;
  const h = H - PAD * 2;
  const common = {
    fill: '#e2e8f0',
    stroke: '#475569',
    strokeWidth: 1.5,
  };

  let body;
  if (kind === 'rect') {
    body = <rect x={x} y={y} width={w} height={h} rx={rounded ? 5 : 0} {...common} />;
  } else if (kind === 'circle') {
    body = <ellipse cx={W / 2} cy={H / 2} rx={w / 2} ry={h / 2} {...common} />;
  } else if (kind === 'line') {
    body = <line x1={x} y1={H - PAD} x2={W - PAD} y2={y} stroke="#475569" strokeWidth={2} />;
  } else {
    body = <path d={shapePath(kind, x, y, w, h) ?? ''} {...common} />;
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
}
