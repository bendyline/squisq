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
 */

import type { ReactNode } from 'react';
import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';
import { inferSchema } from '@bendyline/squisq/jsonForm';
import { parseYamlSubset } from '@bendyline/squisq/doc';
import type { FenceRenderContext, FenceRenderer } from '@bendyline/squisq/fence';
import { JsonView } from './JsonView.js';

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

function parseFenceBody(value: string): { data?: Record<string, unknown>; error?: string } {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'fence body must be a top-level object' };
      }
      return { data: parsed as Record<string, unknown> };
    } catch (err: unknown) {
      return { error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  try {
    return { data: parseYamlSubset(value) };
  } catch (err: unknown) {
    return { error: `invalid YAML: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function JsonFormFence({
  ctx,
  options,
}: {
  ctx: FenceRenderContext;
  options: JsonFormFenceRendererOptions;
}) {
  const parsed = ctx.data !== undefined ? { data: ctx.data } : parseFenceBody(ctx.value);
  const data = parsed.data as Record<string, unknown> | undefined;

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return (
      <div className="squisq-json-fence squisq-json-fence--invalid">
        <pre className="squisq-md-code-block">
          <code>{ctx.value}</code>
        </pre>
        {'error' in parsed && parsed.error && (
          <div className="squisq-json-fence-error">{parsed.error}</div>
        )}
      </div>
    );
  }

  const schema = options.schema ?? (inferSchema(data) as SquisqAnnotatedSchema);
  const actions = options.actions ?? [];

  return (
    <div className={`squisq-json-fence${options.className ? ` ${options.className}` : ''}`}>
      <JsonView
        schema={schema}
        value={data}
        theme={ctx.theme}
        density={options.density ?? 'compact'}
      />
      {actions.length > 0 && options.onAction && (
        <div className="squisq-json-fence-actions" role="group">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`squisq-json-fence-action${
                action.variant === 'primary' ? ' squisq-json-fence-action--primary' : ''
              }`}
              onClick={() => void options.onAction?.(action.id, data, ctx)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
