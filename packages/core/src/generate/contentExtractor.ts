/**
 * Content Extractor
 *
 * Pattern-based extraction of compelling content from plain text.
 * Identifies statistics, dates, quotes, comparisons, facts, impact lines,
 * lists, and definitions that can be turned into slideshow slides.
 *
 * Extraction is purely regex-based — no AI calls, no runtime costs,
 * deterministic and reproducible.
 */

// ── Types ──────────────────────────────────────────────────────────

/** Kinds of content the extractor recognises. */
export type ExtractionType =
  | 'stat'
  | 'date'
  | 'quote'
  | 'comparison'
  | 'fact'
  | 'impactLine'
  | 'list'
  | 'definition';

/** An extracted content element with source position. */
export interface ExtractedElement {
  type: ExtractionType;
  /** Full extracted text (usually the surrounding sentence). */
  text: string;
  /** Confidence score 0–1. */
  confidence: number;
  /** Character offset in the source text. */
  sourcePosition: number;
  /** Character offset where element ends. */
  endPosition: number;
  /** Type-specific structured payload. */
  data:
    | StatData
    | DateData
    | QuoteData
    | ComparisonData
    | FactData
    | ImpactLineData
    | ListData
    | DefinitionData;
}

export interface StatData {
  type: 'stat';
  value: string;
  unit?: string;
  description: string;
}

export interface DateData {
  type: 'date';
  date: string;
  description: string;
  mood?: 'neutral' | 'somber' | 'celebratory';
}

export interface QuoteData {
  type: 'quote';
  quote: string;
  attribution?: string;
}

export interface ComparisonData {
  type: 'comparison';
  left: { label: string; sublabel?: string };
  right: { label: string; sublabel?: string };
  header?: string;
}

export interface FactData {
  type: 'fact';
  fact: string;
  explanation?: string;
}

export interface ImpactLineData {
  type: 'impactLine';
  text: string;
}

export interface ListData {
  type: 'list';
  items: string[];
  title?: string;
}

export interface DefinitionData {
  type: 'definition';
  term: string;
  definition: string;
  origin?: string;
}

/** Options for `extractContent`. */
export interface ExtractionOptions {
  /** Minimum confidence threshold (default: 0.3). */
  minConfidence?: number;
  /** Which types to extract (default: all). */
  types?: ExtractionType[];
  /** Maximum extractions per type (default: unlimited). */
  maxPerType?: number;
}

/** Result of `extractContent`. */
export interface ExtractionResult {
  elements: ExtractedElement[];
  sourceLength: number;
  stats: {
    statCount: number;
    dateCount: number;
    quoteCount: number;
    comparisonCount: number;
    factCount: number;
    impactLineCount: number;
    listCount: number;
    definitionCount: number;
    totalCount: number;
  };
}

// ── Patterns ───────────────────────────────────────────────────────

const STAT_PATTERNS = [
  /\b(roughly |about |approximately |nearly |over |under |more than |less than )?([\d,]+(?:\.\d+)?)\s*%/gi,
  /\b([\d,]+(?:\.\d+)?)\s*(million|billion|trillion|thousand|hundred)\b/gi,
  /\b([\d,]+(?:\.\d+)?)\s*(miles?|feet|ft|meters?|m|kilometers?|km|acres?|square miles?|sq mi|hectares?)\b/gi,
  /\b([\d,]+(?:\.\d+)?)\s*(x|times)\b/gi,
  /\b([$€£¥])\s*([\d,]+(?:\.\d+)?)\s*(million|billion|thousand)?\b/gi,
  /\b(\d+)(st|nd|rd|th)\s+(largest|smallest|oldest|newest|most|least)/gi,
];

const DATE_PATTERNS = [
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2},?\s+)?(\d{4})\b/gi,
  /\b(\d{4})s\b|\b(\d{1,2})(st|nd|rd|th)\s+century\b/gi,
  /\b(from\s+)?(\d{4})\s*(to|–|-|through)\s*(\d{4})\b/gi,
  /\b(in|by|since|after|before|during)\s+(\d{4})\b/gi,
];

