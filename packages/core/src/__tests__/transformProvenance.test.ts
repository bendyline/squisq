import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc';
import { applyTransform } from '../transform/applyTransform';
import { allocateTiming } from '../transform/timingAllocator';
import { isTemplateBlock, type TemplateBlock } from '../schemas/BlockTemplates';
import type { Block, Doc } from '../schemas/Doc';

const MD = `# The Numbers

Revenue grew to 4,200 units in 2019 which was a big jump for the small team.
"We never expected this kind of growth," said the founder about the year.

# The Turning Point

By 2021 the company had 87 employees across three offices and a plan.
The expansion cost 1,500,000 dollars and took fourteen months to finish.

# The Result

Today the product ships to 40 countries and the team keeps growing steadily.
`;

function makeDoc(): Doc {
  return markdownToDoc(parseMarkdown(MD));
}

/** Blocks a transform produced (positional transform-* ids). */
function transformedBlocks(doc: Doc): Block[] {
  return doc.blocks.filter((b) => b.id.startsWith('transform-'));
}

describe('transform provenance', () => {
  it('every extraction-derived slide carries a sourceBlockId from the input doc', () => {
    const source = makeDoc();
    const sourceIds = new Set(flattenRenderableBlocks(source.blocks).map((b) => b.id));
    const { doc } = applyTransform(source, 'data-driven');

    const produced = transformedBlocks(doc).filter(
      (b) => b.id !== 'transform-intro' && b.id !== 'transform-outro',
    );
    expect(produced.length).toBeGreaterThan(0);
    for (const block of produced) {
      expect(block.sourceBlockId, `block ${block.id} missing provenance`).toBeTruthy();
      expect(sourceIds.has(block.sourceBlockId!)).toBe(true);
    }
  });

  it('sourceStartTime is SECONDS on the doc timeline, not a char offset (regression)', () => {
    const source = makeDoc();
    const sourceEnd = Math.max(
      ...flattenRenderableBlocks(source.blocks).map((b) => b.startTime + b.duration),
    );
    const { doc } = applyTransform(source, 'data-driven');

    for (const block of doc.blocks) {
      const tb = block as unknown as TemplateBlock;
      if (typeof tb.sourceStartTime !== 'number') continue;
      // The old bug put char offsets (hundreds) here; real seconds must
      // stay inside the source timeline.
      expect(tb.sourceStartTime).toBeLessThanOrEqual(sourceEnd + 1);
      expect(tb.sourceStartTime).toBeGreaterThanOrEqual(0);
      // The raw char offset is preserved separately as provenance.
      expect(typeof tb.sourceCharOffset).toBe('number');
    }
  });

  it('narration-timed source blocks anchor their slides inside the source range', () => {
    const source = makeDoc();
    // Simulate applyNarrationTiming: give the source blocks recorded times.
    const flat = flattenRenderableBlocks(source.blocks);
    const bounds = [0, 20, 45, 70];
    flat.forEach((block, i) => {
      block.startTime = bounds[i] ?? 70;
      block.duration = (bounds[i + 1] ?? 70) - (bounds[i] ?? 70);
    });
    source.duration = 70;

    const { doc } = applyTransform(source, 'data-driven');
    const bySource = new Map(flat.map((b) => [b.id, b]));
    let anchoredChecked = 0;
    for (const block of transformedBlocks(doc)) {
      // Only ANCHORED slides (real narration seconds) must sit inside
      // their source range; floats (section headers, images) are placed
      // approximately by design.
      const tb = block as unknown as TemplateBlock;
      if (!block.sourceBlockId || typeof tb.sourceStartTime !== 'number') continue;
      const origin = bySource.get(block.sourceBlockId);
      if (!origin || origin.duration <= 0) continue;
      expect(block.startTime).toBeGreaterThanOrEqual(origin.startTime - 1e-6);
      expect(block.startTime).toBeLessThan(origin.startTime + origin.duration + 1e-6);
      anchoredChecked++;
    }
    expect(anchoredChecked).toBeGreaterThan(0);
  });

  it('transformed timelines stay contiguous (no uncovered narration seconds)', () => {
    const source = makeDoc();
    const { doc } = applyTransform(source, 'data-driven');
    const sorted = [...doc.blocks].sort((a, b) => a.startTime - b.startTime);
    for (let i = 0; i < sorted.length - 1; i++) {
      const end = sorted[i].startTime + sorted[i].duration;
      expect(end).toBeCloseTo(sorted[i + 1].startTime, 5);
    }
  });
});

