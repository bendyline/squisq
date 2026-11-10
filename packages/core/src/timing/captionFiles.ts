/**
 * Caption and chapter files — a doc's timing as text other players read.
 *
 * A rendered video burns its captions into the picture, which is right for a
 * silent autoplay feed and wrong for everything else: a viewer cannot turn
 * them off, a platform cannot translate or index them, and a screen reader
 * cannot read them. These writers turn the same `CaptionTrack` the player
 * shows into the two sidecar formats every video host accepts, SubRip (`.srt`)
 * and WebVTT (`.vtt`), and a doc's sections into a chapter list.
 *
 * All three are pure functions of the doc's own times, so a host that
 * post-processes the audio (a pre-roll, a trimmed take) passes an `offset`
 * rather than rewriting cues. A cue never runs past the start of the next
 * one, and cues with no words, or that end before they start, are left out.
 *
 * Related: `timing/captions.ts` (`buildCaptionTrack`), `schemas/Doc.ts`
 * (`CaptionTrack`), the CLI's `video --captions`.
 */

import type { Block, CaptionTrack, Doc } from '../schemas/Doc.js';

export interface CaptionFileOptions {
  /** Seconds added to every time, for a video that starts before the doc does (a cover pre-roll). */
  offset?: number;
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

/** The track's phrases as cues in time order: trimmed, shifted, and never overlapping. */
function cuesOf(track: Pick<CaptionTrack, 'phrases'> | undefined, offset: number): Cue[] {
  const cues = (track?.phrases ?? [])
    .map((phrase) => ({
      start: Math.max(0, phrase.startTime + offset),
      end: Math.max(0, phrase.endTime + offset),
      text: phrase.text.replace(/\s+/gu, ' ').trim(),
    }))
    .filter((cue) => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end))
    .sort((a, b) => a.start - b.start);
  return cues
    .map((cue, index) => {
      const next = cues[index + 1];
      return next && cue.end > next.start ? { ...cue, end: next.start } : cue;
    })
    .filter((cue) => cue.end > cue.start);
}

/** `HH:MM:SS` and milliseconds, joined by the format's own separator. */
function timestamp(seconds: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return (
    `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:` +
    `${pad(Math.floor(total / 1000) % 60)}${separator}${pad(total % 1000, 3)}`
  );
}

/** A caption track as a SubRip (`.srt`) file; empty when it has no cues. */
export function formatCaptionsSrt(
  track: Pick<CaptionTrack, 'phrases'> | undefined,
  options: CaptionFileOptions = {},
): string {
  return cuesOf(track, options.offset ?? 0)
    .map(
      (cue, index) =>
        `${index + 1}\n${timestamp(cue.start, ',')} --> ${timestamp(cue.end, ',')}\n${cue.text}\n`,
    )
    .join('\n');
}

/**
 * A caption track as a WebVTT (`.vtt`) file. The header is always written,
 * so a track without cues is still a valid file.
 */
export function formatCaptionsVtt(
  track: Pick<CaptionTrack, 'phrases'> | undefined,
  options: CaptionFileOptions = {},
): string {
  // WebVTT reads `-->` as a cue's timing line and `&`, `<` as markup.
  const escape = (text: string) =>
    text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/-->/gu, '--&gt;');
  const cues = cuesOf(track, options.offset ?? 0).map(
    (cue) => `${timestamp(cue.start, '.')} --> ${timestamp(cue.end, '.')}\n${escape(cue.text)}\n`,
  );
  return ['WEBVTT\n', ...cues].join('\n');
}

/** One chapter of a doc: where a section starts, and what it is called. */
export interface DocChapter {
  /** Seconds from the start of the video. */
  startTime: number;
  title: string;
}

export interface DocChapterOptions extends CaptionFileOptions {
  /**
   * The shortest a chapter may be, in seconds (default 10). A section that
   * starts sooner after the one before it is folded into it: players and
   * platforms ignore chapter lists with very short entries.
   */
  minDuration?: number;
}

/**
 * A doc's chapters: its titled blocks, in time order, from the blocks as a
 * player schedules them (pass the doc after `resolveAudioMapping`, or the
 * blocks `expandDocBlocks` returns). Consecutive blocks with one title — a
 * section shown over several slides — are one chapter. The first chapter
 * starts at zero, as chapter lists must.
 */
export function docChapters(
  doc: Pick<Doc, 'blocks'> | readonly Block[],
  options: DocChapterOptions = {},
): DocChapter[] {
  const offset = options.offset ?? 0;
  const minDuration = options.minDuration ?? 10;
  const blocks = (
    Array.isArray(doc) ? doc : (doc as Pick<Doc, 'blocks'>).blocks
  ) as readonly Block[];
  const chapters: DocChapter[] = [];
  const visit = (list: readonly Block[]) => {
    for (const block of list) {
      const title = (block.title ?? '').replace(/\s+/gu, ' ').trim();
      const startTime = Math.max(0, (block.startTime ?? 0) + offset);
      const previous = chapters[chapters.length - 1];
      const opens =
        !previous || (title !== previous.title && startTime - previous.startTime >= minDuration);
      if (title && (block.duration ?? 0) > 0 && Number.isFinite(startTime) && opens)
        chapters.push({ startTime, title });
      if (block.children?.length) visit(block.children);
    }
  };
  visit(blocks);
  if (chapters.length) chapters[0] = { ...chapters[0]!, startTime: 0 };
  return chapters;
}

/**
 * Chapters as an FFmpeg metadata file (`ffmpeg -i video.mp4 -i chapters.txt
 * -map_metadata 1 -codec copy out.mp4`), which is how a chapter list is
 * written into an MP4. `duration` closes the last chapter.
 */
export function formatChaptersFfmetadata(
  chapters: readonly DocChapter[],
  duration: number,
): string {
  // The format's own special characters are escaped with a backslash.
  const escape = (text: string) => text.replace(/[=;#\\\n]/gu, (match) => `\\${match}`);
  const lines = [';FFMETADATA1'];
  chapters.forEach((chapter, index) => {
    const end = chapters[index + 1]?.startTime ?? Math.max(duration, chapter.startTime);
    lines.push(
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${Math.round(chapter.startTime * 1000)}`,
      `END=${Math.round(end * 1000)}`,
      `title=${escape(chapter.title)}`,
    );
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Chapters as the timestamp list video platforms read from a description
 * ("0:00 Introduction"). Hours appear only when the video runs past one.
 */
export function formatChaptersText(chapters: readonly DocChapter[]): string {
  const long = chapters.some((chapter) => chapter.startTime >= 3600);
  const stamp = (seconds: number) => {
    const total = Math.floor(seconds);
    const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
    const two = (value: number) => String(value).padStart(2, '0');
    return long ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
  };
  return chapters.map((chapter) => `${stamp(chapter.startTime)} ${chapter.title}`).join('\n');
}
