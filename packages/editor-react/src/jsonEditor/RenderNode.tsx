/**
 * Recursive editor dispatcher: looks at a schema slice, evaluates
 * `hidden`/`disabled` rules, picks an editor component, and wraps it
 * with label + help + error chrome unless the editor is composite
 * (group / card-stack / tabs / richtext, which present their own).
 */

import {
  chooseControl,
  resolveFlag,
  resolveRef,
  type SquisqAnnotatedSchema,
} from '@bendyline/squisq/jsonForm';
import { useJsonEditor } from './JsonEditorContext';
import { EDITORS, isCompositeControl } from './editors';

export interface RenderNodeProps {
  value: unknown;
  schema: SquisqAnnotatedSchema;
  pointer: string;
  parentDisabled?: boolean;
  suppressTopGroupTitle?: boolean;
}

export function RenderNode(props: RenderNodeProps): React.ReactElement | null {
  const { rootSchema, rootData, errors } = useJsonEditor();
  const resolved = resolveRef(props.schema, rootSchema) ?? props.schema;

  if (resolveFlag(resolved.squisq?.hidden, rootData)) return null;

  const disabled = (props.parentDisabled ?? false) || resolveFlag(resolved.squisq?.disabled, rootData);
  const kind = chooseControl(resolved);
  const Editor = EDITORS[kind];
  const label = resolved.squisq?.label ?? resolved.title;
  const help = resolved.squisq?.help ?? resolved.description;
  const fieldErrors = errors.get(props.pointer) ?? [];

  const editorEl = (
    <Editor
      value={props.value}
      schema={resolved}
      pointer={props.pointer}
      disabled={disabled}
      // GroupEditor honors this — other editors ignore the extra prop.
      // @ts-expect-error optional renderer-specific prop
      suppressTitle={props.suppressTopGroupTitle}
    />
  );

  if (isCompositeControl(kind, resolved)) {
    // Composite editors handle their own labeling.
    return editorEl;
  }

  return (
    <div className={`squisq-jf-field${disabled ? ' squisq-jf-field--disabled' : ''}`}>
      {label ? <label className="squisq-jf-field__label">{label}</label> : null}
      {editorEl}
      {help ? <p className="squisq-jf-field__help">{help}</p> : null}
      {fieldErrors.length > 0 ? (
        <p className="squisq-jf-field__error">{fieldErrors[0].message}</p>
      ) : null}
    </div>
  );
}