const QUOTE_PATTERNS = [
  /"([^"]{15,200})"/g,
  /\u201c([^\u201d]{15,200})\u201d/g,
  /(\w+(?:\s+\w+)?)\s+(?:said|stated|wrote|noted|observed|commented),?\s*"([^"]+)"/gi,
];

// A single side of a comparison ("X" in "from X to Y"). Deliberately excludes
// sentence/clause terminators (. ! ? ;) and newlines so a capture group can
// never swallow text from an adjacent sentence. Without this, greedy `.{2,30}`
// matches across a period — e.g. "…contradicted from witness to witness.
// Robertson said…" yields right="witness. Robertson", producing a nonsensical
// "witness → witness. Robertson" slide. Commas and colons are allowed (ranges
// like "9:00 to 17:00", ratios); downstream label truncation trims commas.
const COMPARISON_SIDE = '[^.!?;\\r\\n]{2,30}';

const COMPARISON_PATTERNS = [
  new RegExp(`from\\s+(${COMPARISON_SIDE})\\s+to\\s+(${COMPARISON_SIDE})`, 'gi'),
  new RegExp(`(${COMPARISON_SIDE})\\s+(?:vs\\.?|versus)\\s+(${COMPARISON_SIDE})`, 'gi'),
  new RegExp(`(${COMPARISON_SIDE})\\s+compared\\s+to\\s+(${COMPARISON_SIDE})`, 'gi'),
];

// Words whose trailing period is an abbreviation, not a sentence end. Used by
// isSentenceBoundary() so names like "George W. Tibbetts" or "Quong Chong & Co."
// don't get split into fragments. Matched only when the entire preceding word
// equals one of these (case-insensitive), so "canal." / "taco." are unaffected.
const SENTENCE_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'mt',
  'jr',
  'sr',
  'gen',
  'col',
  'capt',
  'lt',
  'sgt',
  'rev',
  'hon',
  'sen',
  'rep',
  'gov',
  'pres',
  'vs',
  'etc',
  'inc',
  'co',
  'ltd',
  'corp',
  'al',
  'fig',
  'eg',
  'ie',
  'approx',
  'dept',
  'univ',
  'assn',
  'bros',
  'ave',
  'blvd',
  'rd',
]);

const FACT_INDICATORS = [
  'largest',
  'smallest',
  'oldest',
  'newest',
  'first',
  'last',
  'most',
  'least',
  'only',
  'unique',
  'rare',
  'famous',
  'important',
  'significant',
  'notable',
  'remarkable',
  'extraordinary',
  'crucial',
  'essential',
  'critical',
  'major',
  'key',
  'discovered',
  'founded',
  'established',
  'created',
  'built',
  'invented',
  'developed',
  'introduced',
  'pioneered',
  'transformed',
  'revolutionized',
  'changed',
  'shaped',
];

const SOMBER_INDICATORS = [
  'disaster',
  'tragedy',
  'death',
  'died',
  'killed',
  'destroyed',
  'devastated',
  'collapsed',
  'lost',
  'abandoned',
  'declined',
  'war',
  'battle',
  'conflict',
  'earthquake',
  'fire',
  'flood',
];

const CELEBRATORY_INDICATORS = [
  'celebration',
  'victory',
  'success',
  'achievement',
  'triumph',
  'opened',
  'completed',
  'inaugurated',
  'launched',
  'won',
  'record',
  'breakthrough',
  'milestone',
  'golden',
  'grand',
];

const IMPACT_VERBS = [
  'check',
  'watch',
  'stop',
  'prepare',
  'imagine',
  'consider',
  'look',
  'listen',
  'notice',
  'remember',
  'discover',
  'explore',
  'visit',
  'try',
  'experience',
  'avoid',
  'beware',
  'enjoy',
];

