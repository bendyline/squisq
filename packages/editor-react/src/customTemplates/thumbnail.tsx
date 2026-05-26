/**
 * Custom-template thumbnails for the picker gallery.
 *
 * Renders a CustomTemplateDefinition's layers in a small SVG that
 * matches the picker card's icon slot (56×40). Layers are rendered via
 * the same `RenderLayer` the editor canvas uses, so the thumbnail is
 * an accurate (just smaller) preview.
 *
 * Tokens are NOT resolved — the thumbnail shows placeholder strings
 * (`{title}`, `{content}`) so the user can see what fields the
 * template will fill in. That's the point of a template preview.
 */

import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';
import { RenderLayer } from '../scene/layers/renderLayer';

const W = 56;
const H = 40;

interface TemplateThumbnailProps {
  def: CustomTemplateDefinition;
  /** Override width / height (defaults match the picker icon slot). */
  width?: number;
  height?: number;
}

export function TemplateThumbnail({ def, width = W, height = H }: TemplateThumbnailProps) {
  // The SVG renders the template's authoring viewport as its viewBox,
  // so a 1920×1080 design becomes a 56×40 preview at the same aspect.
  // `preserveAspectRatio="xMidYMid meet"` letterboxes when the
  // requested width/height don't match — important for very narrow or
  // very wide custom canvases.
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${def.viewport.width} ${def.viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="squisq-template-thumbnail"
      aria-hidden="true"
    >
      {/* Background so an all-text template doesn't paint over the card. */}
      <rect width={def.viewport.width} height={def.viewport.height} fill="#f8fafc" />
      {def.layers.map((layer) => (
        <g key={layer.id}>
          <RenderLayer layer={layer} viewport={def.viewport} />
        </g>
      ))}
      {/* Subtle 1px border in viewport-space so the preview stays
          distinguishable from the picker card around it. */}
      <rect
        x={0}
        y={0}
        width={def.viewport.width}
        height={def.viewport.height}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