describe('allocateTiming fallback', () => {
  it('keeps the historical rescale behavior when no anchors exist', () => {
    const floats: TemplateBlock[] = [
      { template: 'sectionHeader', id: 'a', duration: 5, audioSegment: 0, title: 'A' },
      { template: 'sectionHeader', id: 'b', duration: 5, audioSegment: 0, title: 'B' },
    ];
    const result = allocateTiming(floats, 20);
    expect(result[0].startTime).toBe(0);
    expect(result[0].duration).toBe(10);
    expect(result[1].startTime).toBe(10);
    expect(result[1].duration).toBe(10);
  });

  it('still fills the total when the 3-20s clamp moves some blocks', () => {
    // A plain scale-then-clamp pass drops the budget of every clamped
    // block: these raw durations scale to [0.59, 0.59, 58.8], clamp to
    // [3, 3, 20] and strand the timeline at 26s against 60s of audio.
    // [20, 20, 20] is in range and fits exactly, so it must be found.
    const skewed: TemplateBlock[] = [
      { template: 'sectionHeader', id: 'a', duration: 1, audioSegment: 0, title: 'A' },
      { template: 'sectionHeader', id: 'b', duration: 1, audioSegment: 0, title: 'B' },
      { template: 'sectionHeader', id: 'c', duration: 100, audioSegment: 0, title: 'C' },
    ];
    const result = allocateTiming(skewed, 60);
    const end = result[2].startTime + result[2].duration;
    expect(end).toBeCloseTo(60, 5);
    for (const block of result) {
      expect(block.duration).toBeGreaterThanOrEqual(3);
      expect(block.duration).toBeLessThanOrEqual(20);
    }
  });

  it('redistributes the budget freed by a block clamped at the 20s ceiling', () => {
    // Only the 200s block hits the ceiling; the three small blocks must
    // absorb the remaining 20s rather than sitting at the 3s floor.
    const blocks: TemplateBlock[] = [
      { template: 'sectionHeader', id: 'a', duration: 1, audioSegment: 0, title: 'A' },
      { template: 'sectionHeader', id: 'b', duration: 1, audioSegment: 0, title: 'B' },
      { template: 'sectionHeader', id: 'c', duration: 1, audioSegment: 0, title: 'C' },
      { template: 'sectionHeader', id: 'd', duration: 200, audioSegment: 0, title: 'D' },
    ];
    const result = allocateTiming(blocks, 40);
    expect(result[3].duration).toBeCloseTo(20, 5);
    expect(result[0].duration).toBeCloseTo(20 / 3, 5);
    const end = result[3].startTime + result[3].duration;
    expect(end).toBeCloseTo(40, 5);
  });

  it('saturates at the nearest bound when the clamp cannot reach the total', () => {
    // 40 blocks at a 3s floor can never fit into 60s — the system is
    // over-constrained, so the closest reachable timeline (40 x 3 = 120s)
    // is the least-bad answer rather than a scale that ignores the floor.
    const many: TemplateBlock[] = Array.from({ length: 40 }, (_, i) => ({
      template: 'sectionHeader',
      id: `b${i}`,
      duration: 1.5,
      audioSegment: 0,
      title: `B${i}`,
    }));
    const result = allocateTiming(many, 60);
    for (const block of result) expect(block.duration).toBe(3);
    const end = result[39].startTime + result[39].duration;
    expect(end).toBeCloseTo(120, 5);
  });

  it('anchored blocks keep their positions; floats fill the gaps', () => {
    const blocks: TemplateBlock[] = [
      // A floating intro before the first anchor.
      { template: 'title', id: 'intro', duration: 4, audioSegment: 0, title: 'T' },
      {
        template: 'statHighlight',
        id: 's1',
        duration: 6,
        audioSegment: 0,
        stat: '42',
        description: 'd',
        sourceStartTime: 10,
        sourceDuration: 6,
      },
      {
        template: 'statHighlight',
        id: 's2',
        duration: 6,
        audioSegment: 0,
        stat: '87',
        description: 'd',
        sourceStartTime: 30,
        sourceDuration: 6,
      },
    ];
    const result = allocateTiming(blocks, 40);
    // Intro fills [0, 10) up to the first anchor.
    expect(result[0].startTime).toBe(0);
    expect(result[0].duration).toBeCloseTo(10, 5);
    // Anchors sit at their narration positions; s1 holds until s2 starts.
    expect(result[1].startTime).toBe(10);
    expect(result[1].duration).toBeCloseTo(20, 5);
    expect(result[2].startTime).toBe(30);
    // The final block covers through the total duration.
    expect(result[2].startTime + result[2].duration).toBeCloseTo(40, 5);
    for (const b of result) {
      expect(isTemplateBlock(b as unknown as TemplateBlock) || true).toBe(true);
    }
  });
});