const LIST_PATTERNS = [
  /(?:including|such as|namely|like|features?|offers?)\s+([^.]{10,150})/gi,
  /(?:three|four|five|six|several|many|various)\s+(?:main|key|primary|notable|popular|important)?\s*\w+(?:\s+\w+)?:\s*([^.]{10,150})/gi,
];

const DEFINITION_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,3})\s+is\s+(?:a|an|the)\s+([^.]{10,120})/g,
  /known\s+as\s+([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,3}),\s+([^.]{10,120})/gi,
  /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,3})\s+refers?\s+to\s+([^.]{10,120})/g,
  /called\s+([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+){0,3}),?\s+(?:which|meaning|a)\s+([^.]{10,120})/gi,
];

// ── Main ───────────────────────────────────────────────────────────

/**
 * Extract compelling content from plain text.
 *
 * Call `stripMarkdown(text)` first if the input contains markdown.
 */
export function extractContent(text: string, options: ExtractionOptions = {}): ExtractionResult {
  const {
    minConfidence = 0.3,
    types = ['stat', 'date', 'quote', 'comparison', 'fact', 'impactLine', 'list', 'definition'],
    maxPerType,
  } = options;

  const elements: ExtractedElement[] = [];

  if (types.includes('stat')) elements.push(...extractStats(text));
  if (types.includes('date')) elements.push(...extractDates(text));
  if (types.includes('quote')) elements.push(...extractQuotes(text));
  if (types.includes('comparison')) elements.push(...extractComparisons(text));
  if (types.includes('fact')) elements.push(...extractFacts(text));
  if (types.includes('impactLine')) elements.push(...extractImpactLines(text));
  if (types.includes('list')) elements.push(...extractLists(text));
  if (types.includes('definition')) elements.push(...extractDefinitions(text));

  let filtered = elements.filter((e) => e.confidence >= minConfidence);

  if (maxPerType !== undefined) {
    const byType = new Map<ExtractionType, ExtractedElement[]>();
    for (const elem of filtered) {
      const list = byType.get(elem.type) || [];
      list.push(elem);
      byType.set(elem.type, list);
    }
    filtered = [];
    for (const [, list] of byType) {
      list.sort((a, b) => b.confidence - a.confidence);
      filtered.push(...list.slice(0, maxPerType));
    }
  }

  filtered.sort((a, b) => a.sourcePosition - b.sourcePosition);
  filtered = deduplicateOverlapping(filtered);

  return {
    elements: filtered,
    sourceLength: text.length,
    stats: {
      statCount: filtered.filter((e) => e.type === 'stat').length,
      dateCount: filtered.filter((e) => e.type === 'date').length,
      quoteCount: filtered.filter((e) => e.type === 'quote').length,
      comparisonCount: filtered.filter((e) => e.type === 'comparison').length,
      factCount: filtered.filter((e) => e.type === 'fact').length,
      impactLineCount: filtered.filter((e) => e.type === 'impactLine').length,
      listCount: filtered.filter((e) => e.type === 'list').length,
      definitionCount: filtered.filter((e) => e.type === 'definition').length,
      totalCount: filtered.length,
    },
  };
}

// ── Per-type extractors ────────────────────────────────────────────

function extractStats(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<number>();

  for (const pattern of STAT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const position = match.index;
      if (seen.has(position)) continue;
      seen.add(position);

      const context = getSentenceContext(text, position, match[0].length);
      const value = match[0].trim();

      elements.push({
        type: 'stat',
        text: context.sentence,
        confidence: calculateStatConfidence(value, context.sentence),
        sourcePosition: context.start,
        endPosition: context.end,
        data: { type: 'stat', value, description: cleanDescription(context.sentence, value) },
      });
    }
  }
  return elements;
}

