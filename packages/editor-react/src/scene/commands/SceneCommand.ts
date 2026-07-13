/**
 * SceneCommand — the union of edits a Scene tool can request.
 *
 * Tools never mutate state directly. They produce a SceneCommand and the
 * host adapter (DiagramAdapter / LayoutAdapter / DrawingAdapter) decides
 * how to apply it — for diagrams that means a Tiptap transaction that
 * updates a heading's Pandoc attrs; for layouts/drawings it's a write to
 * the heading's `dataLayers` attr.
 *
 * Keeping the command shape adapter-agnostic is what lets the same Scene
 * component drive three different editing surfaces.
 */

import type { DiagramEdgeAnchor, Layer } from '@bendyline/squisq/schemas';

export type SceneCommand =
  /** Commit a layer's new top-left position (in viewport units). */
  | { kind: 'moveLayer'; id: string; x: number; y: number }
  /** Commit a layer's new size (in viewport units). */
  | { kind: 'resizeLayer'; id: string; width: number; height: number }
  /** Append a new layer to the scene. */
  | { kind: 'addLayer'; layer: Layer }
  /** Remove a layer by id. */
  | { kind: 'removeLayer'; id: string }
  /**
   * Set a single attribute on a layer. `path` is a dotted path into the
   * layer object (e.g. `content.text`, `content.style.fontSize`). The
   * adapter is responsible for translating this to a domain-appropriate
   * write (markdown attr, JSON-encoded override, etc.).
   */
  | { kind: 'setLayerAttr'; id: string; path: string; value: unknown }
  /** Create an edge between two diagram nodes (diagram mode only). */
  | { kind: 'addEdge'; source: string; target: string; type?: string }
  /** Remove an edge by source/target (and optional type). */
  | { kind: 'removeEdge'; source: string; target: string; type?: string }
  /**
   * Rename a labeled layer (e.g. a diagram node card or a TextLayer). The
   * adapter decides whether this writes to TextLayer.content.text, a
   * heading's text content, or something else.
   */
  | { kind: 'renameLayer'; id: string; label: string }
  /**
   * Set a text layer's content from the inline editor. `text` is the plain
   * projection (always written); `html` is the optional rich representation
   * (stored by adapters that can persist it — layout). Adapters that only
   * keep plain text (diagram/drawing headings) ignore `html`.
   */
  | { kind: 'setLayerText'; id: string; text: string; html?: string };

/**
 * An edge in diagram mode. Lives outside the Layer schema because edges
 * are derived from a node's `connectsTo` rather than being authored as
 * top-level visual layers — the Scene renders them as PathLayers, but
 * the adapter never writes a PathLayer to the markdown.
 */
export interface SceneEdge {
  /** Stable edge id (`source->target` or `source->target:type`). */
  id: string;
  source: string;
  target: string;
  /** Optional label, rendered at the midpoint. */
  label?: string;
  /** End-of-line markers. Drawing connectors set these; diagrams default end→arrow. */
  startMarker?: import('@bendyline/squisq/schemas').MarkerStyle;
  endMarker?: import('@bendyline/squisq/schemas').MarkerStyle;
  /** SVG stroke-dasharray for dashed/dotted lines. */
  dasharray?: string;
  /** Per-edge routing override (else the renderer's variant default). */
  routing?: import('@bendyline/squisq/doc').ConnectorRouting;
  /** Optional authored node-side attachments (used by ASCII-derived diagrams). */
  sourceAnchor?: DiagramEdgeAnchor;
  targetAnchor?: DiagramEdgeAnchor;
}
