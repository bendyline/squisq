import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc';
import { applyNarrationTiming } from '../doc/applyNarrationTiming';
import { resolveAudioMapping } from '../doc/audioMapping';
import { buildNarrationScript } from '../narration/script';
import type { NarrationTimingJsonV3 } from '../narration/sidecar';
import { MemoryContentContainer } from '../storage/ContentContainer';
import type { Doc } from '../schemas/Doc';

const MD = `{[audio src=audio/take.webm anchor=document]}

# Intro

Alpha beta gamma delta epsilon words for the intro block.

# Middle

Zeta eta theta iota kappa words for the middle block.

# Ending

Lambda mu nu xi omicron words for the ending block.
`;

function makeDoc(markdown = MD): Doc {
  return markdownToDoc(parseMarkdown(markdown));
}

/** A v3 sidecar whose block ranges use the doc's real block ids. */
function makeSidecar(doc: Doc, overrides?: Partial<NarrationTimingJsonV3>): NarrationTimingJsonV3 {
  const script = buildNarrationScript(doc);
  const bounds = [0, 10, 22, 30];
  return {
    version: 3,
    sourceText: script.sourceText,
    duration: 30,
    bookmarks: [],
    blocks: script.blocks.map((range, i) => ({
      blockId: range.blockId,
      ...(range.heading !== undefined ? { heading: range.heading } : {}),
      blockIndex: i,
      charStart: range.charStart,
      charEnd: range.charEnd,
      startSec: bounds[i],
      endSec: bounds[i + 1],
    })),
    ...overrides,
  };
}

async function containerWith(sidecar: NarrationTimingJsonV3, path = 'audio/take.webm') {
  const container = new MemoryContentContainer();
  await container.writeFile(path, new Uint8Array([1, 2, 3]), 'audio/webm');
  await container.writeFile(
    `${path}.timing.json`,
    new TextEncoder().encode(JSON.stringify(sidecar)),
    'application/json',
  );
  return container;
}

