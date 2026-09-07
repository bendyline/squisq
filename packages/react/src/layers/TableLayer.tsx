/**
 * TableLayer Component
 *
 * Renders a data table within an SVG block using a <foreignObject> to embed
 * an HTML table. This gives us native table layout inside SVG viewports.
 *
 * The table is styled inline using the TableLayerStyle properties, which are
 * typically derived from the active theme by the dataTable template.
 */

import type { ComponentType, ReactNode } from 'react';
import type { Block, TableLayer as TableLayerType } from '@bendyline/squisq/schemas';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { getAnimationStyle } from '../utils/animationUtils';

export interface TableLayerContentRendererProps {
  /** Owning block, including sourceBlockId for transformed projections. */
  block: Block;
  layer: TableLayerType;
  width: number;
  height: number;
  /** Native themed table used while custom data is unavailable. */
  fallback: ReactNode;
}

export type TableLayerContentRenderer = ComponentType<TableLayerContentRendererProps>;

interface TableLayerProps {
  /** Owning block (custom renderers use its id to resolve sidecar data). */
  block?: Block;
  layer: TableLayerType;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start (for animation) */
  blockTime: number;
  /** Optional host renderer for interactive table content. */
  contentRenderer?: TableLayerContentRenderer;
}

export function TableLayer({
  block,
  layer,
  viewport,
  blockTime,
  contentRenderer,
}: TableLayerProps) {
  const { content, position, animation } = layer;
  const { align, style } = content;
  // Layers can briefly carry unresolved or malformed data at runtime even
  // though the static schema requires both arrays. Never let a preview take
  // down the entire React tree while its data sidecar is still loading.
  const headers = Array.isArray(content.headers) ? content.headers : [];
  const rows = Array.isArray(content.rows) ? content.rows : [];

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;

  // Apply anchor offset
  const offset = getAnchorOffset(position.anchor, width, height);
  const finalX = x + offset.x;
  const finalY = y + offset.y;

  // Build animation style. `getAnimationStyle` returns `{ className, style }`:
  // the class carries the keyframes and the style carries its CSS custom
  // properties, so the two must be applied to a real element separately.
  const animStyle = getAnimationStyle(animation, blockTime);

  const cellAlign = (ci: number): React.CSSProperties | undefined => {
    const a = align?.[ci];
    return a ? { textAlign: a } : undefined;
  };

  const borderRadius = style.borderRadius ?? 8;
  // Keep the layout heuristic in the dataTable template and the rendered row
  // box in sync: 1.2 line-height + 0.6em padding above and below = 2.4em.
  const verticalCellPadding = style.fontSize * 0.6;
  const horizontalCellPadding = style.fontSize * 0.75;

  const nativeTable = (
    <table
      style={{
        width: 'max-content',
        minWidth: '100%',
        borderCollapse: 'separate',
        borderSpacing: 0,
        fontSize: `${style.fontSize}px`,
        fontFamily: style.fontFamily ?? 'system-ui, sans-serif',
        lineHeight: 1.2,
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
                  padding: `${verticalCellPadding}px ${horizontalCellPadding}px`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  whiteSpace: 'nowrap',
                  borderBottom: `2px solid ${style.borderColor}`,
                  borderRight:
                    ci < headers.length - 1 ? `1px solid ${style.borderColor}` : undefined,
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
                    padding: `${verticalCellPadding}px ${horizontalCellPadding}px`,
                    whiteSpace: 'nowrap',
                    borderBottom:
                      ri < rows.length - 1 ? `1px solid ${style.borderColor}` : undefined,
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
  );

  const ContentRenderer = block ? contentRenderer : undefined;

  return (
    <g
      className={`block-layer block-layer--table ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={layer.id}
    >
      <foreignObject x={finalX} y={finalY} width={width} height={height}>
        <div
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as any)}
          className="squisq-table-scroll"
          role="region"
          aria-label="Scrollable data table"
          tabIndex={0}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            boxSizing: 'border-box',
            overflow: ContentRenderer ? 'hidden' : 'auto',
            overscrollBehavior: 'contain',
            scrollbarGutter: 'stable',
            border: ContentRenderer ? undefined : `1px solid ${style.borderColor}`,
            borderRadius: `${borderRadius}px`,
            background: ContentRenderer ? 'transparent' : style.cellBackground,
          }}
        >
          {ContentRenderer ? (
            <ContentRenderer
              block={block!}
              layer={layer}
              width={width}
              height={height}
              fallback={nativeTable}
            />
          ) : (
            nativeTable
          )}
        </div>
      </foreignObject>
    </g>
  );
}
