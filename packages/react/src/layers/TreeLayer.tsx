/**
 * TreeLayer Component
 *
 * Renders a hierarchical treeview inside an SVG block via a <foreignObject>
 * (same technique as TableLayer) — a filesystem-style outline with
 * folder/file icons, indentation guide rails, and collapse chevrons.
 *
 * Interactive in the live React player: clicking a folder chevron
 * collapses/expands it (local component state, default fully expanded).
 * Headless frame / PDF capture renders the default expanded DOM statically,
 * so exports are deterministic.
 */

import { useState } from 'react';
import type { TreeLayer as TreeLayerType, TreeLayerItem } from '@bendyline/squisq/schemas';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { getAnimationStyle } from '../utils/animationUtils';

interface TreeLayerProps {
  layer: TreeLayerType;
  viewport: { width: number; height: number };
  blockTime: number;
}

/** FontAwesome class from a bare name (`folder`) or qualified (`fa-solid:folder`). */
function faClass(token: string | undefined, fallback: string): string {
  const name = token && token.trim() ? token.trim() : fallback;
  const colon = name.indexOf(':');
  if (colon > 0) {
    const family = name.slice(0, colon).replace(/^fa-/, '');
    return `fa-${family} fa-${name.slice(colon + 1)}`;
  }
  return `fa-solid fa-${name}`;
}

export function TreeLayer({ layer, viewport, blockTime }: TreeLayerProps) {
  const { content, position, animation } = layer;
  const { items, style } = content;

  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;
  const offset = getAnchorOffset(position.anchor, width, height);
  // `getAnimationStyle` returns `{ className, style }`: the class carries the
  // keyframes and the style carries its CSS custom properties, so the two must
  // be applied to a real element separately.
  const animStyle = getAnimationStyle(animation, blockTime);

  return (
    <g
      className={`block-layer block-layer--tree ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={layer.id}
    >
      <foreignObject x={x + offset.x} y={y + offset.y} width={width} height={height}>
        <div
          {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as Record<string, string>)}
          className="squisq-treelayer"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '24px 32px',
            boxSizing: 'border-box',
            fontFamily: style.fontFamily ?? 'system-ui, sans-serif',
            fontSize: `${style.fontSize}px`,
            lineHeight: 1.7,
            overflow: 'hidden',
          }}
        >
          <TreeList items={items} depth={0} style={style} />
        </div>
      </foreignObject>
    </g>
  );
}

function TreeList({
  items,
  depth,
  style,
}: {
  items: TreeLayerItem[];
  depth: number;
  style: TreeLayerType['content']['style'];
}) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        paddingLeft: depth === 0 ? 0 : `${style.indentPx}px`,
        borderLeft: depth === 0 ? 'none' : `1px solid ${style.connectorColor}`,
      }}
    >
      {items.map((item) => (
        <TreeRow key={item.id} item={item} style={style} />
      ))}
    </ul>
  );
}

function TreeRow({
  item,
  style,
}: {
  item: TreeLayerItem;
  style: TreeLayerType['content']['style'];
}) {
  const hasChildren = item.children.length > 0;
  const [collapsed, setCollapsed] = useState(false);
  const isDir = item.isDir || hasChildren;
  const iconCls = isDir
    ? faClass(style.folderIcon, collapsed ? 'folder' : 'folder-open')
    : faClass(style.fileIcon, 'file');

  return (
    <li style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', padding: '1px 0' }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed((c) => !c)}
            style={{
              flex: '0 0 auto',
              width: '1em',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: style.connectorColor,
              padding: 0,
              fontSize: '0.8em',
            }}
          >
            <i
              className={`fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span style={{ flex: '0 0 auto', width: '1em' }} />
        )}
        <i
          className={iconCls}
          aria-hidden="true"
          style={{ flex: '0 0 auto', color: style.iconColor, width: '1.2em', textAlign: 'center' }}
        />
        <span
          style={{ color: isDir ? style.dirColor : style.rowColor, fontWeight: isDir ? 600 : 400 }}
        >
          {item.label}
        </span>
        {item.comment ? (
          <span style={{ color: style.commentColor, fontSize: '0.85em', fontStyle: 'italic' }}>
            {item.comment}
          </span>
        ) : null}
      </div>
      {hasChildren && !collapsed ? (
        <TreeList items={item.children} depth={1} style={style} />
      ) : null}
    </li>
  );
}
