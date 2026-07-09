/**
 * SceneTool — the contract every editing mode (select, connect, draw,
 * shape, text) implements. A tool is plain data + handlers, not a React
 * component, so adapters can compose toolsets without reaching into JSX.
 *
 * The Scene component owns event binding, pan/zoom, and selection state;
 * tools receive a `SceneToolContext` with helpers for hit-testing,
 * coordinate conversion, and command dispatch.
 */

import type { JSX } from 'react';
import type { Layer } from '@bendyline/squisq/schemas';
import type { SceneCommand, SceneEdge } from '../commands/SceneCommand';
import type { HitTestable } from '../hooks/useSceneHitTest';
import type { SceneTransform } from '../hooks/useScenePanZoom';

export interface SceneToolContext {
  /** Current viewport size in viewport units. */
  viewport: { width: number; height: number };
  /** Current pan/zoom transform. */
  transform: SceneTransform;
  /** All currently rendered layers, in back-to-front order. */
  layers: readonly Layer[];
  /** Optional diagram edges (diagram mode only). */
  edges: readonly SceneEdge[];
  /** Currently selected layer ids. */
  selection: ReadonlySet<string>;
  /** Hit-testable bounding boxes for every layer (precomputed by Scene). */
  hitItems: readonly HitTestable[];
  /** Convert a screen-pixel point (relative to the Scene root) → viewport units. */
  screenToViewport: (sx: number, sy: number) => { x: number; y: number };
  /** Convert a viewport-unit point → screen-pixel point. */
  viewportToScreen: (vx: number, vy: number) => { x: number; y: number };
  /** Topmost layer id at the given viewport-unit point, or null. */
  hit: (point: { x: number; y: number }) => string | null;
  /** Replace selection. */
  setSelection: (ids: Iterable<string>) => void;
  /** Dispatch a SceneCommand to the host adapter. */
  dispatch: (cmd: SceneCommand) => void;
  /** Optional setter for the active tool id (e.g. ConnectTool fall-through to SelectTool). */
  setActiveTool?: (id: string) => void;
  /**
   * Open the shared inline text editor for the given hit layer id (the host
   * must supply a `textEditing` config). Used by SelectTool's double-click.
   */
  beginTextEdit?: (hitLayerId: string) => void;
}

export interface SceneTool {
  /** Stable id, e.g. `'select'`, `'connect'`. */
  id: string;
  /** Human-readable label for the toolbar. */
  label: string;
  /** CSS cursor while the tool is active. */
  cursor: string;
  /** Optional keyboard accelerator (single-character, lowercase). */
  shortcut?: string;
  /** Hide resize handles on selected layers while this tool is active. */
  hideSelectionHandles?: boolean;
  /**
   * Optional icon — JSX rendered inside a fixed-size toolbar button. Keep
   * it light (a single SVG path is ideal); the toolbar wrapper handles
   * sizing and active-state styling.
   */
  icon?: JSX.Element;
  onPointerDown?(e: React.PointerEvent, ctx: SceneToolContext): void;
  onPointerMove?(e: React.PointerEvent, ctx: SceneToolContext): void;
  onPointerUp?(e: React.PointerEvent, ctx: SceneToolContext): void;
  onDoubleClick?(e: React.MouseEvent, ctx: SceneToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: SceneToolContext): void;
  /**
   * Optional overlay rendered above the scene (e.g. marquee box, in-flight
   * connection preview, drag ghost). Returned JSX is appended into the
   * Scene's overlay SVG layer.
   */
  renderOverlay?(ctx: SceneToolContext): JSX.Element | null;
}
