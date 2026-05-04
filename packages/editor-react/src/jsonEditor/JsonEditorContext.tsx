/**
 * Shared state for `<JsonEditor>`. Each editor renderer reads its
 * slice via JSON Pointer and calls `setAtPath` to commit edits — the
 * top-level component owns the canonical value and propagates changes
 * to the host's `onChange`.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  JsonFormValidationError,
  JsonFormValidator,
  SquisqAnnotatedSchema,
} from '@bendyline/squisq/jsonForm';
import { setByPointer } from '@bendyline/squisq/jsonForm';

export interface JsonEditorContextValue {
  rootSchema: SquisqAnnotatedSchema;
  rootData: unknown;
  /** Commit a new value at `pointer`, computing & emitting a new root. */
  setAtPath: (pointer: string, value: unknown) => void;
  density: 'comfortable' | 'compact';
  errors: ReadonlyMap<string, JsonFormValidationError[]>;
  /** Optional richtext editor component, supplied internally. */
}

const JsonEditorContext = createContext<JsonEditorContextValue | null>(null);

export interface JsonEditorProviderProps {
  rootSchema: SquisqAnnotatedSchema;
  rootData: unknown;
  onRootChange: (next: unknown) => void;
  density: 'comfortable' | 'compact';
  validate?: JsonFormValidator;
  onValidate?: (errors: readonly JsonFormValidationError[]) => void;
  children: ReactNode;
}

export function JsonEditorProvider(props: JsonEditorProviderProps) {
  const { rootSchema, rootData, onRootChange, density, validate, onValidate, children } = props;

  const errors = useMemo(() => {
    if (!validate) return new Map<string, JsonFormValidationError[]>();
    const list = validate(rootData, rootSchema);
    if (onValidate) onValidate(list);
    const grouped = new Map<string, JsonFormValidationError[]>();
    for (const e of list) {
      const arr = grouped.get(e.path) ?? [];
      arr.push(e);
      grouped.set(e.path, arr);
    }
    return grouped;
  }, [validate, rootData, rootSchema, onValidate]);

  const setAtPath = useMemo(
    () => (pointer: string, value: unknown) => {
      const next = setByPointer(rootData, pointer, value);
      onRootChange(next);
    },
    [rootData, onRootChange],
  );

  const value: JsonEditorContextValue = useMemo(
    () => ({ rootSchema, rootData, setAtPath, density, errors }),
    [rootSchema, rootData, setAtPath, density, errors],
  );

  return <JsonEditorContext.Provider value={value}>{children}</JsonEditorContext.Provider>;
}

export function useJsonEditor(): JsonEditorContextValue {
  const ctx = useContext(JsonEditorContext);
  if (!ctx) throw new Error('useJsonEditor must be used inside <JsonEditor>');
  return ctx;
}
