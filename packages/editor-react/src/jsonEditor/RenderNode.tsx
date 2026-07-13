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
import { useId } from 'react';
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
  const generatedId = useId().replace(/:/g, '');
  const { rootSchema, rootData, errors } = useJsonEditor();
  const resolved = resolveRef(props.schema, rootSchema) ?? props.schema;

  if (resolveFlag(resolved.squisq?.hidden, rootData)) return null;

  const disabled =
    (props.parentDisabled ?? false) || resolveFlag(resolved.squisq?.disabled, rootData);
  const kind = chooseControl(resolved);
  const Editor = EDITORS[kind];
  const label = resolved.squisq?.label ?? resolved.title;
  const help = resolved.squisq?.help ?? resolved.description;
  const fieldErrors = errors.get(props.pointer) ?? [];
  const controlId = `squisq-json-control-${generatedId}`;
  const labelId = label ? `${controlId}-label` : undefined;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = fieldErrors.length > 0 ? `${controlId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  const editorEl = (
    <Editor
      value={props.value}
      schema={resolved}
      pointer={props.pointer}
      disabled={disabled}
      controlId={controlId}
      labelledBy={labelId}
      describedBy={describedBy}
      invalid={fieldErrors.length > 0}
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
      {label ? (
        <label id={labelId} htmlFor={controlId} className="squisq-jf-field__label">
          {label}
        </label>
      ) : null}
      {editorEl}
      {help ? (
        <p id={helpId} className="squisq-jf-field__help">
          {help}
        </p>
      ) : null}
      {fieldErrors.length > 0 ? (
        <p id={errorId} className="squisq-jf-field__error" role="alert">
          {fieldErrors[0].message}
        </p>
      ) : null}
    </div>
  );
}
