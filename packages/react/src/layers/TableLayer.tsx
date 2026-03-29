/**
 * TableLayer Component
 *
 * Renders a data table within an SVG block using a <foreignObject> to embed
 * an HTML table. This gives us native table layout inside SVG viewports.
 *
 * The table is styled inline using the TableLayerStyle properties, which are
 * typically derived from the active theme by the dataTable template.
 */

import type { TableLayer as TableLayerType } from '@bendyline/squisq/schemas';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { getAnimationStyle } from '../utils/animationUtils';

interface TableLayerProps {
  layer: TableLayerType;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start (for animation) */
  blockTime: number;
}

export function TableLayer({ layer, viewport, blockTime }: TableLayerProps) {
  const { content, position, animation } = layer;
  const { headers, rows, align, style } = content;

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height
    ? resolveValue(position.height, viewport.height)
    : viewport.height;

  // Apply anchor offset
  const offset = getAnchorOffset(position.anchor, width, height);
  const finalX = x + offset.x;
  const finalY = y + offset.y;

  // Build animation style
  const animStyle = animation ? getAnimationStyle(animation, blockTime) : {};

  const cellAlign = (ci: number): React.CSSProperties | undefined => {
    const a = align?.[ci];
    return a ? { textAlign: a } : undefined;
  };

  const borderRadius = style.borderRadius ?? 8;

  return (
    <foreignObject
      x={finalX}
      y={finalY}
      width={width}
      height={height}
      style={animStyle}
    >
      <div
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as any)}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          boxSizing: 'border-box',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: `${style.fontSize}px`,
            fontFamily: style.fontFamily ?? 'system-ui, sans-serif',
            overflow: 'hidden',
            borderRadius: `${borderRadius}px`,
            border: `1px solid ${style.borderColor}`,
          }}
        >
          {headers.length > 0 && (
            <thead>
              <tr>
                {headers.map((header, ci) => (
                  <th
                    key={ci}
                    style={{
                      background: style.headerBackground,
                      color: style.headerColor,
                      fontFamily: style.headerFontFamily ?? style.fontFamily ?? 'system-ui, sans-serif',
                      fontWeight: 600,
                      padding: '12px 16px',
                      borderBottom: `2px solid ${style.borderColor}`,
                      borderRight: ci < headers.length - 1 ? `1px solid ${style.borderColor}` : undefined,
                      ...cellAlign(ci),
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          {rows.length > 0 && (
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        background: style.cellBackground,
                        color: style.cellColor,
                        padding: '10px 16px',
                        borderBottom: ri < rows.length - 1 ? `1px solid ${style.borderColor}` : undefined,
                        borderRight: ci < row.length - 1 ? `1px solid ${style.borderColor}` : undefined,
                        ...cellAlign(ci),
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </foreignObject>
  );
}
