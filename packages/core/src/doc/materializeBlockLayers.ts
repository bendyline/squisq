/**
 * Canonical block-to-layer materialization contract.
 *
 * Timeline scheduling and UI components both delegate here so template
 * lookup, custom templates, ownership, render style, persistent layers,
 * failure policy, and diagnostics cannot drift by render mode.
 */

import type { Block, Layer } from '../schemas/Doc.js';
import type {
  DocBlock,
  PersistentLayerConfig,
  TemplateBlock,
  TemplateContext,
} from '../schemas/BlockTemplates.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import type { Theme } from '../schemas/Theme.js';
import type { ViewportConfig } from '../schemas/Viewport.js';
import { createTemplateContext, isTemplateBlock } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import { cloneData } from '../internal/immutable.js';
import { applyRenderStyleToLayers } from './utils/applyRenderStyle.js';
import { coerceTemplateParams } from './templates/inputDescriptors.js';
import { fallbackBlockLayers } from './templates/fallbackBlock.js';
import { expandPersistentLayers, wrapWithPersistentLayers } from './templates/persistentLayers.js';
import { resolveTemplateName } from './templates/templateNames.js';
import {
  buildRegistry,
  templateRegistry,
  type RuntimeTemplateRegistry,
} from './templates/registry.js';

/** Internal result from executing one template function. */
type TemplateLayerMaterialization =
  | { status: 'ok'; layers: Layer[] }
  | { status: 'unknown-template'; layers: [] }
  | { status: 'invalid-result'; layers: []; receivedType: string }
  | { status: 'error'; layers: []; error: unknown };

/** How a failed template render is represented in the returned layer graph. */
export type LayerMaterializationFailureMode = 'fallback' | 'empty';

/** A structured, inspectable explanation for a template render failure. */
export type LayerMaterializationDiagnostic =
  | {
      code: 'unknown-template';
      template: string;
      message: string;
    }
  | {
      code: 'invalid-template-result';
      template: string;
      message: string;
      receivedType: string;
    }
  | {
      code: 'template-error';
      template: string;
      message: string;
      cause: unknown;
    };

/** Identifies which path produced a materialized layer graph. */
export type LayerMaterializationSource = 'authored' | 'template' | 'fallback' | 'empty';

/**
 * Complete result from {@link materializeBlockLayers}. Failures are data, not
 * console side effects: callers can display, report, or ignore the diagnostic.
 */
export interface BlockLayerMaterialization {
  layers: Layer[];
  source: LayerMaterializationSource;
  diagnostic?: LayerMaterializationDiagnostic;
}

/**
 * The single public context for turning a block into renderable layers.
 *
 * Theme persistent layers are inherited by default. Pass
 * `persistentLayers: false` to opt out, or a config to replace the theme's
 * persistent layers wholesale.
 */
export interface MaterializeBlockLayersOptions {
  /** Theme used by templates and render-style post-processing. */
  theme?: Theme;
  /** Target viewport. Defaults to the landscape preset. */
  viewport?: ViewportConfig;
  /** Theme inheritance override for persistent layers. */
  persistentLayers?: PersistentLayerConfig | false;
  /** Zero-based position in the flattened render sequence. */
  blockIndex?: number;
  /** Number of blocks in the flattened render sequence. */
  totalBlocks?: number;
  /** Document-scoped custom templates; built-ins win name collisions. */
  customTemplates?: readonly CustomTemplateDefinition[];
  /** Failed templates render a visible fallback by default. */
  failureMode?: LayerMaterializationFailureMode;
}

/** Pre-expanded scheduling cache; not part of the public materialization API. */
export interface ExpandedPersistentLayerSet {
  bottomLayers: Layer[];
  topLayers: Layer[];
}

/** Internal dependencies and compatibility switches supplied by orchestrators. */
export interface MaterializationRuntime {
  registry: RuntimeTemplateRegistry;
  templateContext?: TemplateContext;
  applyRenderStyle?: boolean;
  expandedPersistentLayers?: ExpandedPersistentLayerSet;
}

/**
 * Turn any doc block into an owned, render-ready layer graph.
 *
 * This is the only recommended public materialization entry point.
 */
export function materializeBlockLayers(
  block: DocBlock,
  options: MaterializeBlockLayersOptions = {},
): BlockLayerMaterialization {
  const registry =
    options.customTemplates && options.customTemplates.length > 0
      ? buildRegistry(options.customTemplates)
      : (templateRegistry as unknown as RuntimeTemplateRegistry);
  return materializeBlockLayersWithRuntime(block, options, { registry });
}

