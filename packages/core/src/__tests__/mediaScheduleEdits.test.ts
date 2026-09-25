import { describe, expect, it } from 'vitest';
import { getDocPlaybackDuration, resolveMediaSchedule } from '../schemas/Media.js';
import type { Block, Doc } from '../schemas/Doc.js';
import type { MediaClip } from '../schemas/Media.js';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { docToMarkdown } from '../doc/docToMarkdown.js';
import { stringifyMarkdown } from '../markdown/stringify.js';
import { parseMediaFx } from '../mediaEdit/recipe.js';

function block(partial: Partial<Block>): Block {
  return {
    id: partial.id ?? 'b',
    startTime: partial.startTime ?? 0,
    duration: partial.duration ?? 60,
    audioSegment: 0,
    ...partial,
  };
}

function docWith(documentMedia: MediaClip[], blocks: Block[] = [block({})]): Doc {
  const lastEnd = blocks.reduce((m, b) => Math.max(m, b.startTime + b.duration), 0);
  return { articleId: 't', duration: lastEnd, blocks, audio: { segments: [] }, documentMedia };
}

const take: MediaClip = {
  id: 'take',
  src: 'video/take.webm',
  kind: 'video',
  placement: 'overlay',
  startAt: 2,
  clipStart: 1,
  clipEnd: 21,
  anchor: 'document',
};

describe('resolveMediaSchedule with edits', () => {
  it('leaves an unedited clip as one entry without recipe fields', () => {
    const [entry, ...rest] = resolveMediaSchedule(docWith([take]));
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ id: 'take', absoluteStart: 2, absoluteEnd: 22, sourceIn: 1 });
    expect(entry.segment).toBeUndefined();
    expect(entry.gain).toBeUndefined();
  });

  it('expands cuts into contiguous segments with fades only at the outer edges', () => {
    const clip: MediaClip = {
      ...take,
      edits: {
        cuts: [
          { start: 5, end: 7 },
          { start: 15, end: 16 },
        ],
        gain: -3,
        fadeIn: 0.5,
        fadeOut: 1,
        crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
      },
    };
    const schedule = resolveMediaSchedule(docWith([clip]));
    expect(schedule.map((c) => [c.id, c.absoluteStart, c.absoluteEnd, c.sourceIn])).toEqual([
      ['take#0', 2, 6, 1],
      ['take#1', 6, 14, 7],
      ['take#2', 14, 19, 16],
    ]);
    expect(schedule.map((c) => c.segment)).toEqual([
      { groupId: 'take', index: 0, count: 3 },
      { groupId: 'take', index: 1, count: 3 },
      { groupId: 'take', index: 2, count: 3 },
    ]);
    expect(schedule.map((c) => [c.fadeIn, c.fadeOut])).toEqual([
      [0.5, undefined],
      [undefined, undefined],
      [undefined, 1],
    ]);
    expect(schedule.every((c) => c.gain === -3)).toBe(true);
    expect(schedule.every((c) => c.crop?.x === 0.1)).toBe(true);
    expect(getDocPlaybackDuration(docWith([clip]))).toBe(60);
  });

  it('caps segments at the clip end when a block clamps it', () => {
    const clip: MediaClip = {
      id: 'm',
      src: 'a.webm',
      kind: 'audio',
      startAt: 0,
      clipEnd: 30,
      anchor: 'block',
      edits: { cuts: [{ start: 4, end: 6 }] },
    };
    const d = docWith([], [block({ id: 'b', duration: 10, media: [clip] })]);
    expect(
      resolveMediaSchedule(d).map((c) => [c.absoluteStart, c.absoluteEnd, c.sourceIn]),
    ).toEqual([
      [0, 4, 0],
      [4, 10, 6],
    ]);
  });

  it('uses the intrinsic duration minus cuts for an unlocked clip with no out-point', () => {
    const clip: MediaClip = {
      id: 'm',
      src: 'a.webm',
      kind: 'audio',
      startAt: 0,
      anchor: 'document',
      edits: { cuts: [{ start: 4, end: 6 }] },
    };
    const schedule = resolveMediaSchedule(docWith([clip]), { intrinsicDuration: () => 10 });
    expect(schedule[schedule.length - 1]?.absoluteEnd).toBe(8);
  });

  it('substitutes processed audio for an audio clip', () => {
    const clip: MediaClip = {
      id: 'n',
      src: 'audio/take.webm',
      kind: 'audio',
      startAt: 0,
      anchor: 'document',
      edits: { fx: parseMediaFx('denoise')! },
    };
    const [entry] = resolveMediaSchedule(docWith([clip]), {
      processedAudio: () => '.mediaEdits/take.aaaaaaaaaaaa.webm',
    });
    expect(entry.src).toBe('.mediaEdits/take.aaaaaaaaaaaa.webm');
    expect(entry.originalSrc).toBe('audio/take.webm');
  });

  it('mutes an edited video and adds a companion audio entry per segment', () => {
    const clip: MediaClip = {
      ...take,
      edits: { fx: parseMediaFx('loudness')!, cuts: [{ start: 5, end: 7 }] },
    };
    const schedule = resolveMediaSchedule(docWith([clip]), {
      processedAudio: () => 'render.webm',
    });
    expect(schedule.map((c) => [c.id, c.kind, c.src, c.audioMuted ?? false])).toEqual([
      ['take#0', 'video', 'video/take.webm', true],
      ['take#0~audio', 'audio', 'render.webm', false],
      ['take#1', 'video', 'video/take.webm', true],
      ['take#1~audio', 'audio', 'render.webm', false],
    ]);
    const companion = schedule[1];
    expect(companion.derivedFrom).toBe('take');
    expect(companion.placement).toBeUndefined();
    expect(companion.segment).toEqual({ groupId: 'take~audio', index: 0, count: 2 });
    expect([companion.absoluteStart, companion.absoluteEnd, companion.sourceIn]).toEqual([
      schedule[0].absoluteStart,
      schedule[0].absoluteEnd,
      schedule[0].sourceIn,
    ]);
  });

  it('plays the original audio when no render is available', () => {
    const clip: MediaClip = { ...take, edits: { fx: parseMediaFx('loudness')! } };
    const schedule = resolveMediaSchedule(docWith([clip]), { processedAudio: () => undefined });
    expect(schedule).toHaveLength(1);
    expect(schedule[0].audioMuted).toBeUndefined();
  });
});

