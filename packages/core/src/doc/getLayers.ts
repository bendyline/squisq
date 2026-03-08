/**
 * getLayers — Compute visual layers for a block on demand.
 *
 * This is the preferred way to obtain renderable layers for a block.
 * Instead of storing pre-computed layers on the Block object, call
 * `getLayers(block, context)` to derive them from the block's template
 * name, content, and the current render context (theme, viewport, etc.).
 *
 * For raw blocks that already carry a `layers` array, those layers are
 * returned directly (with optional persistent layer injection).
 *
 * @example
 * ```ts
 * import { getLayers } from '@bendyline/squisq/doc';
 *
 * const layers = getLayers(block, {
 *   theme: DEFAULT_THEME,
 *   viewport: VIEWPORT_PRESETS.landscape,
 *   blockIndex: 0,
 *   totalBlocks: 10,
 * });
 * ```
 */

import type { Block, Layer } from '../schemas/Doc.js';
import type {
  ThemeColors,
  TemplateBlock,
  PersistentLayerConfig,
  DocBlock,
} from '../schemas/BlockTemplates.js';
import type { ViewportConfig } from '../schemas/Viewport.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import {
  createTemplateContext,
  DEFAULT_THEME,
  isTemplateBlock,
} from '../schemas/BlockTemplates.js';
import { templateRegistry } from './templates/index.js';
import { expandPersistentLayers } from './templates/persistentLayers.js';

// ============================================
// RenderContext
// ============================================

/**
 * Context needed to compute layers for a block.
 *
 * Captures the visual rendering parameters: theme colors, viewport
 * configuration, persistent layers, and the block's position within
 * the doc (for template functions that vary output by index).
 */
export interface RenderContext {
  /** Theme colors for template rendering. Defaults to DEFAULT_THEME. */
  theme?: ThemeColors;

  /** Target viewport configuration. Defaults to 16:9 landscape. */
  viewport?: ViewportConfig;

  /** Persistent layers injected behind and/or on top of all block content. */
  persistentLayers?: PersistentLayerConfig;

  /** 0-based index of this block in the sequence. Defaults to 0. */
  blockIndex?: number;

  /** Total number of blocks in the doc. Defaults to 1. */
  totalBlocks?: number;
}

// ============================================
// getLayers
// ============================================

/**
 * Compute the visual layers for a block.
 *
 * Resolution order:
 * 1. If the block already has a non-empty `layers` array, use it (raw block).
 * 2. If the block has a `template` name that exists in the registry,
 *    call the template function to generate layers.
 * 3. Otherwise return an empty array.
 *
 * Persistent layers (bottom/top) from the render context are injected
 * around the result unless the block opts out via `useBottomLayer: false`
 * or `useTopLayer: false`.
 *
 * @param block   A Block or TemplateBlock to render.
 * @param context Render context (theme, viewport, persistent layers, position).
 * @returns The computed Layer[] for the block, ready for BlockRenderer.
 */
export function getLayers(block: DocBlock, context: RenderContext = {}): Layer[] {
  const theme = context.theme ?? DEFAULT_THEME;
  const viewport = context.viewport ?? VIEWPORT_PRESETS.landscape;
  const blockIndex = context.blockIndex ?? 0;
  const totalBlocks = context.totalBlocks ?? 1;

  // 1. Raw block path: block already has pre-computed layers
  const existingLayers = (block as Block).layers;
  if (existingLayers && existingLayers.length > 0 && !isTemplateBlock(block)) {
    return injectPersistentLayers(existingLayers, block, context);
  }

  // 2. Template path: look up and call the template function
  const templateName = (block as any).template as string | undefined;
  if (templateName && templateName in templateRegistry) {
    const templateCtx = createTemplateContext(theme, blockIndex, totalBlocks, viewport);
    let layers: Layer[];
    try {
      layers = (templateRegistry as any)[templateName](block, templateCtx);
      if (!Array.isArray(layers)) {
        console.error(`Template ${templateName} did not return an array, got:`, typeof layers);
        layers = [];
      }
    } catch (err) {
      console.error(`Error expanding template ${templateName}:`, err);
      layers = [];
    }

    return injectPersistentLayers(layers, block, context);
  }

  // 3. Fallback: no layers and no known template
  return injectPersistentLayers([], block, context);
}

// ============================================
// Internal helpers
// ============================================

/**
 * Inject persistent bottom/top layers around the block's own layers,
 * respecting per-block opt-out flags.
 */
function injectPersistentLayers(layers: Layer[], block: DocBlock, context: RenderContext): Layer[] {
  const { persistentLayers } = context;
  if (!persistentLayers) return layers;

  const bottomLayers = expandPersistentLayers(persistentLayers.bottomLayers);
  const topLayers = expandPersistentLayers(persistentLayers.topLayers);

  if (bottomLayers.length === 0 && topLayers.length === 0) return layers;

  const templateBlock = block as TemplateBlock;
  const useBottom = templateBlock.useBottomLayer !== false;
  const useTop = templateBlock.useTopLayer !== false;

  return [...(useBottom ? bottomLayers : []), ...layers, ...(useTop ? topLayers : [])];
}