describe('applyNarrationTiming', () => {
  it('re-times blocks from v3 sidecar ranges and owns doc.duration', async () => {
    const doc = makeDoc();
    const container = await containerWith(makeSidecar(doc));
    const result = await applyNarrationTiming(doc, container);

    expect(result.applied).toBe(true);
    expect(result.clipSrc).toBe('audio/take.webm');
    const flat = flattenRenderableBlocks(result.doc.blocks);
    expect(flat[0].startTime).toBe(0);
    expect(flat[0].duration).toBe(10);
    expect(flat[1].startTime).toBe(10);
    expect(flat[1].duration).toBe(12);
    expect(flat[2].startTime).toBe(22);
    expect(flat[2].duration).toBe(8);
    expect(result.doc.duration).toBe(30);
    // Input doc untouched.
    expect(doc.blocks[0].startTime).not.toBe(10);
  });

  it('returns the doc unchanged when no narration clip or sidecar exists', async () => {
    const doc = makeDoc('# Just\n\nSome text.\n');
    const container = new MemoryContentContainer();
    const result = await applyNarrationTiming(doc, container);
    expect(result.applied).toBe(false);
    expect(result.doc).toBe(doc);
  });

  it('honors author pins and records an info diagnostic on real conflict', async () => {
    const pinned = makeDoc(MD.replace('# Middle', '# Middle {duration=3}'));
    const container = await containerWith(makeSidecar(pinned));
    const result = await applyNarrationTiming(pinned, container);

    expect(result.applied).toBe(true);
    const flat = flattenRenderableBlocks(result.doc.blocks);
    // Pin wins (narration said 12s, pin says 3s); the start still follows the
    // narration anchor — the pin only overrides the field it names.
    expect(flat[1].duration).toBe(3);
    expect(flat[1].startTime).toBe(10);
    // Contiguity: the next block follows the pinned block's actual end
    // instead of leaving a 9s hole at its absolute narration anchor.
    expect(flat[2].startTime).toBe(13);
    expect(flat[2].duration).toBe(8);
    // The take still owns the doc duration (the audio really plays 30s).
    expect(result.doc.duration).toBe(30);
    const conflict = result.doc.diagnostics?.find((d) => d.code === 'narration-pin-conflict');
    expect(conflict).toBeTruthy();
    expect(conflict!.severity).toBe('info');
    expect(conflict!.blockId).toBe(flat[1].id);
  });

  it('ripples following blocks when a drag-style squiggly duration pin shortens a block', async () => {
    // What the timeline editor writes when block 1's edge is dragged shorter.
    const edited = makeDoc(MD.replace('# Intro', '# Intro {[duration=4]}'));
    const container = await containerWith(makeSidecar(edited));
    const result = await applyNarrationTiming(edited, container);

    expect(result.applied).toBe(true);
    const flat = flattenRenderableBlocks(result.doc.blocks);
    expect(flat.map((b) => [b.startTime, b.duration])).toEqual([
      [0, 4],
      [4, 12],
      [16, 8],
    ]);
    expect(result.doc.duration).toBe(30);
    expect(result.doc.diagnostics?.some((d) => d.code === 'narration-pin-conflict')).toBe(true);
  });

  it('ripples following blocks outward when a pin lengthens a block (no overlap)', async () => {
    const edited = makeDoc(MD.replace('# Intro', '# Intro {[duration=20]}'));
    const container = await containerWith(makeSidecar(edited));
    const result = await applyNarrationTiming(edited, container);

    const flat = flattenRenderableBlocks(result.doc.blocks);
    expect(flat.map((b) => [b.startTime, b.duration])).toEqual([
      [0, 20],
      [20, 12],
      [32, 8],
    ]);
    // Blocks now outrun the take; the block strip owns the doc duration.
    expect(result.doc.duration).toBe(40);
  });

  it('keeps the narration duration when only startTime is pinned', async () => {
    // The timeline item menu's Start time field writes exactly this pin.
    const edited = makeDoc(MD.replace('# Middle', '# Middle {[startTime=40]}'));
    const container = await containerWith(makeSidecar(edited));
    const result = await applyNarrationTiming(edited, container);

    const flat = flattenRenderableBlocks(result.doc.blocks);
    // Start pinned; length still the narration's 12s — not a reading-time
    // estimate. Followers stay contiguous after the moved block.
    expect(flat[1].startTime).toBe(40);
    expect(flat[1].duration).toBe(12);
    expect(flat[2].startTime).toBe(52);
    expect(flat[2].duration).toBe(8);
    expect(result.doc.duration).toBe(60);
  });

  it('matches a renamed heading through text similarity', async () => {
    const original = makeDoc();
    const sidecar = makeSidecar(original);
    // Author renames the middle heading after recording: id + heading drift,
    // but the body text still matches.
    const edited = makeDoc(MD.replace('# Middle', '# Renamed Midsection'));
    const container = await containerWith(sidecar);
    const result = await applyNarrationTiming(edited, container);

    expect(result.applied).toBe(true);
    const flat = flattenRenderableBlocks(result.doc.blocks);
    expect(flat[1].startTime).toBe(10);
    expect(flat[1].duration).toBe(12);
  });

  it('falls back to proportional timing for v1 sidecars narrating this doc', async () => {
    const doc = makeDoc();
    const script = buildNarrationScript(doc);
    const container = await containerWith({
      version: 3,
      sourceText: script.sourceText,
      duration: 30,
      bookmarks: [],
      blocks: [],
    });
    const result = await applyNarrationTiming(doc, container);

    expect(result.applied).toBe(true);
    const flat = flattenRenderableBlocks(result.doc.blocks);
    expect(flat[0].startTime).toBe(0);
    expect(flat[1].startTime).toBeGreaterThan(0);
    expect(flat[2].startTime).toBeGreaterThan(flat[1].startTime);
    const last = flat[flat.length - 1];
    expect(last.startTime + last.duration).toBeCloseTo(30, 5);
  });

  it('does not apply a v1 sidecar from an unrelated take', async () => {
    const doc = makeDoc();
    const container = await containerWith({
      version: 3,
      sourceText: 'completely different narration about sailboats and harbors and tides',
      duration: 30,
      bookmarks: [],
      blocks: [],
    });
    const result = await applyNarrationTiming(doc, container);
    expect(result.applied).toBe(false);
  });
});

