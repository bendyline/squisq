export {
  DEFAULT_WORDS_PER_SECOND,
  estimateSpokenWordCount,
  countSpokenWords,
  estimateTimeFromText,
  calculatePrefixDuration,
  estimateNarrationDuration,
} from './narrationTiming.js';

export { estimateReadingTime, estimateNarrationTime } from './readingTime.js';

export type {
  ReadingTimeEstimate,
  ReadingTimeOptions,
  NarrationTimeEstimate,
  NarrationTimeOptions,
} from './readingTime.js';