function extractDates(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<number>();

  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const position = match.index;
      if (seen.has(position)) continue;
      seen.add(position);

      const context = getSentenceContext(text, position, match[0].length);
      const dateStr = match[0].trim();

      elements.push({
        type: 'date',
        text: context.sentence,
        confidence: calculateDateConfidence(dateStr, context.sentence),
        sourcePosition: context.start,
        endPosition: context.end,
        data: {
          type: 'date',
          date: dateStr,
          description: cleanDescription(context.sentence, dateStr),
          mood: detectMood(context.sentence),
        },
      });
    }
  }
  return elements;
}

function extractQuotes(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<number>();

  for (const pattern of QUOTE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const position = match.index;
      if (seen.has(position)) continue;
      seen.add(position);

      const quote = match.length > 2 ? match[2] : match[1];
      const attribution = match.length > 2 ? match[1] : undefined;
      if (quote.length < 15 || quote.length > 200) continue;

      elements.push({
        type: 'quote',
        text: match[0],
        confidence: calculateQuoteConfidence(quote),
        sourcePosition: position,
        endPosition: position + match[0].length,
        data: { type: 'quote', quote: quote.trim(), attribution: attribution?.trim() },
      });
    }
  }
  return elements;
}

function extractComparisons(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<number>();

  for (const pattern of COMPARISON_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const position = match.index;
      if (seen.has(position)) continue;
      seen.add(position);

      // Trim a trailing clause introduced by a comma + space ("retired
      // airliners, arranged in rows" → "retired airliners"). A greedy side
      // match often swallows the words after the compared thing; the comma is a
      // clause boundary, not part of the value. Numeric grouping commas
      // ("4,000") survive because those are comma+digit, not comma+space.
      const trimClause = (s: string) => s.replace(/,\s+.*$/, '').trim();
      const left = trimClause(match[1].trim());
      const right = trimClause(match[2].trim());
      if (left.length < 2 || left.length > 30) continue;
      if (right.length < 2 || right.length > 30) continue;
      // Reject "from X to X"-style idioms — "from witness to witness",
      // "from day to day", "from generation to generation". These mean "it
      // varied", not "A versus B", and render as a pointless "X → X" card.
      // The signature is a word repeated across the connector: the last word
      // of the left side equals the first word of the right side. (Greedy
      // matching may append trailing context to the right side, so a whole-
      // string equality check is not enough.)
      const wordsOf = (s: string) =>
        s
          .toLowerCase()
          .split(/\s+/)
          .map((w) => w.replace(/[^a-z0-9]+/g, ''))
          .filter(Boolean);
      const leftWords = wordsOf(left);
      const rightWords = wordsOf(right);
      if (
        leftWords.length > 0 &&
        rightWords.length > 0 &&
        leftWords[leftWords.length - 1] === rightWords[0]
      ) {
        continue;
      }

      const context = getSentenceContext(text, position, match[0].length);

      elements.push({
        type: 'comparison',
        text: context.sentence,
        confidence: 0.6,
        sourcePosition: context.start,
        endPosition: context.end,
        data: { type: 'comparison', left: { label: left }, right: { label: right } },
      });
    }
  }
  return elements;
}

/**
 * Whether the `. ! ?` at `index` is a real sentence terminator rather than a
 * period inside an abbreviation ("George W. Tibbetts", "M. DeWitt", "Mr.",
 * "U.S."), a single-letter initial, a decimal ("3.5"), or an ellipsis. Naive
 * splitting on every period produces broken fragments — e.g. the standalone
 * slide "They were met at George W" from "…at George W. Tibbetts' store…".
 * Returns false for any non-terminator character so callers can scan freely.
 */
