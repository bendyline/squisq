/**
 * Custom template factory.
 *
 * Turns a `CustomTemplateDefinition` (user-authored visual design with
 * placeholder tokens) into a runtime `TemplateFunction` that can be
 * dropped into the template registry alongside built-ins.
 *
 * The generated function's job is small: read the source `Block` from
 * `context.block` and hand the definition's layers off to
 * `resolveTokens` for placeholder substitution. The hard work (drag-
 * to-position, token grammar, image lookup) happens in the designer
 * UI and the resolver, not here.
 */

import type { Layer } from '../../schemas/Doc.js';
import type {
  RawLayersInput,
  TemplateContext,
  TemplateFunction,
} from '../../schemas/BlockTemplates.js';
import type { CustomTemplateDefinition } from '../../schemas/CustomTemplates.js';
import { resolveTokens } from './tokens/resolveTokens.js';

/**
 * Build a template function for a user-authored custom template.
 *
 * The returned function is registered under `def.name` in the merged
 * registry (see `buildRegistry` in `templates/index.ts`). At expansion
 * time it receives the standard `TemplateBlock` + `TemplateContext`
 * pair; the context's `block` field carries the source markdown-derived
 * block whose data drives token resolution.
 *
 * When `context.block` is missing (shouldn't happen in the normal
 * pipeline but defensively handled), the layers are returned with
 * tokens left unresolved — better visible placeholders than a thrown
 * error.
 */
export function makeCustomTemplateFn(
  def: CustomTemplateDefinition,
): TemplateFunction<RawLayersInput> {
  return (_input: RawLayersInput, context: TemplateContext): Layer[] => {
    if (!context.block) return def.layers.slice();
    return resolveTokens(def.layers, context.block);
  };
}
