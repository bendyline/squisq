/**
 * <JsonEditor>
 *
 * Friendly, theme-aware editor for any JSON value bound to a Squisq-
 * annotated JSON Schema. Hides JSON syntax behind delightful controls:
 * arrays of objects become card stacks, arrays of primitives become
 * chip bins, color fields become swatches, and so on.
 *
 * Companion to `<JsonView>` from `@bendyline/squisq-react` — both share
 * the same `chooseControl()` dispatcher in core, so view and edit modes
 * always agree on what each field _is_.
 */

import type {
  JsonFormValidationError,
  JsonFormValidator,
  SquisqAnnotatedSchema,
} from '@bendyline/squisq/jsonForm';
import type { SurfaceScheme, Theme } from '@bendyline/squisq/schemas';
import { JsonEditorProvider } from './JsonEditorContext';
import { RenderNode } from './RenderNode';
import { useJsonEditorTokens } from './useJsonEditorTokens';

export interface JsonEditorProps {
  /** Schema describing the value's shape (with optional `squisq` hints). */
  schema: SquisqAnnotatedSchema;
  /** Controlled value. */
  value: unknown;
  /** Called with the new root after each edit. Omit for read-only behavior. */
  onChange?: (next: unknown) => void;
  /** Optional theme. Defaults to `DEFAULT_THEME`. */
  theme?: Theme;
  /** Light/dark surface override; `'auto'` uses `prefers-color-scheme`. */
  surface?: SurfaceScheme | 'auto';
  /** Padding/gap density. Default: 'comfortable'. */
  density?: 'comfortable' | 'compact';
  /** Optional consumer-supplied validator (e.g. ajv-backed). */
  validate?: JsonFormValidator;
  /** Notified after validation runs. */
  onValidate?: (errors: readonly JsonFormValidationError[]) => void;
  /** Optional CSS class for the outer container. */
  className?: string;
}

export function JsonEditor(props: JsonEditorProps) {
  const {
    schema,
    value,
    onChange,
    theme,
    surface,
    density = 'comfortable',
    validate,
    onValidate,
    className,
  } = props;
  const { style } = useJsonEditorTokens(theme, surface);

  // No onChange → fully inert (still validates if a validator is supplied).
  const handleChange = onChange ?? (() => {});

  const cls =
    'squisq-jsonform' +
    (density === 'compact' ? ' squisq-jsonform--compact' : '') +
    (className ? ` ${className}` : '');

  return (
    <div className={cls} style={style}>
      <JsonEditorProvider
        rootSchema={schema}
        rootData={value}
        onRootChange={handleChange}
        density={density}
        validate={validate}
        onValidate={onValidate}
      >
        <RenderNode value={value} schema={schema} pointer="" parentDisabled={!onChange} />
      </JsonEditorProvider>
    </div>
  );
}
