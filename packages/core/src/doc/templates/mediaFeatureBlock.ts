/**
 * Media-led Templates — `topFeature`, `bottomFeature` and `mediaOnly`
 *
 * The block's own media — images, video clips, hosted players, diagrams —
 * leads the slide. These templates render their text exactly as `content`
 * does (the heading and the complete body, lists and builds intact) and leave
 * the media to the shared rich-media pass. Their layout policy
 * (`mediaLayoutPolicy.ts`, resolved in `richMediaLayout.ts`) gives the media
 * the full width of the slide, edge to edge — a band across the top or bottom
 * with the text re-fitted into the rest, or the whole slide — instead of the
 * half a side-by-side feature leaves it. Without media each one is a plain
 * content slide, so choosing it never loses the body.
 */

import type { Layer } from '../../schemas/Doc.js';
import type {
  BottomFeatureInput,
  MediaOnlyInput,
  TemplateContext,
  TopFeatureInput,
} from '../../schemas/BlockTemplates.js';
import { contentBlock } from './contentBlock.js';

export function topFeature(input: TopFeatureInput, context: TemplateContext): Layer[] {
  return contentBlock({ ...input, template: 'content' }, context);
}

export function bottomFeature(input: BottomFeatureInput, context: TemplateContext): Layer[] {
  return contentBlock({ ...input, template: 'content' }, context);
}

export function mediaOnly(input: MediaOnlyInput, context: TemplateContext): Layer[] {
  return contentBlock({ ...input, template: 'content' }, context);
}
