/**
 * Squisq Scene — public exports for the 2D editing engine.
 *
 * The Scene is a small, owned SVG-based framework for viewing and
 * editing the same `Layer` schema Squisq already renders. Three
 * consumers exist today:
 *
 *   - DiagramAdapter (node + edge editing on top of markdown headings)
 *   - LayoutAdapter  (positioning a block's layers)
 *   - DrawingAdapter (free-form shapes, paths, text)
 *
 * Most callers only need `<Scene>` plus the tool(s) and adapter for
 * their use case. The hooks and selection components are exported for
 * advanced consumers that want to build their own surface.
 */

export { Scene } from './Scene';
export type { SceneProps } from './Scene';
export { SceneViewport } from './SceneViewport';
export { SceneSelection } from './SceneSelection';
export { SceneBlockExtension, type SceneBlockExtensionOptions } from './SceneBlockExtension';
export { SceneBlockWidget, type SceneBlockMode } from './SceneBlockWidget';

export type { SceneCommand, SceneEdge } from './commands/SceneCommand';
export type { SceneTool, SceneToolContext } from './tools/SceneTool';

export { SelectTool, getActiveMoveOffset } from './tools/SelectTool';
export { ConnectTool } from './tools/ConnectTool';
export { createShapeTool } from './tools/ShapeTool';
export { createPlaceTool, type PlaceToolOptions } from './tools/PlaceTool';
export { createPathTool } from './tools/PathTool';
export { createTextTool } from './tools/TextTool';
export {
  createTokenTool,
  buildTokenLayer,
  type TokenKind,
  type TokenToolOptions,
} from './tools/TokenTool';
export {
  parsePath,
  serializePath,
  moveAnchor,
  moveHandle,
  type ParsedPath,
  type PathPoint,
} from './paths/bezierEdit';

export { RenderLayer } from './layers/renderLayer';
export {
  nodesToCardLayers,
  nodeCardLayers,
  nodeIdFromCardLayerId,
  cardLayerIdForLabel,
  labelLayerIdForCard,
  diagramLayerFollows,
  NODE_WIDTH,
  NODE_HEIGHT,
  type DiagramNodeDescriptor,
} from './layers/nodeCard';
export { DiagramEdges } from './layers/DiagramEdges';

export {
  buildDiagramScene,
  makeDiagramDispatch,
  nodeCenter,
  type DiagramSceneData,
} from './adapters/DiagramAdapter';

export {
  useLayoutAdapter,
  readLayersFromHeading,
  writeLayersToHeading,
  type LayoutAdapterResult,
  type LayoutAdapterOptions,
} from './adapters/LayoutAdapter';
export { useDrawingAdapter, type DrawingAdapterOptions } from './adapters/DrawingAdapter';
export { encodeLayers, decodeLayers, updateLayer } from './adapters/blockLayers';

export {
  useScenePanZoom,
  IDENTITY_TRANSFORM,
  type SceneTransform,
  type UseScenePanZoomResult,
} from './hooks/useScenePanZoom';
export { useSceneSelection, type UseSceneSelectionResult } from './hooks/useSceneSelection';
export {
  useSceneHitTest,
  layerBounds,
  type HitTestable,
  type UseSceneHitTestResult,
} from './hooks/useSceneHitTest';
