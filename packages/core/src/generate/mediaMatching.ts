/**
 * Generic Media Matching and Clip Selection
 *
 * Provides domain-neutral keyword affinity, greedy section matching, and
 * safe-zone/transcript-aware video clip selection. Host applications supply
 * their own editorial metadata and policy before or after these primitives.
 */

import { SeededRandom } from '../random/SeededRandom.js';

const DEFAULT_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'each',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'more',
  'most',
  'of',
  'on',
  'or',
  'other',
  'our',
  'should',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'under',
  'until',
  'was',
  'we',
  'were',
  'when',
  'where',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

export interface KeywordExtractionOptions {
  stopwords?: Iterable<string>;
  minWordLength?: number;
  includeBigrams?: boolean;
}

export function extractKeywords(text: string, options: KeywordExtractionOptions = {}): string[] {
  if (!text) return [];
  const stopwords = new Set(DEFAULT_STOPWORDS);
  for (const word of options.stopwords ?? []) stopwords.add(word.toLowerCase());
  const minimum = options.minWordLength ?? 3;
  const words = text
    .toLowerCase()
    .replace(/[.,;:!?\u2018\u2019'"()[\]{}\u2014\u2013-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const result = new Set<string>();
  const eligible = (word: string): boolean => word.length >= minimum && !stopwords.has(word);

  for (const word of words) if (eligible(word)) result.add(word);
  if (options.includeBigrams ?? true) {
    for (let index = 0; index < words.length - 1; index += 1) {
      if (eligible(words[index]) && eligible(words[index + 1])) {
        result.add(`${words[index]}_${words[index + 1]}`);
      }
    }
  }
  return [...result];
}

export function calculateKeywordAffinity(
  first: readonly string[],
  second: readonly string[],
): number {
  if (first.length === 0 || second.length === 0) return 0;
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  let overlap = 0;
  for (const keyword of firstSet) {
    if (secondSet.has(keyword)) overlap += keyword.includes('_') ? 2 : 1;
  }
  return Math.min(1, overlap / Math.min(firstSet.size, secondSet.size));
}

export interface AffinityTarget<Key extends string = string> {
  key: Key;
  keywords: readonly string[];
  capacity?: number;
}

export interface AffinityAssignment<Key extends string = string> {
  mediaIndex: number;
  targetKey: Key;
  score: number;
}

export interface AffinityMatchResult<Key extends string = string> {
  assignments: AffinityAssignment<Key>[];
  unmatchedMedia: number[];
}

/** Greedily assign each media item once to the highest-affinity target. */
export function matchByKeywordAffinity<Key extends string = string>(
  mediaKeywords: ReadonlyArray<readonly string[]>,
  targets: ReadonlyArray<AffinityTarget<Key>>,
  minimumScore = 0,
): AffinityMatchResult<Key> {
  const candidates: AffinityAssignment<Key>[] = [];
  for (let mediaIndex = 0; mediaIndex < mediaKeywords.length; mediaIndex += 1) {
    for (const target of targets) {
      const score = calculateKeywordAffinity(mediaKeywords[mediaIndex], target.keywords);
      if (score >= minimumScore && score > 0)
        candidates.push({ mediaIndex, targetKey: target.key, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.mediaIndex - right.mediaIndex);

  const assignments: AffinityAssignment<Key>[] = [];
  const assignedMedia = new Set<number>();
  const targetCounts = new Map<Key, number>();
  for (const candidate of candidates) {
    if (assignedMedia.has(candidate.mediaIndex)) continue;
    const target = targets.find((item) => item.key === candidate.targetKey);
    const capacity = target?.capacity ?? 1;
    if ((targetCounts.get(candidate.targetKey) ?? 0) >= capacity) continue;
    assignments.push(candidate);
    assignedMedia.add(candidate.mediaIndex);
    targetCounts.set(candidate.targetKey, (targetCounts.get(candidate.targetKey) ?? 0) + 1);
  }

  return {
    assignments,
    unmatchedMedia: mediaKeywords
      .map((_, index) => index)
      .filter((index) => !assignedMedia.has(index)),
  };
}

export interface ClipSource {
  src: string;
  duration: number;
  posterSrc?: string;
  alt?: string;
  credit?: string;
  license?: string;
}

export interface SelectedClip extends ClipSource {
  clipStart: number;
  clipEnd: number;
  sourceDuration: number;
}

export interface ClipSelectionOptions {
  clipCount?: number;
  minClipDuration?: number;
  maxClipDuration?: number;
  introSkipFraction?: number;
  outroSkipFraction?: number;
  seed?: number;
}

const CLIP_DEFAULTS: Required<ClipSelectionOptions> = {
  clipCount: 3,
  minClipDuration: 8,
  maxClipDuration: 20,
  introSkipFraction: 0.1,
  outroSkipFraction: 0.1,
  seed: 42,
};

export function selectSafeZoneClips(
  source: ClipSource,
  options: ClipSelectionOptions = {},
): SelectedClip[] {
  const settings = { ...CLIP_DEFAULTS, ...options };
  if (source.duration <= 0 || settings.clipCount <= 0) return [];
  const safeStart = source.duration * settings.introSkipFraction;
  const safeEnd = source.duration * (1 - settings.outroSkipFraction);
  const safeDuration = safeEnd - safeStart;
  if (safeDuration < settings.minClipDuration) {
    return [toClip(source, 0, Math.min(source.duration, settings.maxClipDuration))];
  }

  const count = Math.min(settings.clipCount, Math.floor(safeDuration / settings.minClipDuration));
  const random = new SeededRandom(settings.seed);
  const interval = safeDuration / count;
  return Array.from({ length: count }, (_, index) => {
    const intervalStart = safeStart + index * interval;
    const intervalEnd = intervalStart + interval;
    const requestedDuration =
      settings.minClipDuration +
      random.next() * (settings.maxClipDuration - settings.minClipDuration);
    const clipDuration = Math.min(requestedDuration, interval, safeDuration);
    const jitter = (random.next() - 0.5) * interval * 0.5;
    const center = Math.max(
      intervalStart + clipDuration / 2,
      Math.min(intervalEnd - clipDuration / 2, (intervalStart + intervalEnd) / 2 + jitter),
    );
    const start = Math.max(safeStart, center - clipDuration / 2);
    return toClip(source, start, Math.min(safeEnd, start + clipDuration));
  });
}

export interface TranscriptSegmentSource {
  startTime: number;
  endTime: number;
  text: string;
  keywords?: readonly string[];
}

export function selectTranscriptClips(
  source: ClipSource,
  transcript: ReadonlyArray<TranscriptSegmentSource>,
  matchText: string,
  options: ClipSelectionOptions = {},
): SelectedClip[] {
  const settings = { ...CLIP_DEFAULTS, ...options };
  const safeStart = source.duration * settings.introSkipFraction;
  const safeEnd = source.duration * (1 - settings.outroSkipFraction);
  const matchKeywords = extractKeywords(matchText);
  const ranked = transcript
    .filter((segment) => segment.startTime >= safeStart && segment.endTime <= safeEnd)
    .map((segment) => ({
      segment,
      score: calculateKeywordAffinity(
        matchKeywords,
        segment.keywords ?? extractKeywords(segment.text),
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  const selected: TranscriptSegmentSource[] = [];
  for (const { segment } of ranked) {
    if (selected.length >= settings.clipCount) break;
    const center = (segment.startTime + segment.endTime) / 2;
    if (
      selected.every(
        (item) =>
          Math.abs((item.startTime + item.endTime) / 2 - center) >= settings.minClipDuration,
      )
    ) {
      selected.push(segment);
    }
  }
  const clips = selected.map((segment) => {
    const center = (segment.startTime + segment.endTime) / 2;
    const duration = Math.min(
      settings.maxClipDuration,
      Math.max(settings.minClipDuration, segment.endTime - segment.startTime + 4),
    );
    const start = Math.max(safeStart, center - duration / 2);
    return toClip(source, start, Math.min(safeEnd, start + duration));
  });
  if (clips.length < settings.clipCount) {
    clips.push(
      ...selectSafeZoneClips(source, {
        ...settings,
        clipCount: settings.clipCount - clips.length,
        seed: settings.seed + clips.length,
      }),
    );
  }
  return clips;
}

function toClip(source: ClipSource, start: number, end: number): SelectedClip {
  return {
    ...source,
    clipStart: Math.round(start * 100) / 100,
    clipEnd: Math.round(end * 100) / 100,
    sourceDuration: source.duration,
  };
}
