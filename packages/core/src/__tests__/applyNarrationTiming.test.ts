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
    // Pin wins (narration said 12s, pin says 3s).
    expect(flat[1].duration).toBe(3);
    const conflict = result.doc.diagnostics?.find((d) => d.code === 'narration-pin-conflict');
    expect(conflict).toBeTruthy();
    expect(conflict!.severity).toBe('info');
    expect(conflict!.blockId).toBe(flat[1].id);
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
