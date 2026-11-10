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

export { buildCaptionTrack } from './captions.js';
// Captions and chapters as the sidecar files video players and platforms read.
export {
  docChapters,
  formatCaptionsSrt,
  formatCaptionsVtt,
  formatChaptersFfmetadata,
  formatChaptersText,
} from './captionFiles.js';
export type { CaptionFileOptions, DocChapter, DocChapterOptions } from './captionFiles.js';
export type { BuildCaptionTrackOptions, CaptionSegmentSource } from './captions.js';

export { phraseOffset, phraseStartTime, wordTimeAt } from './wordTiming.js';
export type { PhraseTimeOptions, WordMark, WordSnap, WordTimeline } from './wordTiming.js';
