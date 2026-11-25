/**
 * The exact markdown the summary writer produces, recorded so a refactor of
 * the code under it (the accessory block writer shared with study cards) can
 * be shown to change nothing. Each case writes a design into a document, then
 * changes it, removes some blocks and resets — over a corpus that puts
 * summaries under every kind of owner: a heading, the text before the first
 * heading, a section made by a standalone tag, a level-6 heading.
 */
import { describe, expect, it } from 'vitest';
import { createPresentationPlan } from '../transform/presentationPlanner';
import {
  presentationPassageKey,
  presentationSections,
  type PresentationHints,
} from '../transform/presentationHints';
import { readPresentationHints } from '../transform/presentationHintsDoc';
import {
  removeSummaryBlocks,
  resetPresentationHints,
  writePresentationHints,
} from '../transform/presentationHintsSource';
import { DOCUMENTS, convert } from './accessoryBlockFixtures';

/** A design touching every section: opening wording, AI slides, a hidden slide, settings. */
function designFor(md: string): PresentationHints {
  const doc = convert(md);
  const plan = createPresentationPlan(doc);
  const sections = presentationSections(doc);
  const keyOf = (index: number) =>
    presentationPassageKey(
      plan.sourceText.slice(plan.beats[index]!.sourceStart, plan.beats[index]!.sourceEnd),
    );
  const sectionOf = (index: number) =>
    sections.find(
      (section) =>
        plan.beats[index]!.sourceStart >= section.sourceStart &&
        plan.beats[index]!.sourceStart < section.sourceEnd,
    )?.blockId;
  const blocks = new Map<string, PresentationHints['blocks'][number]>();
  const entry = (blockId: string) => {
    const found = blocks.get(blockId) ?? { blockId, slides: [] };
    blocks.set(blockId, found);
    return found;
  };
  sections.forEach((section, index) => {
    const block = entry(section.blockId);
    block.slides!.push({ headline: `Opening ${index}`, points: [`Point ${index}`, 'Another'] });
    if (index % 2 === 0) block.layout = 'cards';
    if (index % 3 === 1) block.inbetweens = false;
  });
  plan.beats.forEach((_beat, index) => {
    const blockId = sectionOf(index);
    if (!blockId) return;
    const passage = keyOf(index);
    entry(blockId).slides!.push(
      index % 3 === 2
        ? { passage, hidden: true, label: `Hidden ${index}` }
        : {
            passage,
            origin: 'ai',
            layout: 'statement',
            headline: `Suggested ${index}`,
            points: [`AI point ${index}`],
          },
    );
  });
  return { version: 1, density: 'concise', inbetweens: false, blocks: [...blocks.values()] };
}

/** The same design with every other slide changed and every third one gone. */
function changed(hints: PresentationHints): PresentationHints {
  let counter = 0;
  return {
    ...hints,
    density: 'balanced',
    inbetweens: true,
    blocks: hints.blocks.map((block) => ({
      ...block,
      layout: undefined,
      slides: (block.slides ?? [])
        .filter(() => counter++ % 3 !== 2)
        .map((slide, index) =>
          index % 2 ? { ...slide, headline: `${slide.headline ?? 'Untitled'} (changed)` } : slide,
        ),
    })),
  };
}

function record(md: string) {
  const design = designFor(md);
  const written = writePresentationHints(md, design);
  const rewritten = writePresentationHints(written.result, changed(design));
  const entries = readPresentationHints(convert(written.result)).entries;
  const removed = removeSummaryBlocks(
    written.result,
    entries.filter((_entry, index) => index % 2 === 0).map((entry) => entry.accessoryBlockId),
  );
  return {
    written: written.result,
    writtenRejected: written.rejected.map((issue) => issue.code),
    rewritten: rewritten.result,
    removed: removed.result,
    reset: resetPresentationHints(written.result).result,
    idempotent: writePresentationHints(written.result, written.hints).edits.length,
  };
}

describe('the summary writer, recorded', () => {
  it('writes, changes, removes and resets exactly as recorded', async () => {
    const cases: Record<string, unknown> = {};
    for (const [name, md] of Object.entries(DOCUMENTS)) cases[name] = record(md);
    cases['plain, Windows line endings'] = record(DOCUMENTS.plain!.replace(/\n/g, '\r\n'));
    cases['plain, no final line ending'] = record(DOCUMENTS.plain!.trimEnd());
    await expect(`${JSON.stringify(cases, null, 2)}\n`).toMatchFileSnapshot(
      './golden/presentationHintsSource.golden.json',
    );
  });
});
