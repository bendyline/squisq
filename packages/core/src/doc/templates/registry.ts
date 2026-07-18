/** Runtime registry composition for built-in and document-scoped templates. */

import type { Layer } from '../../schemas/Doc.js';
import type {
  TemplateBlock,
  TemplateContext,
  TemplateRegistry,
} from '../../schemas/BlockTemplates.js';
import type { CustomTemplateDefinition } from '../../schemas/CustomTemplates.js';
import { makeCustomTemplateFn } from './customTemplate.js';

import { titleBlock } from './titleBlock.js';
import { sectionHeader } from './sectionHeader.js';
import { contentBlock } from './contentBlock.js';
import { statHighlight } from './statHighlight.js';
import { quoteBlock } from './quoteBlock.js';
import { factCard } from './factCard.js';
import { twoColumn } from './twoColumn.js';
import { dateEvent } from './dateEvent.js';
import { imageWithCaption } from './imageWithCaption.js';
import { leftFeature, rightFeature } from './featureBlock.js';
import { mapBlock } from './mapBlock.js';
import { fullBleedQuote } from './fullBleedQuote.js';
import { listBlock } from './listBlock.js';
import { photoGrid } from './photoGrid.js';
import { definitionCard } from './definitionCard.js';
import { comparisonBar } from './comparisonBar.js';
import { pullQuote } from './pullQuote.js';
import { videoWithCaption } from './videoWithCaption.js';
import { videoPullQuote } from './videoPullQuote.js';
import { dataTable } from './dataTable.js';
import {
  areaChart,
  barChart,
  columnChart,
  donutChart,
  lineChart,
  pieChart,
  scatterChart,
} from './chartBlock.js';
import { diagramBlock } from './diagramBlock.js';
import { treeBlock } from './treeBlock.js';
import { timelineBlock } from './timelineBlock.js';
import { drawingBlock } from './drawingBlock.js';
import { layoutBlock } from './layoutBlock.js';

/** Built-in templates keyed by the ids used in document annotations. */
export const templateRegistry: TemplateRegistry = {
  title: titleBlock,
  sectionHeader,
  content: contentBlock,
  statHighlight,
  quote: quoteBlock,
  factCard,
  twoColumn,
  dateEvent,
  imageWithCaption,
  leftFeature,
  rightFeature,
  map: mapBlock,
  fullBleedQuote,
  list: listBlock,
  photoGrid,
  definitionCard,
  comparisonBar,
  pullQuote,
  videoWithCaption,
  videoPullQuote,
  dataTable,
  barChart,
  columnChart,
  pieChart,
  donutChart,
  lineChart,
  areaChart,
  scatterChart,
  diagram: diagramBlock,
  tree: treeBlock,
  timeline: timelineBlock,
  layout: layoutBlock,
  drawing: drawingBlock,
};

/** Broad runtime view used after a template name has selected its function. */
export type RuntimeTemplateRegistry = Record<
  string,
  (input: TemplateBlock, context: TemplateContext) => Layer[]
>;

/** Merge document-scoped templates without mutating the built-in registry. */
export function buildRegistry(
  custom?: readonly CustomTemplateDefinition[],
): RuntimeTemplateRegistry {
  const merged: RuntimeTemplateRegistry = {
    ...(templateRegistry as unknown as RuntimeTemplateRegistry),
  };
  if (custom) {
    for (const definition of custom) {
      if (merged[definition.name]) continue;
      merged[definition.name] = makeCustomTemplateFn(
        definition,
      ) as unknown as RuntimeTemplateRegistry[string];
    }
  }
  return merged;
}
