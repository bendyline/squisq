/**
 * Infer a JSON Schema from an example JSON value. Thin facade over
 * `genson-js` so consumers don't depend on it directly and we can swap
 * the implementation later.
 */

import { createSchema, mergeSchemas } from 'genson-js';
import type { SquisqAnnotatedSchema } from './types.js';

export interface InferSchemaOptions {
  /** Additional samples merged into the inferred schema for broader coverage. */
  additionalSamples?: readonly unknown[];
}

export function inferSchema(
  sample: unknown,
  options: InferSchemaOptions = {},
): SquisqAnnotatedSchema {
  const base = createSchema(sample) as SquisqAnnotatedSchema;
  if (!options.additionalSamples || options.additionalSamples.length === 0) {
    return base;
  }
  const extras = options.additionalSamples.map(
    (s) => createSchema(s) as SquisqAnnotatedSchema,
  );
  return mergeSchemas([base, ...extras] as never[]) as SquisqAnnotatedSchema;
}