function isSentenceBoundary(text: string, index: number): boolean {
  const ch = text[index];
  if (ch === '!' || ch === '?') return true;
  if (ch !== '.') return false;

  // Ellipsis: defer the boundary to the final dot in a run of dots.
  if (text[index + 1] === '.') return false;
  // Decimal number: digit "." digit → "3.5".
  if (/[0-9]/.test(text[index - 1] ?? '') && /[0-9]/.test(text[index + 1] ?? '')) return false;

  // The run of letters immediately preceding the period.
  let w = index - 1;
  while (w >= 0 && /[A-Za-z]/.test(text[w])) w--;
  const word = text.slice(w + 1, index);
  if (word.length === 1) return false; // single-letter initial: "George W."
  if (word && SENTENCE_ABBREVIATIONS.has(word.toLowerCase())) return false;

  // A genuine sentence starts with an uppercase letter, digit, or opening
  // quote/bracket. A lowercase continuation means the period was mid-sentence
  // (an abbreviation we didn't enumerate).
  let j = index + 1;
  while (j < text.length && /\s/.test(text[j])) j++;
  if (j >= text.length) return true; // end of text
  return !/[a-z]/.test(text[j]);
}

/**
 * Iterate over sentence-like spans in the text, yielding trimmed text and
 * accurate start/end indices within the original string.
 *
 * Boundaries are detected by isSentenceBoundary() so abbreviations, initials,
 * decimals, and ellipses do not split a sentence. Leading whitespace and
 * trailing whitespace/terminators are excluded from each span.
 */
function forEachSentenceSpan(
  text: string,
  callback: (trimmed: string, start: number, end: number) => void,
): void {
  const emit = (rawStart: number, rawEnd: number) => {
    let start = rawStart;
    while (start < rawEnd && /\s/.test(text[start])) start++;
    let end = rawEnd;
    while (end > start && /[\s.!?]/.test(text[end - 1])) end--;
    if (end <= start) return;
    const trimmed = text.slice(start, end);
    if (trimmed) callback(trimmed, start, end);
  };

  let spanStart = 0;
  let i = 0;
  while (i < text.length) {
    if (isSentenceBoundary(text, i)) {
      // Consume any consecutive terminators ("?!", "…") as one boundary.
      let end = i + 1;
      while (end < text.length && /[.!?]/.test(text[end])) end++;
      emit(spanStart, end);
      spanStart = end;
      i = end;
    } else {
      i++;
    }
  }
  if (spanStart < text.length) emit(spanStart, text.length);
}

function extractFacts(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];

  forEachSentenceSpan(text, (trimmed, start, end) => {
    if (trimmed.length <= 20) return;

    const score = scoreSentenceAsFact(trimmed);
    if (score < 0.4) return;

    elements.push({
      type: 'fact',
      text: trimmed,
      confidence: score,
      sourcePosition: start,
      endPosition: end,
      data: { type: 'fact', fact: trimmed },
    });
  });

  return elements;
}

function extractImpactLines(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];

  forEachSentenceSpan(text, (trimmed, start, end) => {
    if (trimmed.length < 8 || trimmed.length > 60) return;

    let score = 0.3;
    const lower = trimmed.toLowerCase();

    for (const verb of IMPACT_VERBS) {
      if (lower.startsWith(verb)) {
        score += 0.25;
        break;
      }
    }

    if (end < text.length && text[end] === '!') score += 0.15;
    if (trimmed.length < 30) score += 0.1;
    if (trimmed.includes(',')) score -= 0.1;
    if (/^(and|but|or|the|a|an)\b/i.test(trimmed)) score -= 0.15;
    if (score < 0.5) return;

    elements.push({
      type: 'impactLine',
      text: trimmed,
      confidence: Math.min(1, score),
      sourcePosition: start,
      endPosition: end,
      data: { type: 'impactLine', text: trimmed },
    });
  });

  return elements;
}