/** Internal entry point for schedulers that cache registry and persistent expansion. */
export function materializeBlockLayersWithRuntime(
  block: DocBlock,
  options: MaterializeBlockLayersOptions,
  runtime: MaterializationRuntime,
): BlockLayerMaterialization {
  const theme = options.theme ?? DEFAULT_THEME;
  const viewport = options.viewport ?? VIEWPORT_PRESETS.landscape;
  const blockIndex = options.blockIndex ?? 0;
  const totalBlocks = options.totalBlocks ?? 1;
  const effectivePersistentLayers =
    options.persistentLayers === false
      ? undefined
      : (options.persistentLayers ?? theme.persistentLayers);

  const existingLayers = (block as Block).layers;
  if (existingLayers && existingLayers.length > 0 && !isTemplateBlock(block)) {
    return {
      layers: injectPersistentLayers(
        cloneData(existingLayers),
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: 'authored',
    };
  }

  if (!isTemplateBlock(block)) {
    return {
      layers: injectPersistentLayers(
        [],
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: 'empty',
    };
  }

  const context = runtime.templateContext
    ? cloneData(runtime.templateContext)
    : createTemplateContext(theme, blockIndex, totalBlocks, viewport);
  context.block = cloneData(block as Block);

  const execution = executeTemplateMaterialization(block, context, runtime.registry);
  if (execution.status === 'ok') {
    const styledLayers =
      runtime.applyRenderStyle !== false
        ? applyRenderStyleToLayers(execution.layers, block as Block, theme)
        : execution.layers;
    return {
      layers: injectPersistentLayers(
        styledLayers,
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: 'template',
    };
  }

  const diagnostic = toLayerMaterializationDiagnostic(block.template, execution);
  if ((options.failureMode ?? 'fallback') === 'empty') {
    return {
      layers: injectPersistentLayers(
        [],
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: 'empty',
      diagnostic,
    };
  }

  return {
    layers: injectPersistentLayers(
      fallbackBlockLayers(block, context, diagnostic.message),
      block,
      theme,
      effectivePersistentLayers,
      runtime.expandedPersistentLayers,
    ),
    source: 'fallback',
    diagnostic,
  };
}

function executeTemplateMaterialization(
  templateBlock: TemplateBlock,
  context: TemplateContext,
  registry: RuntimeTemplateRegistry,
): TemplateLayerMaterialization {
  const safeTemplateBlock = cloneData(templateBlock);
  const safeContext = cloneData(context);
  const maybeChildren = (safeTemplateBlock as Block).children;
  if ((!safeContext.children || safeContext.children.length === 0) && maybeChildren?.length) {
    safeContext.children = maybeChildren;
  }

  const templateFn = registry[resolveTemplateName(safeTemplateBlock.template)];
  if (!templateFn) return { status: 'unknown-template', layers: [] };

  const { templateData, templateOverrides } = safeTemplateBlock as Block;
  const input =
    templateData || templateOverrides
      ? ({
          ...safeTemplateBlock,
          ...templateData,
          ...coerceTemplateParams(safeTemplateBlock.template, templateOverrides ?? {}).input,
        } as TemplateBlock)
      : safeTemplateBlock;

  try {
    const renderedLayers = templateFn(input, safeContext);
    if (!Array.isArray(renderedLayers)) {
      return {
        status: 'invalid-result',
        layers: [],
        receivedType: typeof renderedLayers,
      };
    }
    return { status: 'ok', layers: cloneData(renderedLayers) };
  } catch (error: unknown) {
    return { status: 'error', layers: [], error };
  }
}

function toLayerMaterializationDiagnostic(
  template: string,
  execution: Exclude<TemplateLayerMaterialization, { status: 'ok' }>,
): LayerMaterializationDiagnostic {
  if (execution.status === 'unknown-template') {
    return {
      code: 'unknown-template',
      template,
      message: `Unknown template "${template}"`,
    };
  }
  if (execution.status === 'invalid-result') {
    return {
      code: 'invalid-template-result',
      template,
      receivedType: execution.receivedType,
      message: `Template "${template}" returned ${execution.receivedType}, not a layer array`,
    };
  }
  return {
    code: 'template-error',
    template,
    cause: execution.error,
    message: `Template "${template}" failed`,
  };
}

function injectPersistentLayers(
  layers: Layer[],
  block: DocBlock,
  theme: Theme,
  persistentLayers?: PersistentLayerConfig,
  expanded?: ExpandedPersistentLayerSet,
): Layer[] {
  if (!persistentLayers) return layers;
  const bottomLayers =
    expanded?.bottomLayers ?? expandPersistentLayers(persistentLayers.bottomLayers, theme);
  const topLayers =
    expanded?.topLayers ?? expandPersistentLayers(persistentLayers.topLayers, theme);
  return wrapWithPersistentLayers(layers, block as TemplateBlock, bottomLayers, topLayers);
}
