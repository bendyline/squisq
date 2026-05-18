/**
 * SVG renderer for an `ImageEditLayer` of kind `shape` inside the editor.
 * Mirrors `react/src/layers/ShapeLayer.tsx` minus the animation/anchor
 * logic since the editor authors layers with numeric, top-left positions.
 */

import type { ImageEditCanvas, ImageEditLayer } from '@bendyline/squisq/schemas';

interface Props {
  layer: ImageEditLayer & { type: 'shape' };
  canvas: ImageEditCanvas;
}

export function EditorShapeLayer({ layer, canvas: _canvas }: Props) {
  const p = layer.position;
  const x = typeof p.x === 'number' ? p.x : 0;
  const y = typeof p.y === 'number' ? p.y : 0;
  const width = typeof p.width === 'number' ? p.width : 100;
  const height = typeof p.height === 'number' ? p.height : 100;
  const c = layer.content;
  const fill = c.fill ?? 'none';
  const stroke = c.stroke;
  const strokeWidth = c.strokeWidth;

  if (c.shape === 'rect') {
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={c.borderRadius}
        ry={c.borderRadius}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (c.shape === 'circle') {
    return (
      <circle
        cx={x + width / 2}
        cy={y + height / 2}
        r={Math.min(width, height) / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  return (
    <line
      x1={x}
      y1={y}
      x2={x + width}
      y2={y + height}
      stroke={stroke ?? '#000'}
      strokeWidth={strokeWidth ?? 1}
    />
  );
}
