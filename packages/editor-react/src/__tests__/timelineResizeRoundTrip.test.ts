/**
 * Timeline resize WYSIWYG round trip.
 *
 * The timeline's block-edge drag previews a contiguous re-flow (the dragged
 * bar changes length and every later bar follows), then commits by writing a
 * `{[duration=…]}` pin onto the heading. This suite closes the loop for a
 * narration-timed doc: the geometry that comes back from the re-projection
 * (`resolveAudioMapping` → narration sidecar → ripple) must be the same
 * layout the preview showed — no gap at the old narration anchor, no
 * snap-back of the boundary.
 *
 * Regression for: dragging block 1 of a narrated doc from 88s to 40s left
 * block 2 anchored at 88s (a 48s hole the preview never showed), and the
 * only workaround — pinning startTime from the item menu — silently
 * replaced the block's narration length with a reading-time estimate.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, flattenBlocks, resolveAudioMapping } from '@bendyline/squisq/doc';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import { setBlockDurationInSource } from '../timelineSource';

const AUDIO = 'audio/narration-20260723-132322.webm';

const MD = `{[audio src=${AUDIO} anchor=document]}

# Welcome to mikeamm-builds

Alpha beta gamma delta epsilon words for the welcome block, spoken slowly.

# websites are cool

Zeta eta theta iota kappa words for the second block of the take.
`;

function parse(markdown: string): Doc {
  return markdownToDoc(parseMarkdown(markdown));
}

/** The heading-bearing bars the timeline draws, in track order. */
function bars(doc: Doc): Block[] {
  return flattenBlocks(doc.blocks).filter((b) => b.sourceHeading != null);
}

/** Container carrying the take + a v3 sidecar timing block 1 = 0–88, block 2 = 88–148. */
async function narratedContainer(doc: Doc): Promise<MemoryContentContainer> {
  const [first, second] = bars(doc);
  const sidecar = {
    version: 3,
    sourceText: 'narration take source text',
    duration: 148,
    bookmarks: [],
    blocks: [
      { blockId: first.id, blockIndex: 0, charStart: 0, charEnd: 1, startSec: 0, endSec: 88 },
      { blockId: second.id, blockIndex: 1, charStart: 1, charEnd: 2, startSec: 88, endSec: 148 },
    ],
  };
  const container = new MemoryContentContainer();
  await container.writeFile(AUDIO, new Uint8Array([1, 2, 3]), 'audio/webm');
  await container.writeFile(
    `${AUDIO}.timing.json`,
    new TextEncoder().encode(JSON.stringify(sidecar)),
    'application/json',
  );
  return container;
}

describe('timeline resize round trip on a narration-timed doc', () => {
  it('shows the recorded layout before any edit', async () => {
    const doc = parse(MD);
    const container = await narratedContainer(doc);
    const timed = await resolveAudioMapping(doc, container);

    expect(bars(timed).map((b) => [b.startTime, b.duration])).toEqual([
      [0, 88],
      [88, 60],
    ]);
    expect(timed.duration).toBe(148);
  });

  it('re-projects to the exact layout the drag previewed: 0–40 then 40–100', async () => {
    const doc = parse(MD);
    const container = await narratedContainer(doc);
    const timed = await resolveAudioMapping(doc, container);

    // The drag commit targets the bar's source heading line, as TimelineTrack does.
    const line = bars(timed)[0].sourceHeading!.position!.start.line;
    const edited = setBlockDurationInSource(MD, line, 40);
    expect(edited).toContain('# Welcome to mikeamm-builds {[duration=40]}');

    const reprojected = await resolveAudioMapping(parse(edited!), container);
    // Block 1 holds the dragged 40s and block 2 follows contiguously — the
    // boundary must not snap back to the 88s narration anchor.
    expect(bars(reprojected).map((b) => [b.startTime, b.duration])).toEqual([
      [0, 40],
      [40, 60],
    ]);
    // The take still runs 148s of audio, so the doc keeps that length and the
    // desync is surfaced as an info diagnostic rather than a silent no-op.
    expect(reprojected.duration).toBe(148);
    expect(reprojected.diagnostics?.some((d) => d.code === 'narration-pin-conflict')).toBe(true);
  });
});
