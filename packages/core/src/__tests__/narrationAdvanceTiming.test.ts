import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc';
import {
  EMPTY_ADVANCE_LOG,
  advanceCoverage,
  buildAdvanceTimingJson,
  recordSlideShown,
  type SlideAdvanceLog,
} from '../narration/advanceTiming';
import { parseNarrationTimingJson } from '../narration/sidecar';
import type { Doc } from '../schemas/Doc';

/**
 * The presenter-advance sidecar builder. These lock the invariants every
 * downstream consumer assumes: one entry per renderable block in document
 * order, contiguous ranges spanning exactly [0, duration], and zero-length
 * ranges for blocks the presenter never reached.
 */

const MD = `# Intro

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

/** An in-order log: block i first shown at `atMs[i]`. */
function logOf(doc: Doc, atMs: number[]): SlideAdvanceLog {
  const ids = blockIds(doc);
  let log = EMPTY_ADVANCE_LOG;
  for (let i = 0; i < atMs.length; i++) log = recordSlideShown(log, ids[i], atMs[i]);
  return log;
}

describe('recordSlideShown', () => {
  it('appends a first showing', () => {
    const log = recordSlideShown(EMPTY_ADVANCE_LOG, 'a', 1500);
    expect(log).toEqual([{ blockId: 'a', atMs: 1500 }]);
  });

  it('returns the SAME reference on a revisit — first-shown wins', () => {
    const once = recordSlideShown(EMPTY_ADVANCE_LOG, 'a', 1000);
    const twice = recordSlideShown(once, 'b', 2000);
    const revisit = recordSlideShown(twice, 'a', 3000);
    expect(revisit).toBe(twice);
    expect(revisit).toHaveLength(2);
  });

  it('returns the same reference for an unusable stamp or empty id', () => {
    const log = recordSlideShown(EMPTY_ADVANCE_LOG, 'a', 0);
    expect(recordSlideShown(log, 'b', Number.NaN)).toBe(log);
    expect(recordSlideShown(log, 'b', Number.POSITIVE_INFINITY)).toBe(log);
    expect(recordSlideShown(log, '', 100)).toBe(log);
  });

  it('clamps a backwards wall clock so the log stays non-decreasing', () => {
    let log = recordSlideShown(EMPTY_ADVANCE_LOG, 'a', 5000);
    log = recordSlideShown(log, 'b', 2000);
    log = recordSlideShown(log, 'c', -100);
    expect(log.map((entry) => entry.atMs)).toEqual([5000, 5000, 5000]);
  });
});

describe('buildAdvanceTimingJson — structure', () => {
  it('emits one entry per renderable block, in document order', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    expect(timing.blocks.map((b) => b.blockId)).toEqual(blockIds(doc));
    expect(timing.blocks.map((b) => b.blockIndex)).toEqual([0, 1, 2]);
    expect(timing.blocks.map((b) => b.heading)).toEqual(['Intro', 'Middle', 'Ending']);
  });

  it('produces contiguous ranges spanning exactly [0, duration]', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    expect(timing.blocks.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 10],
      [10, 22],
      [22, 30],
    ]);
    for (let i = 0; i + 1 < timing.blocks.length; i++) {
      expect(timing.blocks[i].endSec).toBe(timing.blocks[i + 1].startSec);
    }
  });

  it('forces the first shown block to start at 0 even when its stamp is late', () => {
    const doc = makeDoc();
    // The presenter pressed Record, then advanced off slide 1 at 4s without
    // ever "showing" it — the take still begins at 0.
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [4_000, 10_000, 22_000]), 30);
    expect(timing.blocks[0].startSec).toBe(0);
  });

  it('carries presenter-advance provenance and no word bookmarks', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    expect(timing.version).toBe(3);
    expect(timing.generator).toEqual({ name: 'squisq-recorder', method: 'presenter-advance' });
    expect(timing.bookmarks).toEqual([]);
    expect(timing.cameraOffsetSec).toBeUndefined();
  });

  it('honours a custom generator name', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0]), 10, { generatorName: 'host-app' });
    expect(timing.generator?.name).toBe('host-app');
  });
});

describe('buildAdvanceTimingJson — unshown blocks', () => {
  it('collapses an unshown middle block onto the next shown start', () => {
    const doc = makeDoc();
    const ids = blockIds(doc);
    let log = recordSlideShown(EMPTY_ADVANCE_LOG, ids[0], 0);
    log = recordSlideShown(log, ids[2], 18_000);
    const timing = buildAdvanceTimingJson(doc, log, 30);
    expect(timing.blocks.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 18],
      [18, 18], // never shown → zero length, skipped in playback
      [18, 30],
    ]);
  });

  it('collapses a trailing unshown run onto the take end', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0]), 30);
    expect(timing.blocks.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 30],
      [30, 30],
      [30, 30],
    ]);
  });

  it('emits every block even when nothing was advanced', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, EMPTY_ADVANCE_LOG, 30);
    expect(timing.blocks).toHaveLength(3);
    // With no observations at all, every range collapses to the end.
    expect(timing.blocks.every((b) => b.startSec === b.endSec)).toBe(true);
  });
});

describe('buildAdvanceTimingJson — char ranges', () => {
  it('uses the script char range for blocks with spoken text', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    for (const block of timing.blocks) {
      expect(timing.sourceText.slice(block.charStart, block.charEnd).length).toBeGreaterThan(0);
    }
    expect(timing.sourceText.slice(timing.blocks[1].charStart, timing.blocks[1].charEnd)).toContain(
      'Middle',
    );
  });

  it('gives a script-skipped block a zero-length char range but a real time range', () => {
    // A heading-less preamble holding only an image has no spoken text at all,
    // so `buildNarrationScript` omits it — but it IS a renderable block and
    // must still get a time range, or `applyNarrationTiming` would place it at
    // its own reading-time duration and push every later block out of sync.
    const doc = makeDoc(`![](img/cover.png)

