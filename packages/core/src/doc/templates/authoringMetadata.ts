/** Agent-oriented behavior metadata for every built-in template. */

import type { TemplateBlock } from '../../schemas/BlockTemplates.js';

export type TemplateAuthoringRole =
  | 'opener'
  | 'divider'
  | 'content'
  | 'highlight'
  | 'quote'
  | 'comparison'
  | 'event'
  | 'media'
  | 'data'
  | 'spatial';

export type TemplateBodyPolicy = 'complete' | 'derived' | 'ignored' | 'structured';

export interface TemplateAuthoringMetadata {
  /** Broad semantic job, independent of visual theme. */
  role: TemplateAuthoringRole;
  /** How source body prose participates in the rendered result. */
  bodyPolicy: TemplateBodyPolicy;
  /** Whether this template is a loss-averse default before visual optimization. */
  safeForContentFirst: boolean;
  /** Preferred annotation placement. Standalone annotations remain supported for deliberate extra blocks. */
  placement: 'heading';
}

type BuiltInTemplateId = TemplateBlock['template'];

/**
 * Kept exhaustive over TemplateBlock so adding a template requires an explicit
 * statement about content retention before it can ship.
 */
export const TEMPLATE_AUTHORING_METADATA = {
  title: {
    role: 'opener',
    bodyPolicy: 'ignored',
    safeForContentFirst: false,
    placement: 'heading',
  },
  sectionHeader: {
    role: 'divider',
    bodyPolicy: 'ignored',
    safeForContentFirst: false,
    placement: 'heading',
  },
  content: {
    role: 'content',
    bodyPolicy: 'complete',
    safeForContentFirst: true,
    placement: 'heading',
  },
  statHighlight: {
    role: 'highlight',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  quote: { role: 'quote', bodyPolicy: 'derived', safeForContentFirst: false, placement: 'heading' },
  factCard: {
    role: 'highlight',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  twoColumn: {
    role: 'comparison',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  dateEvent: {
    role: 'event',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  imageWithCaption: {
    role: 'media',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  leftFeature: {
    role: 'media',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  rightFeature: {
    role: 'media',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  map: {
    role: 'spatial',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  fullBleedQuote: {
    role: 'quote',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  list: {
    role: 'content',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  photoGrid: {
    role: 'media',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  definitionCard: {
    role: 'content',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  comparisonBar: {
    role: 'comparison',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  pullQuote: {
    role: 'quote',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  videoWithCaption: {
    role: 'media',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  videoPullQuote: {
    role: 'media',
    bodyPolicy: 'derived',
    safeForContentFirst: false,
    placement: 'heading',
  },
  dataTable: {
    role: 'data',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  diagram: {
    role: 'spatial',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  tree: {
    role: 'spatial',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  timeline: {
    role: 'spatial',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  drawing: {
    role: 'spatial',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
  layout: {
    role: 'spatial',
    bodyPolicy: 'structured',
    safeForContentFirst: false,
    placement: 'heading',
  },
} as const satisfies Record<BuiltInTemplateId, TemplateAuthoringMetadata>;
