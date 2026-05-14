/**
 * SVG renderer for an `ImageEditLayer` of kind `text` inside the editor.
 *
 * Multi-line text is laid out as a `<text>` element with one `<tspan>`
 * per line. The first line sits at `y + fontSize` so the visible top
 * of the glyph block aligns with the layer's `y` coordinate (matches
 * what users expect from a top-anchored bounding box).
 */

import type { ImageEditCanvas, ImageEditLayer } from '@bendyline/squisq/schemas';

interface Props {
  layer: ImageEditLayer & { type: 'text' };
  canvas: ImageEditCanvas;
}

export function EditorTextLayer({ layer, canvas: _canvas }: Props) {
  const p = layer.position;
  const x = typeof p.x === 'number' ? p.x : 0;
  const y = typeof p.y === 'number' ? p.y : 0;
  const { text, style } = layer.content;
  const lineHeight = style.lineHeight ?? 1.4;
  const lineHeightPx = style.fontSize * lineHeight;
  const lines = (text ?? '').split('\n');
  const textAnchor =
    style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start';

  return (
    <text
      x={x}
      y={y + style.fontSize}
      fontFamily={style.fontFamily ?? 'sans-serif'}
      fontSize={style.fontSize}
      fontWeight={style.fontWeight ?? 'normal'}
      fill={style.color}
      textAnchor={textAnchor}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineHeightPx}>
          {line || '\u00A0'}
        </tspan>
      ))}
    </text>
  );
}