describe('resolveAudioMapping with a narration take', () => {
  it('applies narration timing and never double-maps the take into segments', async () => {
    const doc = makeDoc();
    const container = await containerWith(makeSidecar(doc));
    const resolved = await resolveAudioMapping(doc, container);

    const flat = flattenRenderableBlocks(resolved.blocks);
    expect(flat[1].startTime).toBe(10);
    expect(resolved.duration).toBe(30);
    // The take plays through the media schedule (documentMedia), so it must
    // NOT also appear as an audio segment — that would play it twice.
    expect(resolved.audio.segments.some((s) => s.src === 'audio/take.webm')).toBe(false);
  });

  it('keeps classic per-block segment mapping for docs without narration', async () => {
    const doc = makeDoc('# Intro\n\nAlpha beta gamma delta epsilon words for the intro block.\n');
    const container = new MemoryContentContainer();
    await container.writeFile('audio/clip.mp3', new Uint8Array([9]), 'audio/mpeg');
    await container.writeFile(
      'audio/clip.mp3.timing.json',
      new TextEncoder().encode(
        JSON.stringify({
          sourceText: 'Alpha beta gamma delta epsilon words for the intro block.',
          duration: 7,
          bookmarks: [],
        }),
      ),
      'application/json',
    );
    const resolved = await resolveAudioMapping(doc, container);
    expect(resolved.audio.segments.length).toBe(1);
    expect(resolved.audio.segments[0].src).toBe('audio/clip.mp3');
    expect(resolved.duration).toBe(7);
  });
});

describe('applyNarrationTiming with a trimmed or cut take', () => {
  // Sidecar block ranges (take seconds): Intro 0–10, Middle 10–22, Ending 22–30.
  it('shifts ranges by the trim head and ends the doc at the trim tail', async () => {
    const doc = makeDoc(
      MD.replace('anchor=document]}', 'anchor=document clipStart=4 clipEnd=26]}'),
    );
    const container = await containerWith(makeSidecar(doc));
    const result = await applyNarrationTiming(doc, container);
    const flat = flattenRenderableBlocks(result.doc.blocks);
    expect(flat.map((b) => [b.startTime, b.duration])).toEqual([
      [0, 6],
      [6, 12],
      [18, 4],
    ]);
    expect(result.doc.duration).toBe(22);
  });

  it('closes up each cut and collapses a block whose narration was cut entirely', async () => {
    const doc = makeDoc(MD.replace('anchor=document]}', 'anchor=document cuts="3-5 10-22"]}'));
    const container = await containerWith(makeSidecar(doc));
    const result = await applyNarrationTiming(doc, container);
    const flat = flattenRenderableBlocks(result.doc.blocks);
    expect(flat.map((b) => [b.startTime, b.duration])).toEqual([
      [0, 8],
      [8, 0],
      [8, 8],
    ]);
    expect(result.doc.duration).toBe(16);
  });
});

