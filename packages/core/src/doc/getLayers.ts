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
  TemplateBlock,
  TemplateContext,
  PersistentLayerConfig,
  DocBlock,
} from '../schemas/BlockTemplates.js';
import type { Theme } from '../schemas/Theme.js';
import type { ViewportConfig } from '../schemas/Viewport.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import { createTemplateContext, isTemplateBlock } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { templateRegistry, resolveTemplateName } from './templates/index.js';
import { expandPersistentLayers } from './templates/persistentLayers.js';
import { fallbackBlockLayers } from './templates/fallbackBlock.js';

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
  /** Theme for template rendering. Defaults to DEFAULT_THEME (documentary). */
  theme?: Theme;

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

  // 2. Template path: look up and call the template function.
  //
  // Resolve through TEMPLATE_ALIASES so legacy ids (`titleBlock`,
  // `quoteBlock`, `mapBlock`, `listBlock`) hit the registry by their
  // canonical short names. Without this the block-section path renders
  // an empty SVG card: `hasTemplate()` accepts the alias (so
  // `isAnnotatedBlock` returns true and the card wrapper renders), but
  // a raw `block.template in templateRegistry` check below misses it
  // and the layer list comes back empty.
  if (isTemplateBlock(block)) {
    const resolved = resolveTemplateName(block.template);
    const templateCtx = createTemplateContext(theme, blockIndex, totalBlocks, viewport);
    if (resolved in templateRegistry) {
      const templateName = resolved as keyof typeof templateRegistry;
      // Aggregate templates (e.g. `diagram`) consume the block's children.
      const maybeChildren = (block as Block).children;
      if (maybeChildren && maybeChildren.length > 0) {
        templateCtx.children = maybeChildren;
      }
      // Effective template input: the block's own fields, then structured
      // body data (```json data fences, GFM tables), then `{[…]}` string
      // overrides — the same merge order buildPreviewDoc uses.
      const { templateData, templateOverrides } = block as Block;
      const input =
        templateData || templateOverrides
          ? ({ ...block, ...templateData, ...templateOverrides } as TemplateBlock)
          : block;
      let layers: Layer[];
      try {
        // Each registry entry accepts its specific TemplateBlock variant; the
        // discriminated union guarantees the shapes match at runtime.
        const templateFn = templateRegistry[templateName] as (
          input: TemplateBlock,
          ctx: TemplateContext,
        ) => Layer[];
        layers = templateFn(input, templateCtx);
        if (!Array.isArray(layers)) {
          console.warn(`Template ${templateName} did not return an array, got:`, typeof layers);
          layers = fallbackBlockLayers(block, templateCtx, `Template "${block.template}" failed`);
        }
      } catch (err: unknown) {
        console.warn(`Error expanding template ${templateName}:`, err);
        layers = fallbackBlockLayers(block, templateCtx, `Template "${block.template}" failed`);
      }

      return injectPersistentLayers(layers, block, context);
    }

    // Unknown template — graceful-degradation guarantee: render the
    // block's heading + body text as a plain card with a visible notice
    // instead of a blank slide.
    return injectPersistentLayers(
      fallbackBlockLayers(block, templateCtx, `Unknown template "${block.template}"`),
      block,
      context,
    );
  }

  // 3. Fallback: no layers and no template requested
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
