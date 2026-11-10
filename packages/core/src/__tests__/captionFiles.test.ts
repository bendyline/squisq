import { describe, expect, it } from 'vitest';
import type { Block, CaptionTrack } from '../schemas/Doc.js';
import {
  docChapters,
  formatCaptionsSrt,
  formatCaptionsVtt,
  formatChaptersFfmetadata,
  formatChaptersText,
} from '../timing/captionFiles.js';

const track: CaptionTrack = {
  version: 1,
  phrases: [
    { text: 'The tide comes in', startTime: 0.25, endTime: 2.4, audioSegment: 0 },
    // Overlaps the next phrase: a cue never runs past the start of the next.
    { text: 'twice  a day —\nand <drains> itself.', startTime: 2.4, endTime: 6.2, audioSegment: 0 },
    { text: 'That is A --> B.', startTime: 5.5, endTime: 3661.007, audioSegment: 1 },
    // No words, and an end before its start: both are left out.
    { text: '   ', startTime: 7, endTime: 8, audioSegment: 1 },
    { text: 'Backwards', startTime: 9000, endTime: 8999, audioSegment: 1 },
  ],
};

describe('caption files', () => {
  it('writes SubRip cues, numbered, with comma milliseconds', () => {
    expect(formatCaptionsSrt(track)).toBe(
      [
        '1',
        '00:00:00,250 --> 00:00:02,400',
        'The tide comes in',
        '',
        '2',
        '00:00:02,400 --> 00:00:05,500',
        'twice a day — and <drains> itself.',
        '',
        '3',
        '00:00:05,500 --> 01:01:01,007',
        'That is A --> B.',
        '',
      ].join('\n'),
    );
    expect(formatCaptionsSrt(undefined)).toBe('');
  });

  it('writes WebVTT with its header, dot milliseconds, and markup escaped', () => {
    const vtt = formatCaptionsVtt(track);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.250 --> 00:00:02.400\nThe tide comes in\n')).toBe(
      true,
    );
    expect(vtt).toContain('twice a day — and &lt;drains> itself.');
    expect(vtt).toContain('That is A --&gt; B.');
    // A track without cues is still a valid file.
    expect(formatCaptionsVtt({ phrases: [] })).toBe('WEBVTT\n');
  });

  it('shifts every cue for a video that starts before the doc', () => {
    expect(formatCaptionsSrt(track, { offset: 3 })).toContain('00:00:03,250 --> 00:00:05,400');
  });
});

describe('doc chapters', () => {
  const block = (title: string, startTime: number, duration = 20): Block => ({
    id: title || `b-${startTime}`,
    title,
    startTime,
    duration,
    audioSegment: 0,
  });
  const blocks = [
    block('Opening', 2),
    block('The harbor', 22),
    // The same section over a second slide, and one too short to be a chapter.
    block('The harbor', 42),
    block('Aside', 62, 4),
    block('What changed', 66),
    block('', 86),
  ];

  it('lists titled sections in order, the first from zero', () => {
    expect(docChapters(blocks)).toEqual([
      { startTime: 0, title: 'Opening' },
      { startTime: 22, title: 'The harbor' },
      { startTime: 62, title: 'Aside' },
      // Four seconds after "Aside" is too soon for a chapter of its own.
    ]);
    expect(docChapters({ blocks }, { minDuration: 2 }).map((chapter) => chapter.title)).toEqual([
      'Opening',
      'The harbor',
      'Aside',
      'What changed',
    ]);
  });

  it('formats chapters for FFmpeg and for a description', () => {
    const chapters = docChapters(blocks, { minDuration: 2 });
    expect(formatChaptersFfmetadata(chapters.slice(0, 2), 120)).toBe(
      [
        ';FFMETADATA1',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=0',
        'END=22000',
        'title=Opening',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=22000',
        'END=120000',
        'title=The harbor',
        '',
      ].join('\n'),
    );
    expect(formatChaptersFfmetadata([{ startTime: 0, title: 'A=B; #1' }], 5)).toContain(
      'title=A\\=B\\; \\#1',
    );
    expect(formatChaptersText(chapters)).toBe(
      '0:00 Opening\n0:22 The harbor\n1:02 Aside\n1:06 What changed',
    );
    expect(formatChaptersText([{ startTime: 3725, title: 'Late' }])).toBe('1:02:05 Late');
  });
});