# Intro

Alpha beta gamma words.

# Ending

Lambda mu nu words.
`);
    const flat = flattenRenderableBlocks(doc.blocks);
    expect(flat).toHaveLength(3);
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 8_000, 16_000]), 24);
    expect(timing.blocks).toHaveLength(3);

    const preamble = timing.blocks[0];
    expect(preamble.charStart).toBe(preamble.charEnd);
    expect(preamble.startSec).toBe(0);
    expect(preamble.endSec).toBe(8);

    // Char offsets stay ordered and in bounds across the whole payload.
    let cursor = 0;
    for (const block of timing.blocks) {
      expect(block.charStart).toBeGreaterThanOrEqual(cursor);
      expect(block.charEnd).toBeGreaterThanOrEqual(block.charStart);
      expect(block.charEnd).toBeLessThanOrEqual(timing.sourceText.length);
      cursor = block.charStart;
    }
  });
});

describe('buildAdvanceTimingJson — clamping', () => {
  it('normalizes a non-finite or negative take length to 0', () => {
    const doc = makeDoc();
    expect(buildAdvanceTimingJson(doc, logOf(doc, [0]), Number.NaN).duration).toBe(0);
    expect(buildAdvanceTimingJson(doc, logOf(doc, [0]), -5).duration).toBe(0);
  });

  it('clamps advances past the take end down to the take end', () => {
    const doc = makeDoc();
    const timing = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 99_000]), 30);
    expect(timing.blocks.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 10],
      [10, 30],
      [30, 30],
    ]);
  });

  it('ignores advances for blocks that are no longer in the doc', () => {
    const doc = makeDoc();
    const ids = blockIds(doc);
    let log = recordSlideShown(EMPTY_ADVANCE_LOG, ids[0], 0);
    log = recordSlideShown(log, 'block-that-was-deleted', 5_000);
    log = recordSlideShown(log, ids[1], 12_000);
    const timing = buildAdvanceTimingJson(doc, log, 30);
    expect(timing.blocks[1].startSec).toBe(12);
  });
});

describe('buildAdvanceTimingJson — sidecar round trip', () => {
  /**
   * The parser sorts blocks by `startSec` and clamps non-decreasing starts.
   * Zero-length runs share a sort key and survive only because the sort is
   * stable — this is the guard that stops a future builder change from
   * silently reordering blocks on read.
   */
  it('survives parseNarrationTimingJson unchanged', () => {
    const doc = makeDoc();
    const built = buildAdvanceTimingJson(doc, logOf(doc, [0, 10_000, 22_000]), 30);
    expect(parseNarrationTimingJson(JSON.stringify(built))).toEqual(built);
  });

  it('survives the round trip with zero-length ranges in the middle', () => {
    const doc = makeDoc();
    const ids = blockIds(doc);
    let log = recordSlideShown(EMPTY_ADVANCE_LOG, ids[0], 0);
    log = recordSlideShown(log, ids[2], 18_000);
    const built = buildAdvanceTimingJson(doc, log, 30);
    expect(parseNarrationTimingJson(JSON.stringify(built))).toEqual(built);
  });
});

describe('advanceCoverage', () => {
  it('counts shown and unshown blocks with headings', () => {
    const doc = makeDoc();
    const ids = blockIds(doc);
    let log = recordSlideShown(EMPTY_ADVANCE_LOG, ids[0], 0);
    log = recordSlideShown(log, ids[2], 18_000);
    expect(advanceCoverage(doc, log)).toEqual({
      total: 3,
      shown: 2,
      unshown: 1,
      unshownHeadings: ['Middle'],
    });
  });

  it('reports full coverage for a complete run', () => {
    const doc = makeDoc();
    expect(advanceCoverage(doc, logOf(doc, [0, 10_000, 22_000]))).toMatchObject({
      total: 3,
      shown: 3,
      unshown: 0,
      unshownHeadings: [],
    });
  });
});