describe('applyNarrationTiming captions from word bookmarks', () => {
  /**
   * One bookmark per script token, one second apart (token i spoken at i s).
   * The take runs 40 s so all 33 words fall inside it.
   */
  function wordTimedSidecar(doc: Doc): NarrationTimingJsonV3 {
    const script = buildNarrationScript(doc);
    return makeSidecar(doc, {
      duration: 40,
      bookmarks: script.tokens.map((token, i) => ({
        id: `word-${i}`,
        time: i,
        charOffset: token.charOffset,
        textFragment: token.text,
      })),
    });
  }

  function captionWords(doc: Doc): Array<{ text: string; startTime: number }> {
    return (doc.captions?.phrases ?? []).flatMap((phrase) =>
      (phrase.words ?? []).map((word) => ({ text: word.text, startTime: word.startTime })),
    );
  }

  it('replaces reading-time captions with word-timed captions that follow the voice', async () => {
    const doc = makeDoc();
    const sidecar = wordTimedSidecar(doc);
    const container = await containerWith(sidecar);
    const result = await applyNarrationTiming(doc, container);

    const words = captionWords(result.doc);
    expect(words.length).toBe(sidecar.bookmarks.length);
    words.forEach((word, i) => {
      expect(word.text).toBe(sidecar.bookmarks[i].textFragment);
      expect(word.startTime).toBe(i);
    });
    const phrases = result.doc.captions!.phrases;
    expect(phrases[0].startTime).toBe(0);
    // Every phrase stays inside the take.
    expect(phrases[phrases.length - 1].endTime).toBeLessThanOrEqual(40);
    // The input doc's own (reading-time) captions are untouched.
    expect(doc.captions?.phrases.some((phrase) => phrase.words)).toBeFalsy();
  });

  it('drops words trimmed off the take and shifts the rest by the trim head', async () => {
    const doc = makeDoc(
      MD.replace('anchor=document]}', 'anchor=document clipStart=4 clipEnd=20]}'),
    );
    const sidecar = wordTimedSidecar(doc);
    const result = await applyNarrationTiming(doc, await containerWith(sidecar));

    const kept = sidecar.bookmarks.filter((b) => b.time >= 4 && b.time <= 20);
    const words = captionWords(result.doc);
    expect(words.map((w) => w.text)).toEqual(kept.map((b) => b.textFragment));
    expect(words.map((w) => w.startTime)).toEqual(kept.map((b) => b.time - 4));
    const phrases = result.doc.captions!.phrases;
    expect(phrases[phrases.length - 1].endTime).toBeLessThanOrEqual(16);
  });

  it('drops words inside a cut and closes up the words after it', async () => {
    const doc = makeDoc(MD.replace('anchor=document]}', 'anchor=document cuts="3-5 10-22"]}'));
    const sidecar = wordTimedSidecar(doc);
    const result = await applyNarrationTiming(doc, await containerWith(sidecar));

    const playedAt = (t: number): number | null => {
      if (t < 3) return t;
      if (t < 5) return null;
      if (t < 10) return t - 2;
      if (t < 22) return null;
      return t - 14;
    };
    const expected = sidecar.bookmarks
      .map((b) => ({ text: b.textFragment, startTime: playedAt(b.time) }))
      .filter((w): w is { text: string; startTime: number } => w.startTime !== null);
    expect(captionWords(result.doc)).toEqual(expected);
  });

  it('drops words stamped past the end of an untrimmed take', async () => {
    const doc = makeDoc();
    const sidecar = { ...wordTimedSidecar(doc), duration: 30 };
    const result = await applyNarrationTiming(doc, await containerWith(sidecar));
    const words = captionWords(result.doc);
    expect(words.length).toBe(31); // words at 0…30 s; 31 and 32 s are past the end
    expect(words[words.length - 1].startTime).toBe(30);
  });

  it('keeps the existing captions when the sidecar has no word timings', async () => {
    const doc = makeDoc();
    const result = await applyNarrationTiming(doc, await containerWith(makeSidecar(doc)));
    expect(result.applied).toBe(true);
    expect(result.doc.captions).toBe(doc.captions);
  });

  it('orders hand-edited bookmarks before phrasing them', async () => {
    const doc = makeDoc();
    const sidecar = wordTimedSidecar(doc);
    const shuffled = { ...sidecar, bookmarks: [...sidecar.bookmarks].reverse() };
    const result = await applyNarrationTiming(doc, await containerWith(shuffled));
    const starts = captionWords(result.doc).map((w) => w.startTime);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts.length).toBe(sidecar.bookmarks.length);
  });
});
