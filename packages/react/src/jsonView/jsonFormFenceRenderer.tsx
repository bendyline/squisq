/**
 * Built-in fence renderer: a fence's JSON / YAML-subset body rendered
 * through the read-only JSON-form machinery (`<JsonView>`), with
 * host-defined action buttons as chrome below the form.
 *
 * This is the form-driven flavor of the pluggable fence mechanism —
 * register the result in a `FenceRendererMap` next to fully custom
 * component renderers:
 *
 * ```tsx
 * const fenceRenderers = {
 *   'my-record': createJsonFormFenceRenderer({
 *     actions: [{ id: 'approve', label: 'Approve' }],
 *     onAction: (actionId, data) => host.handle(actionId, data),
 *   }),
 * };
 * ```
 *
 * Parsing: strict JSON first, then the documented YAML subset
 * (`parseYamlSubset` — flat maps, inline arrays, one nesting level).
 * Unparseable bodies render as a plain code block with a quiet
 * diagnostic line, so a malformed fence stays visible and debuggable.
 * The rendering itself lives in `JsonFormFence.tsx`; this module is the
 * factory and its option surface.
 */

import type { ReactNode } from 'react';
import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';
import type { FenceRenderContext, FenceRenderer } from '@bendyline/squisq/fence';
import { JsonFormFence } from './JsonFormFence.js';

/** One host action button rendered below the form. */
export interface JsonFormFenceAction {
  id: string;
  label: string;
  /** `primary` gets the filled treatment; default is quiet. */
  variant?: 'primary' | 'default';
}

export interface JsonFormFenceRendererOptions {
  /**
   * Schema for the fence body. Omitted → inferred from the parsed value
   * (`inferSchema`), which renders sensible read-only fields for any
   * well-formed object.
   */
  schema?: SquisqAnnotatedSchema;
  /** Action buttons rendered below the form. */
  actions?: readonly JsonFormFenceAction[];
  /**
   * Invoked from the button's click handler (user-gesture context is
   * preserved, mirroring the `onCopyCode` contract).
   */
  onAction?: (
    actionId: string,
    data: Record<string, unknown>,
    ctx: FenceRenderContext,
  ) => void | Promise<void>;
  /** Padding density passed to `<JsonView>` (default `'compact'`). */
  density?: 'comfortable' | 'compact';
  /** Extra CSS class on the wrapper. */
  className?: string;
}

/**
 * Build a `FenceRenderer` that renders the fence body through the
 * read-only JSON form. See the module doc for usage.
 */
export function createJsonFormFenceRenderer(
  options: JsonFormFenceRendererOptions = {},
): FenceRenderer {
  return function jsonFormFenceRenderer(ctx: FenceRenderContext): ReactNode {
    return <JsonFormFence ctx={ctx} options={options} />;
  };
}
