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

export {
  calculateKeywordAffinity,
  extractKeywords,
  matchByKeywordAffinity,
  selectSafeZoneClips,
  selectTranscriptClips,
} from './mediaMatching.js';
export type {
  AffinityAssignment,
  AffinityMatchResult,
  AffinityTarget,
  ClipSelectionOptions,
  ClipSource,
  KeywordExtractionOptions,
  SelectedClip,
  TranscriptSegmentSource,
} from './mediaMatching.js';
