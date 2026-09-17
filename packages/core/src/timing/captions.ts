/**
 * Caption Track Construction
 *
 * Converts narration segment text and optional word/bookmark timing into the
 * canonical Doc CaptionTrack. Hosts retain responsibility for mapping their
 * domain model and timing sidecars into CaptionSegmentSource records.
 */

import type {
  AudioSegment,
  AudioTimingData,
  CaptionPhrase,
  CaptionTrack,
  CaptionWord,
} from '../schemas/Doc.js';
import { estimateTimeFromText } from './narrationTiming.js';

export interface CaptionSegmentSource {
  segment: AudioSegment;
  text?: string | null;
  spokenPrefix?: string;
  timing?: AudioTimingData | null;
}

export interface BuildCaptionTrackOptions {
  version?: number;
  generatedAt?: string;
  targetWordsPerPhrase?: number;
  minPhraseDuration?: number;
  maxPhraseDuration?: number;
  wordsPerSecond?: number;
  closePhraseGaps?: boolean;
}

const DEFAULT_VERSION = 1;
const DEFAULT_TARGET_WORDS = 10;
const DEFAULT_MIN_DURATION = 1.5;
const DEFAULT_MAX_DURATION = 6;
const DEFAULT_WORDS_PER_SECOND = 2.5;

function phrasesFromTiming(
  source: CaptionSegmentSource,
  segmentIndex: number,
  targetWords: number,
): CaptionPhrase[] {
  const { segment, timing } = source;
  if (!timing || timing.bookmarks.length === 0) return [];
  const segmentEnd = segment.startTime + segment.duration;

  const phrases: CaptionPhrase[] = [];
  let words: CaptionWord[] = [];
  let phraseText = '';

  for (let index = 0; index < timing.bookmarks.length; index += 1) {
    const bookmark = timing.bookmarks[index];
    const text = bookmark.textFragment?.trim() ?? '';
    if (!text) continue;

    const next = timing.bookmarks[index + 1];
    const startTime = Math.min(
      segmentEnd,
      Math.max(segment.startTime, segment.startTime + bookmark.time),
    );
    const endTime = Math.min(
      segmentEnd,
      Math.max(startTime, segment.startTime + (next?.time ?? timing.duration)),
    );
    const word: CaptionWord = {
      text,
      startTime,
      endTime,
    };
    words.push(word);
    phraseText += `${phraseText ? ' ' : ''}${text}`;

    const flush =
      (/[.!?]$/.test(text) && words.length >= 4) ||
      (/[,;:]$/.test(text) && words.length >= targetWords - 2) ||
      words.length >= targetWords + 3 ||
      index === timing.bookmarks.length - 1;

    if (flush) {
      phrases.push({
        text: phraseText,
        startTime: words[0].startTime,
        endTime: words[words.length - 1].endTime,
        audioSegment: segmentIndex,
        words,
      });
      words = [];
      phraseText = '';
    }
  }

  return phrases;
}

