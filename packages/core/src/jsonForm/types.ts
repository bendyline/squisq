/**
 * JSON Form types — Squisq's hint vocabulary layered on JSON Schema.
 *
 * Hints live inline on a JSON Schema under a single `squisq` key. The
 * schema remains a valid JSON Schema; the extra key is ignored by
 * standard validators. Renderers consult the hints to pick a control
 * and tune its presentation.
 */

/**
 * Every concrete control rendered by `<JsonView>` and `<JsonEditor>`.
 *
 * Auto-defaults pick one based on schema shape; hosts override via
 * `squisq.control` when they want something specific (e.g. radio over
 * segmented for a long, descriptive enum).
 */
export type ControlKind =
  | 'text'
  | 'multiline'
  | 'richtext'
  | 'color'
  | 'date'
  | 'time'
  | 'datetime'
  | 'slider'
  | 'stepper'
  | 'segmented'
  | 'radio'
  | 'combobox'
  | 'toggle'
  | 'checkbox'
  | 'card'
  | 'card-stack'
  | 'chip-bin'
  | 'tabs'
  | 'group';

/**
 * Conditional rule: looked up by field path against the root data and
 * compared with one of the operators. The first defined operator wins
 * (in declaration order: equals, oneOf, matches, truthy).
 */
export interface SquisqWhen {
  /**
   * Path to the controlling field, relative to the root data.
   * Accepts dotted-path (`user.role`) or JSON Pointer (`/user/role`).
   */
  field: string;
  equals?: unknown;
  oneOf?: readonly unknown[];
  /** ECMAScript regex source; matched against the string value. */
  matches?: string;
  /** When true, condition holds if value is truthy; when false, if falsy. */
  truthy?: boolean;
}

/**
 * Hints for a single schema node. Attach via `squisq` on any JSON
 * Schema object — properties, items, the root, or sub-schemas inside
 * `oneOf`/`anyOf`.
 */
export interface SquisqHints {
  /** Force a specific control. If omitted, picked from type/format/enum cardinality. */
  control?: ControlKind;

  /** Override schema `title` for display. */
  label?: string;
  /** Override schema `description` for the inline helper text. */
  help?: string;
  /** Placeholder text for empty fields. */
  placeholder?: string;

  /** Suggested layout sizing in a parent grid. Renderers may ignore on narrow viewports. */
  width?: 'full' | 'half' | 'third' | 'auto';

  /** Hide the field — literal, or a `SquisqWhen` evaluated against root data. */
  hidden?: boolean | SquisqWhen;
  /** Disable the field — literal, or a `SquisqWhen` evaluated against root data. */
  disabled?: boolean | SquisqWhen;

  /** Override schema's required-ness for the UI only. */
  required?: boolean;

  /** For arrays of objects: how to label each card in a `card-stack`. */
  itemLabel?: string | { fromField: string };
  /** Label for the "+ Add" button on arrays. */
  addLabel?: string;
  /** Label for the remove button on arrays. */
  removeLabel?: string;

  /** Slider/stepper visual step. Falls back to schema `multipleOf`. */
  step?: number;

  /** Optional human-readable labels for enum values. */
  enumLabels?: Record<string, string>;
}

/**
 * The subset of JSON Schema we understand, with an optional `squisq`
 * key. We deliberately keep this as a structural type so any JSON
 * Schema authored elsewhere can be passed in without conversion.
 */
export interface SquisqAnnotatedSchema {
  type?: string | readonly string[];
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  examples?: readonly unknown[];

  enum?: readonly unknown[];
  const?: unknown;

  // Object
  properties?: Record<string, SquisqAnnotatedSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | SquisqAnnotatedSchema;

  // Array
  items?: SquisqAnnotatedSchema | readonly SquisqAnnotatedSchema[];
  minItems?: number;
  maxItems?: number;

  // Number
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // String
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // Combinators
  oneOf?: readonly SquisqAnnotatedSchema[];
  anyOf?: readonly SquisqAnnotatedSchema[];
  allOf?: readonly SquisqAnnotatedSchema[];

  // References
  $ref?: string;
  $defs?: Record<string, SquisqAnnotatedSchema>;
  definitions?: Record<string, SquisqAnnotatedSchema>;

  // Squisq-native UI hints
  squisq?: SquisqHints;
}

/**
 * A validation error reported by the consumer-supplied `validate` prop.
 * Matches the shape of common validators (ajv, etc.) without depending
 * on any specific one.
 */
export interface JsonFormValidationError {
  /** JSON Pointer to the failing value, e.g. `/sections/0/heading`. */
  path: string;
  /** Human-readable message. */
  message: string;
  /** Optional schema keyword that failed (e.g. "required", "minimum"). */
  keyword?: string;
}

export type JsonFormValidator = (
  value: unknown,
  schema: SquisqAnnotatedSchema,
) => readonly JsonFormValidationError[];
