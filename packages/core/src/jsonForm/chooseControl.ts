/**
 * Pick a `ControlKind` for a schema node. The single dispatcher used by
 * both `<JsonView>` and `<JsonEditor>` so view and edit modes always
 * agree on what each field _is_, even when their UIs differ.
 *
 * Order of precedence:
 *   1. Explicit `squisq.control` hint
 *   2. `format` keyword (color/date/time/datetime/markdown/textarea)
 *   3. Enum cardinality (segmented vs. combobox)
 *   4. Numeric range (slider when both min and max present)
 *   5. String length (multiline when maxLength > 200)
 *   6. Type-default (object/array/boolean/string/number)
 */

import type { ControlKind, SquisqAnnotatedSchema } from './types.js';

const ENUM_SEGMENTED_LIMIT = 4;
const MULTILINE_LENGTH_THRESHOLD = 200;

export function chooseControl(schema: SquisqAnnotatedSchema): ControlKind {
  const hint = schema.squisq?.control;
  if (hint) return hint;

  const type = primaryType(schema);

  if (schema.format && type === 'string') {
    switch (schema.format) {
      case 'color':
        return 'color';
      case 'date':
        return 'date';
      case 'time':
        return 'time';
      case 'date-time':
        return 'datetime';
      case 'markdown':
        return 'richtext';
      case 'textarea':
        return 'multiline';
    }
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum.length <= ENUM_SEGMENTED_LIMIT ? 'segmented' : 'combobox';
  }

  if (schema.oneOf || schema.anyOf) return 'tabs';

  switch (type) {
    case 'array':
      return arrayItemKind(schema) === 'object' ? 'card-stack' : 'chip-bin';
    case 'object':
      return 'group';
    case 'boolean':
      return 'toggle';
    case 'integer':
    case 'number':
      return hasFiniteRange(schema) ? 'slider' : 'stepper';
    case 'string':
      if (typeof schema.maxLength === 'number' && schema.maxLength > MULTILINE_LENGTH_THRESHOLD) {
        return 'multiline';
      }
      return 'text';
    default:
      return 'text';
  }
}

/** Return the first concrete type of a schema, ignoring `null` for nullable shorthand. */
export function primaryType(schema: SquisqAnnotatedSchema): string | undefined {
  const t = schema.type;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.find((x) => x !== 'null');
  return undefined;
}

/** Inspect `items` to decide whether an array holds objects or primitives. */
export function arrayItemKind(schema: SquisqAnnotatedSchema): 'object' | 'primitive' {
  const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
  if (!items) return 'primitive';
  return primaryType(items) === 'object' ? 'object' : 'primitive';
}

function hasFiniteRange(schema: SquisqAnnotatedSchema): boolean {
  const min = schema.minimum ?? schema.exclusiveMinimum;
  const max = schema.maximum ?? schema.exclusiveMaximum;
  return typeof min === 'number' && typeof max === 'number';
}
