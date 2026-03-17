export { extractContent, stripMarkdown } from './contentExtractor.js';
export type {
  ExtractionType,
  ExtractedElement,
  StatData,
  DateData,
  QuoteData,
  ComparisonData,
  FactData,
  ImpactLineData,
  ListData,
  DefinitionData,
  ExtractionOptions,
  ExtractionResult,
} from './contentExtractor.js';

export { mapElementToBlock } from './templateMapper.js';
export type { MapOptions } from './templateMapper.js';

export { generateSlideshow } from './slideshowGenerator.js';
export type { SlideshowDoc, SlideshowImage, SlideshowOptions } from './slideshowGenerator.js';
