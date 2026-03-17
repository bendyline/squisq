/**
 * Template Mapper
 *
 * Converts extracted content elements into squisq TemplateBlock inputs.
 * Each ExtractionType maps to a specific template from BlockTemplates.
 */

import type {
  ExtractedElement,
  StatData,
  DateData,
  QuoteData,
  ComparisonData,
  FactData,
  ImpactLineData,
  ListData,
  DefinitionData,
} from './contentExtractor.js';

import type {
  StatHighlightInput,
  QuoteBlockInput,
  FactCardInput,
  TwoColumnInput,
  DateEventInput,
  FullBleedQuoteInput,
  ListBlockInput,
  DefinitionCardInput,
  TemplateBlock,
  ColorScheme,
  AccentImage,
} from '../schemas/BlockTemplates.js';

/** Options for mapping an element to a template block. */
export interface MapOptions {
  id: string;
  duration: number;
  audioSegment: number;
  colorScheme?: ColorScheme;
  accentImage?: AccentImage;
  sourceStartTime?: number;
  sourceDuration?: number;
}

/**
 * Convert an extracted element into the matching squisq TemplateBlock.
 */
export function mapElementToBlock(element: ExtractedElement, options: MapOptions): TemplateBlock {
  const base = {
    id: options.id,
    duration: options.duration,
    audioSegment: options.audioSegment,
    sourceStartTime: options.sourceStartTime,
    sourceDuration: options.sourceDuration,
  };

  switch (element.data.type) {
    case 'stat':
      return mapStat(element.data, base, options);
    case 'date':
      return mapDate(element.data, base, options);
    case 'quote':
      return mapQuote(element.data, base, options);
    case 'comparison':
      return mapComparison(element.data, base, options);
    case 'fact':
      return mapFact(element.data, base, options);
    case 'impactLine':
      return mapImpactLine(element.data, base, options);
    case 'list':
      return mapList(element.data, base, options);
    case 'definition':
      return mapDefinition(element.data, base, options);
  }
}

// ── Per-type mappers ───────────────────────────────────────────────

type Base = {
  id: string;
  duration: number;
  audioSegment: number;
  sourceStartTime?: number;
  sourceDuration?: number;
};

function mapStat(data: StatData, base: Base, opts: MapOptions): StatHighlightInput {
  return {
    ...base,
    template: 'statHighlight',
    stat: data.value,
    description: data.description,
    colorScheme: opts.colorScheme,
    accentImage: opts.accentImage,
  };
}

function mapDate(data: DateData, base: Base, opts: MapOptions): DateEventInput {
  return {
    ...base,
    template: 'dateEvent',
    date: data.date,
    description: data.description,
    mood: data.mood,
    accentImage: opts.accentImage,
  };
}

function mapQuote(data: QuoteData, base: Base, opts: MapOptions): QuoteBlockInput {
  return {
    ...base,
    template: 'quoteBlock',
    quote: data.quote,
    attribution: data.attribution,
    accentImage: opts.accentImage,
  };
}

function mapComparison(data: ComparisonData, base: Base, opts: MapOptions): TwoColumnInput {
  return {
    ...base,
    template: 'twoColumn',
    left: data.left,
    right: data.right,
    header: data.header,
    leftColor: opts.colorScheme,
  };
}

function mapFact(data: FactData, base: Base, opts: MapOptions): FactCardInput {
  return {
    ...base,
    template: 'factCard',
    fact: data.fact,
    explanation: data.explanation ?? '',
    accentImage: opts.accentImage,
  };
}

function mapImpactLine(data: ImpactLineData, base: Base, opts: MapOptions): FullBleedQuoteInput {
  return {
    ...base,
    template: 'fullBleedQuote',
    text: data.text,
    colorScheme: opts.colorScheme,
  };
}

function mapList(data: ListData, base: Base, opts: MapOptions): ListBlockInput {
  return {
    ...base,
    template: 'listBlock',
    items: data.items,
    title: data.title,
    colorScheme: opts.colorScheme,
    accentImage: opts.accentImage,
  };
}

function mapDefinition(data: DefinitionData, base: Base, opts: MapOptions): DefinitionCardInput {
  return {
    ...base,
    template: 'definitionCard',
    term: data.term,
    definition: data.definition,
    origin: data.origin,
    colorScheme: opts.colorScheme,
    accentImage: opts.accentImage,
  };
}
