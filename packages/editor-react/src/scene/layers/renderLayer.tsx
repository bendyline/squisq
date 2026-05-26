/**
 * renderLayer — render a single Layer for the editor surface.
 *
 * Reuses the SSR layer components from `@bendyline/squisq-react` so what
 * the editor shows matches what the final block render produces. The
 * Scene already runs inside an SVG group with the viewport transform
 * applied, so the SSR components — which assume they're rendered inside
 * a `<svg>` with the viewport in user units — drop in unmodified.
 *
 * Editor decorations (the selection outline, drag handles) are NOT
 * rendered here. The Scene renders the SceneSelection overlay separately
 * so a layer's bounding rect can be highlighted without modifying the
 * layer's own DOM.
 */

import {
  ImageLayer,
  TextLayer,
  ShapeLayer,
  PathLayer,
  VideoLayer,
  MapLayer,
  TableLayer,
} from '@bendyline/squisq-react';
import type { Layer } from '@bendyline/squisq/schemas';

interface RenderLayerProps {
  layer: Layer;
  viewport: { width: number; height: number };
  /**
   * Layer renderers accept a `blockTime` to drive Ken Burns / animations.
   * In editor mode we always pin to t=0 so static positions are shown
   * (no Ken Burns drift) and selection outlines stay aligned.
   */
  blockTime?: number;
  /**
   * Base path for resolving media URLs (image / video / map tile cache).
   * Defaults to empty — the host should pass the same value used by the
   * preview renderer so editor and preview show identical content.
   */
  basePath?: string;
}

export function RenderLayer({
  layer,
  viewport,
  blockTime = 0,
  basePath = '',
}: RenderLayerProps) {
  switch (layer.type) {
    case 'image':
      return (
        <ImageLayer layer={layer} viewport={viewport} blockTime={blockTime} basePath={basePath} />
      );
    case 'text':
      return <TextLayer layer={layer} viewport={viewport} blockTime={blockTime} />;
    case 'shape':
      return <ShapeLayer layer={layer} viewport={viewport} blockTime={blockTime} />;
    case 'path':
      return <PathLayer layer={layer} viewport={viewport} blockTime={blockTime} />;
    case 'video':
      return (
        <VideoLayer layer={layer} viewport={viewport} blockTime={blockTime} basePath={basePath} />
      );
    case 'map':
      return (
        <MapLayer layer={layer} viewport={viewport} blockTime={blockTime} basePath={basePath} />
      );
    case 'table':
      return <TableLayer layer={layer} viewport={viewport} blockTime={blockTime} />;
    default:
      // Exhaustiveness check — TypeScript will flag any unhandled types.
      return null;
  }
}