function extractLists(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<number>();

  for (const pattern of LIST_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const position = match.index;
      if (seen.has(position)) continue;
      seen.add(position);

      const listContent = match[1].trim();
      const items = listContent
        .split(/,\s*(?:and|or)\s+|,\s+|\s+and\s+|\s+or\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 60);

      if (items.length < 3 || items.length > 5) continue;

      const context = getSentenceContext(text, position, match[0].length);

      elements.push({
        type: 'list',
        text: context.sentence,
        confidence: 0.65,
        sourcePosition: context.start,
        endPosition: context.end,
        data: { type: 'list', items },
      });
    }
  }
  return elements;
}

function extractDefinitions(text: string): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const seen = new Set<number>();

  for (const pattern of DEFINITION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const position = match.index;
      if (seen.has(position)) continue;
      seen.add(position);

      const term = match[1].trim();
      const definition = match[2].trim();
      if (term.length < 3 || term.length > 30) continue;
      if (definition.length < 10 || definition.length > 120) continue;

      const context = getSentenceContext(text, position, match[0].length);

      elements.push({
        type: 'definition',
        text: context.sentence,
        confidence: 0.6,
        sourcePosition: context.start,
        endPosition: context.end,
        data: { type: 'definition', term, definition },
      });
    }
  }
  return elements;
}

// ── Helpers ────────────────────────────────────────────────────────

function getSentenceContext(
  text: string,
  matchStart: number,
  matchLength: number,
): { sentence: string; start: number; end: number } {
  let start = matchStart;
  while (start > 0 && !isSentenceBoundary(text, start - 1)) start--;
  while (start < matchStart && /\s/.test(text[start])) start++;

  let end = matchStart + matchLength;
  while (end < text.length && !isSentenceBoundary(text, end)) end++;
  if (end < text.length) end++;

  return { sentence: text.slice(start, end).trim(), start, end };
}

function calculateStatConfidence(value: string, context: string): number {
  let score = 0.5;
  if (value.includes('%')) score += 0.2;
  if (/million|billion|trillion/i.test(value)) score += 0.15;
  if (/increased|decreased|grew|dropped|rose|fell/i.test(context)) score += 0.15;
  if (context.length < 30) score -= 0.2;
  return Math.min(1, Math.max(0, score));
}

function calculateDateConfidence(date: string, context: string): number {
  let score = 0.5;
  if (
    /January|February|March|April|May|June|July|August|September|October|November|December/i.test(
      date,
    )
  )
    score += 0.2;
  if (/founded|established|built|opened|discovered|created/i.test(context)) score += 0.2;
  if (/happened|occurred|took place|began|ended/i.test(context)) score += 0.15;
  return Math.min(1, Math.max(0, score));
}

function calculateQuoteConfidence(quote: string): number {
  let score = 0.5;
  if (quote.length >= 30 && quote.length <= 150) score += 0.2;
  if (/\b(I|we|our|my)\b/i.test(quote)) score += 0.1;
  if (!/[.!?]$/.test(quote)) score -= 0.1;
  return Math.min(1, Math.max(0, score));
}

function scoreSentenceAsFact(sentence: string): number {
  let score = 0.3;
  const lower = sentence.toLowerCase();
  for (const indicator of FACT_INDICATORS) {
    if (lower.includes(indicator)) {
      score += 0.1;
      break;
    }
  }
  const properNouns = sentence.match(/\b[A-Z][a-z]+\b/g);
  if (properNouns && properNouns.length >= 2) score += 0.15;
  if (/\d/.test(sentence)) score += 0.1;
  if (sentence.endsWith('?')) score -= 0.3;
  if (sentence.length > 200) score -= 0.15;
  return Math.min(1, Math.max(0, score));
}

function detectMood(sentence: string): 'neutral' | 'somber' | 'celebratory' {
  const lower = sentence.toLowerCase();
  for (const word of SOMBER_INDICATORS) {
    if (lower.includes(word)) return 'somber';
  }
  for (const word of CELEBRATORY_INDICATORS) {
    if (lower.includes(word)) return 'celebratory';
  }
  return 'neutral';
}

