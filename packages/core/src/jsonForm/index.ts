/**
 * `@bendyline/squisq/jsonForm` — headless JSON Form logic.
 *
 * Pure utilities consumed by `<JsonView>` (read-only) in
 * `@bendyline/squisq-react` and `<JsonEditor>` (editable) in
 * `@bendyline/squisq-editor-react`. Zero React deps.
 */

export type {
  ControlKind,
  SquisqHints,
  SquisqWhen,
  SquisqAnnotatedSchema,
  JsonFormValidationError,
  JsonFormValidator,
} from './types.js';

export { chooseControl, primaryType, arrayItemKind } from './chooseControl.js';
export { evaluateWhen, isSafeConditionRegex, resolveFlag } from './evaluateWhen.js';
export {
  escapePointerSegment,
  appendPointer,
  toPointer,
  pointerSegments,
  getByPointer,
  setByPointer,
  resolveRef,
} from './pointer.js';
export { inferSchema } from './inferSchema.js';
export type { InferSchemaOptions } from './inferSchema.js';
export { buildJsonFormTokens, resolveJsonFormTheme } from './tokens.js';
export type { BuildJsonFormTokensOptions } from './tokens.js';
