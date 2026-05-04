/**
 * <JsonView>
 *
 * Read-only renderer for any JSON value bound to a JSON Schema (with
 * optional Squisq UI hints). Designed to look like a polished settings
 * summary or CRM record — not a disabled form. Themable via the
 * standard Theme + SurfaceScheme props used elsewhere in Squisq.
 */

import type { SquisqAnnotatedSchema } from '@bendyline/squisq/jsonForm';
import type { SurfaceScheme, Theme } from '@bendyline/squisq/schemas';
import { useJsonViewTokens } from './useJsonViewTokens';
import { RenderNode } from './RenderNode';

export interface JsonViewProps {
  /** Schema describing the value's shape (with optional `squisq` UI hints). */
  schema: SquisqAnnotatedSchema;
  /** The value to display. */
  value: unknown;
  /** Optional theme. Defaults to `DEFAULT_THEME`. */
  theme?: Theme;
  /** Light/dark surface override; `'auto'` follows `prefers-color-scheme`. */
  surface?: SurfaceScheme | 'auto';
  /** Padding/gap density. Default: 'comfortable'. */
  density?: 'comfortable' | 'compact';
  /** Optional CSS class for the outer container. */
  className?: string;
}

export function JsonView(props: JsonViewProps) {
  const { schema, value, theme, surface, density = 'comfortable', className } = props;
  const { style } = useJsonViewTokens(theme, surface);

  const cls =
    'squisq-json-view' +
    (density === 'compact' ? ' squisq-json-view--compact' : '') +
    (className ? ` ${className}` : '');

  return (
    <div className={cls} style={style}>
      <RenderNode
        value={value}
        schema={schema}
        rootSchema={schema}
        rootData={value}
        pointer=""
        density={density}
      />
    </div>
  );
}