function cleanDescription(sentence: string, value: string): string {
  const prepositionPatterns = [
    new RegExp(`\\b[Ii]n\\s+${escapeRegex(value)}[,.]?\\s*`, 'g'),
    new RegExp(`\\b[Oo]n\\s+${escapeRegex(value)}[,.]?\\s*`, 'g'),
    new RegExp(`\\b[Dd]uring\\s+${escapeRegex(value)}[,.]?\\s*`, 'g'),
    new RegExp(`\\b[Bb]y\\s+${escapeRegex(value)}[,.]?\\s*`, 'g'),
    new RegExp(`\\b[Ss]ince\\s+${escapeRegex(value)}[,.]?\\s*`, 'g'),
    new RegExp(`\\b[Ff]rom\\s+${escapeRegex(value)}[,.]?\\s*`, 'g'),
  ];

  let desc = sentence;
  for (const pattern of prepositionPatterns) {
    desc = desc.replace(pattern, '');
  }
  if (desc === sentence) {
    desc = sentence.replace(value, '').trim();
  }

  desc = desc.replace(/^[,:\-–—]+\s*/, '').replace(/\s*[,:\-–—]+$/, '');
  desc = desc.replace(
    /\s+(?:of|on|in|at|by|to|for|from|with|about|over|under|between|than|into|onto|upon)\s*([,.])/gi,
    '$1',
  );
  desc = desc.replace(
    /\s+(?:for|of|to|in|at|by|with|from|about|over|under|between|than|into|onto|upon)\s*[.!?]?\s*$/i,
    '.',
  );
  desc = desc.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1');
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  return desc.trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TYPE_SPECIFICITY: Record<ExtractionType, number> = {
  stat: 5,
  date: 4,
  quote: 3,
  definition: 3,
  comparison: 2,
  list: 2,
  impactLine: 2,
  fact: 1,
};

function deduplicateOverlapping(elements: ExtractedElement[]): ExtractedElement[] {
  if (elements.length <= 1) return elements;

  const toRemove = new Set<number>();

  for (let i = 0; i < elements.length; i++) {
    if (toRemove.has(i)) continue;
    const a = elements[i];

    for (let j = i + 1; j < elements.length; j++) {
      if (toRemove.has(j)) continue;
      const b = elements[j];

      if (elementsOverlap(a, b)) {
        const aSpec = TYPE_SPECIFICITY[a.type];
        const bSpec = TYPE_SPECIFICITY[b.type];
        if (aSpec >= bSpec) {
          toRemove.add(j);
        } else {
          toRemove.add(i);
          break;
        }
      }
    }
  }

  return elements.filter((_, index) => !toRemove.has(index));
}

function elementsOverlap(a: ExtractedElement, b: ExtractedElement): boolean {
  if (a.sourcePosition === b.sourcePosition) return true;
  if (a.sourcePosition <= b.sourcePosition && a.endPosition >= b.endPosition) return true;
  if (b.sourcePosition <= a.sourcePosition && b.endPosition >= a.endPosition) return true;

  const overlapStart = Math.max(a.sourcePosition, b.sourcePosition);
  const overlapEnd = Math.min(a.endPosition, b.endPosition);
  if (overlapEnd > overlapStart) {
    const overlapLength = overlapEnd - overlapStart;
    const minLength = Math.min(a.endPosition - a.sourcePosition, b.endPosition - b.sourcePosition);
    if (overlapLength > minLength * 0.5) return true;
  }

  return false;
}

/**
 * Strip markdown formatting from text, returning plain prose.
 * Call this before `extractContent` if the input is markdown.
 */
export function stripMarkdown(markdown: string): string {
  return (
    markdown
      // Remove code blocks (before inline code)
      .replace(/```[\s\S]*?```/g, '')
      // Remove images (before links — `![` prefix distinguishes them)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      // Remove links, keeping text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^>\s+/gm, '')
      .replace(/^[-*_]{3,}$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
