import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc';
import { resolveAudioMapping } from '../doc/audioMapping';
import { buildPreviewDoc } from '../doc/buildPreviewDoc';
import { expandDocBlocks } from '../doc/templates/index';
import {
  EMPTY_ADVANCE_LOG,
  buildAdvanceTimingJson,
  recordSlideShown,
  type SlideAdvanceLog,
} from '../narration/advanceTiming';
import type { NarrationTimingJsonV3 } from '../narration/sidecar';
import { MemoryContentContainer } from '../storage/ContentContainer';
import { getBlockAtTime } from '../schemas/Doc';
import type { Doc } from '../schemas/Doc';

/**
 * The whole presenter-advance path, end to end: slide advances recorded during
 * a document-narration take become a sidecar, `resolveAudioMapping` picks it
 * up off the document-anchored VIDEO clip, and the resulting block timings
 * survive `buildPreviewDoc` and `expandDocBlocks` intact.
 *
 * That last hop is the one that matters. `expandDocBlocks` has two branches:
 * the cumulative one honours `duration` verbatim, while the audio-timed one
 * rescales, merges and splits. A document-anchored take leaves
 * `doc.audio.segments` empty, which is exactly what keeps it on the safe branch.
 */

const VIDEO = 'video/take.webm';

const MD = `# Intro

<video src="${VIDEO}" controls width="480" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false" data-squisq-video-clip-end="30"></video>

Alpha beta gamma delta epsilon words for the intro block.

# Middle

Zeta eta theta iota kappa words for the middle block.

# Ending

Lambda mu nu xi omicron words for the ending block.
`;

function makeDoc(markdown = MD): Doc {
  return markdownToDoc(parseMarkdown(markdown));
}

function blockIds(doc: Doc): string[] {
  return flattenRenderableBlocks(doc.blocks).map((block) => block.id);
}

function logOf(doc: Doc, atMs: number[]): SlideAdvanceLog {
  const ids = blockIds(doc);
  let log = EMPTY_ADVANCE_LOG;
  for (let i = 0; i < atMs.length; i++) log = recordSlideShown(log, ids[i], atMs[i]);
  return log;
}

async function containerWith(timing: NarrationTimingJsonV3, path = VIDEO) {
  const container = new MemoryContentContainer();
  await container.writeFile(path, new Uint8Array([1, 2, 3]), 'video/webm');
  await container.writeFile(
    `${path}.timing.json`,
    new TextEncoder().encode(JSON.stringify(timing)),
    'application/json',
  );
  return container;
}

/** Ordered [startTime, duration] pairs of the doc's renderable blocks. */
function timings(doc: Doc): Array<[number, number]> {
  return flattenRenderableBlocks(doc.blocks).map((block) => [block.startTime, block.duration]);
}

describe('presenter advances → block timings', () => {
  it('re-times blocks off a document-anchored VIDEO clip', async () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    const container = await containerWith(timing);

    const resolved = await resolveAudioMapping(doc, container);

    expect(timings(resolved)).toEqual([
      [0, 10],
      [10, 12],
      [22, 8],
    ]);
    expect(resolved.duration).toBe(30);
    // A doc-anchored take never populates audio.segments — that is what keeps
    // the player on the cumulative scheduling branch.
    expect(resolved.audio.segments).toEqual([]);
  });

  it('survives buildPreviewDoc and expandDocBlocks unchanged', async () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    const resolved = await resolveAudioMapping(doc, await containerWith(timing));

    const preview = buildPreviewDoc(resolved, { interleaveImages: false });
    expect(preview.blocks.map((b) => [b.startTime, b.duration])).toEqual([
      [0, 10],
      [10, 12],
      [22, 8],
    ]);
    expect(preview.duration).toBe(30);

    // No audioSegments → the cumulative branch, which honours duration verbatim.
    const expanded = expandDocBlocks(preview.blocks, {});
    expect(expanded.map((b) => [b.startTime, b.duration])).toEqual([
      [0, 10],
      [10, 12],
      [22, 8],
    ]);
  });

  it('skips a never-shown block at playback without disturbing its neighbours', async () => {
    const doc = makeDoc();
    const ids = blockIds(doc);
    let log = recordSlideShown(EMPTY_ADVANCE_LOG, ids[0], 0);
    log = recordSlideShown(log, ids[2], 18_000);
    const resolved = await resolveAudioMapping(
      doc,
      await containerWith(buildAdvanceTimingJson(doc, log, 30)),
    );

    expect(timings(resolved)).toEqual([
      [0, 18],
      [18, 0], // never shown
      [18, 12],
    ]);

    const expanded = expandDocBlocks(
      buildPreviewDoc(resolved, { interleaveImages: false }).blocks,
      {},
    );
    const skippedId = ids[1];
    // The zero-length block is never the block on screen, and the two that
    // were shown cover the whole take with no gap.
    for (let t = 0; t < 30; t += 0.5) {
      const at = getBlockAtTime(expanded, t);
      expect(at).toBeTruthy();
      expect(at?.id).not.toBe(skippedId);
    }
  });

  it('lets an author duration pin win, with a narration-pin-conflict diagnostic', async () => {
    const doc = makeDoc(MD.replace('# Middle', '# Middle {duration=4}'));
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    const resolved = await resolveAudioMapping(doc, await containerWith(timing));

    const [, middle] = flattenRenderableBlocks(resolved.blocks);
    expect(middle.duration).toBe(4);
    expect(resolved.diagnostics?.some((d) => d.code === 'narration-pin-conflict')).toBe(true);
  });
});
