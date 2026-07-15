import type { CSSProperties } from 'react';
import type { MermaidLayer as MermaidLayerType, Theme } from '@bendyline/squisq/schemas';
import { MermaidDiagram } from '../mermaid/MermaidDiagram.js';
import { getAnimationStyle } from '../utils/animationUtils.js';
import { resolveValue } from '../utils/layerUtils.js';

interface MermaidLayerProps {
  layer: MermaidLayerType;
  viewport: { width: number; height: number };
  blockTime: number;
  theme?: Theme;
}

/** Mermaid diagram hosted in HTML inside the slide SVG. */
export function MermaidLayer({ layer, viewport, blockTime, theme }: MermaidLayerProps) {
  const { position, content, animation } = layer;
  const width = resolveValue(position.width ?? viewport.width, viewport.width);
  const height = resolveValue(position.height ?? viewport.height, viewport.height);
  let x = resolveValue(position.x, viewport.width);
  let y = resolveValue(position.y, viewport.height);
  const anchor = position.anchor ?? 'top-left';
  if (anchor === 'center') {
    x -= width / 2;
    y -= height / 2;
  } else {
    if (anchor.endsWith('right')) x -= width;
    if (anchor.startsWith('bottom')) y -= height;
  }

  const animStyle = getAnimationStyle(animation, blockTime);
  const panelStyle: CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    padding: content.padding ?? 16,
    borderRadius: 16,
    background: content.background,
    color: content.foreground,
    overflow: 'hidden',
  };

  return (
    <g
      className={`block-layer block-layer--mermaid ${animStyle.className}`}
      data-layer-id={layer.id}
      style={animStyle.style}
    >
      <foreignObject x={x} y={y} width={width} height={height}>
        <div
          {...({ xmlns: 'http://www.w3.org/1999/xhtml' } as Record<string, string>)}
          className="squisq-mermaid-layer-frame"
          style={panelStyle}
        >
          <MermaidDiagram
            source={content.source}
            ariaLabel="Mermaid diagram on slide"
            theme={theme}
          />
        </div>
      </foreignObject>
    </g>
  );
}