describe('recipe authoring round-trip', () => {
  it('parses annotation and HTML recipes into clips', () => {
    const md = `{[audio src=audio/take.webm anchor=document fx="denoise loudness:-14" cuts="1-2 5-6" fadeIn=0.25]}

# One

<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-crop="0.1 0.1 0.8 0.8" data-squisq-video-group="rec-a"></video>
`;
    const doc = markdownToDoc(parseMarkdown(md));
    const narration = doc.documentMedia?.find((c) => c.kind === 'audio');
    expect(narration?.edits?.fx?.ops.map((o) => o.id)).toEqual(['denoise', 'loudness']);
    expect(narration?.edits?.cuts).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 6 },
    ]);
    expect(narration?.edits?.fadeIn).toBe(0.25);
    const screen = doc.documentMedia?.find((c) => c.kind === 'video');
    expect(screen?.edits).toEqual({ crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, group: 'rec-a' });
    // Authored lines round-trip byte-stably.
    expect(stringifyMarkdown(docToMarkdown(doc))).toBe(md);
  });

  it('serializes the recipe of a programmatic clip', () => {
    const doc = docWith([
      {
        id: 'p',
        src: 'audio/p.webm',
        kind: 'audio',
        startAt: 0,
        anchor: 'document',
        edits: { fx: parseMediaFx('denoise:0.5')!, gain: -2 },
      },
    ]);
    doc.blocks = [];
    const out = stringifyMarkdown(docToMarkdown(doc));
    expect(out).toContain('{[audio src=audio/p.webm anchor=document fx=denoise:0.5 gain=-2]}');
    const reparsed = markdownToDoc(parseMarkdown(out)).documentMedia?.[0];
    expect(reparsed?.edits).toEqual({ fx: parseMediaFx('denoise:0.5'), gain: -2 });
  });
});
