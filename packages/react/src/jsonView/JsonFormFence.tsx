/**
 * JsonFormFence — the component behind `createJsonFormFenceRenderer`.
 *
 * Parses a fence body (strict JSON first, then the documented YAML subset)
 * and renders it through the read-only `<JsonView>`, with host-defined action
 * buttons as chrome below the form. Unparseable bodies render as a plain code
 * block with a quiet diagnostic line, so a malformed fence stays visible and
 * debuggable rather than disappearing.
 */

import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';
import { inferSchema } from '@bendyline/squisq/jsonForm';
import { parseYamlSubset } from '@bendyline/squisq/doc';
import type { FenceRenderContext } from '@bendyline/squisq/fence';
import { JsonView } from './JsonView.js';
import type { JsonFormFenceRendererOptions } from './jsonFormFenceRenderer.js';

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

export interface JsonFormFenceProps {
  ctx: FenceRenderContext;
  options: JsonFormFenceRendererOptions;
}

export function JsonFormFence({ ctx, options }: JsonFormFenceProps) {
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