function phrasesFromText(
  source: CaptionSegmentSource,
  segmentIndex: number,
  options: Required<
    Pick<
      BuildCaptionTrackOptions,
      'targetWordsPerPhrase' | 'minPhraseDuration' | 'maxPhraseDuration' | 'wordsPerSecond'
    >
  >,
): CaptionPhrase[] {
  const { segment } = source;
  const sourceText = source.text?.trim();
  if (!sourceText) return [];

  const prefix = source.spokenPrefix ?? '';
  const prefixWords = prefix.split(/\s+/).filter(Boolean).length;
  const prefixDuration = Math.min(
    segment.duration,
    prefixWords / options.wordsPerSecond + (prefix.match(/\n\n/g)?.length ?? 0) * 0.5,
  );
  const contentDuration = Math.max(0, segment.duration - prefixDuration);
  const phrases: CaptionPhrase[] = [];
  const prefixText = prefix.replace(/\n+/g, ' ').trim();

  if (prefixText && prefixDuration > 0.5) {
    phrases.push({
      text: prefixText,
      startTime: segment.startTime,
      endTime: Math.min(segment.startTime + segment.duration, segment.startTime + prefixDuration),
      audioSegment: segmentIndex,
    });
  }

  const sentences = sourceText
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  let phraseText = '';
  let phraseWordCount = 0;
  let phraseStartOffset = 0;
  let currentOffset = 0;

  const flush = (): void => {
    if (!phraseText) return;
    const startTime =
      segment.startTime +
      prefixDuration +
      estimateTimeFromText(sourceText, phraseStartOffset, contentDuration);
    const estimatedEnd =
      segment.startTime +
      prefixDuration +
      estimateTimeFromText(sourceText, currentOffset, contentDuration);
    phrases.push({
      text: phraseText,
      startTime,
      endTime: Math.min(
        segment.startTime + segment.duration,
        Math.min(
          Math.max(startTime + options.minPhraseDuration, estimatedEnd),
          startTime + options.maxPhraseDuration,
        ),
      ),
      audioSegment: segmentIndex,
    });
    phraseText = '';
    phraseWordCount = 0;
    phraseStartOffset = currentOffset;
  };

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;
    if (
      phraseWordCount > 0 &&
      phraseWordCount + sentenceWords > options.targetWordsPerPhrase * 1.5
    ) {
      flush();
    }
    phraseText += `${phraseText ? ' ' : ''}${sentence}`;
    phraseWordCount += sentenceWords;
    currentOffset += sentence.length + 1;
    if (phraseWordCount >= options.targetWordsPerPhrase) flush();
  }
  flush();
  return phrases;
}

export function buildCaptionTrack(
  sources: CaptionSegmentSource[],
  options: BuildCaptionTrackOptions = {},
): CaptionTrack {
  const targetWordsPerPhrase = options.targetWordsPerPhrase ?? DEFAULT_TARGET_WORDS;
  const textOptions = {
    targetWordsPerPhrase,
    minPhraseDuration: options.minPhraseDuration ?? DEFAULT_MIN_DURATION,
    maxPhraseDuration: options.maxPhraseDuration ?? DEFAULT_MAX_DURATION,
    wordsPerSecond: options.wordsPerSecond ?? DEFAULT_WORDS_PER_SECOND,
  };
  if (!Number.isInteger(targetWordsPerPhrase) || targetWordsPerPhrase < 1) {
    throw new Error('targetWordsPerPhrase must be a positive integer');
  }
  if (!Number.isFinite(textOptions.wordsPerSecond) || textOptions.wordsPerSecond <= 0) {
    throw new Error('wordsPerSecond must be a positive finite number');
  }
  if (
    !Number.isFinite(textOptions.minPhraseDuration) ||
    !Number.isFinite(textOptions.maxPhraseDuration) ||
    textOptions.minPhraseDuration < 0 ||
    textOptions.maxPhraseDuration < textOptions.minPhraseDuration
  ) {
    throw new Error(
      'caption phrase durations must be finite with max greater than or equal to min',
    );
  }
  const phrases = sources.flatMap((source, segmentIndex) => {
    const timed = phrasesFromTiming(source, segmentIndex, targetWordsPerPhrase);
    return timed.length > 0 ? timed : phrasesFromText(source, segmentIndex, textOptions);
  });

  if (options.closePhraseGaps ?? true) {
    for (let index = 0; index < phrases.length - 1; index += 1) {
      if (phrases[index].audioSegment === phrases[index + 1].audioSegment) {
        phrases[index].endTime = Math.max(phrases[index].startTime, phrases[index + 1].startTime);
      }
    }
    for (let segmentIndex = 0; segmentIndex < sources.length; segmentIndex += 1) {
      const segment = sources[segmentIndex].segment;
      let last: CaptionPhrase | undefined;
      for (let index = phrases.length - 1; index >= 0; index -= 1) {
        if (phrases[index].audioSegment === segmentIndex) {
          last = phrases[index];
          break;
        }
      }
      if (last) {
        const segmentEnd = segment.startTime + segment.duration;
        last.endTime = Math.min(segmentEnd, Math.max(last.endTime, segmentEnd - 0.05));
      }
    }
  }

  return {
    phrases,
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    version: options.version ?? DEFAULT_VERSION,
  };
}
