/**
 * A slide summary stays with its slide. It is keyed to the slide's passage
 * and records where the slide begins in its section (`at`), so when the text
 * changes it goes to the slide that begins there now, and when a section is
 * cut differently, to the slide holding that sentence. Only a section that
 * makes fewer slides than it has summaries leaves one over; a summary made at
 * another summary length waits for it.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import {
  bindPresentationDesigns,
  createPresentationPlan,
  presentationSlideStarts,
  withSlideStarts,
} from '../transform/presentationPlanner.js';
import {
  defaultPresentationHints,
  presentationSections,
  presentationSlideKey,
  withBlockHint,
  withPresentationDensity,
  withSlideHint,
  type PresentationHints,
  type PresentationSlideHint,
} from '../transform/presentationHints.js';
import { presentationHintUsage, readPresentationHints } from '../transform/presentationHintsDoc.js';
import { writePresentationHints } from '../transform/presentationHintsSource.js';

const parse = (text: string) => markdownToDoc(parseMarkdown(text));
const STORY = [
  '# Plan',
  '',
  ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']
    .map((nth) => `The ${nth} slide should carry one idea that the narration explains in depth.`)
    .join(' '),
  '',
  '## Next',
  '',
  'Ship it soon.',
].join('\n');
const EDITED = STORY.replace(/should carry/gu, 'must carry');
const balanced: PresentationHints = { ...defaultPresentationHints(), density: 'balanced' };
const doc = parse(STORY);
const plan = createPresentationPlan(doc, balanced);
const sections = presentationSections(doc);
const planId = sections[0]!.blockId;
const starts = presentationSlideStarts(plan, sections);
const ownSlides = plan.beats.filter((beat) => beat.sourceStart < sections[1]!.sourceStart);

/** An AI summary for slide `index` of the plan above, as the designer saves one. */
function suggested(
  hints: PresentationHints,
  index: number,
  headline: string,
  extra: Partial<PresentationSlideHint> = {},
): PresentationHints {
  return withSlideHint(hints, planId, presentationSlideKey(plan, index), {
    origin: 'ai',
    layout: 'statement',
    headline,
    points: [],
    at: starts[index]!,
    ...extra,
  });
}
/** The summaries the deck cannot use, read back from the document as written. */
function unused(source: string, hints: PresentationHints) {
  const written = parse(writePresentationHints(source, hints).result);
  const read = readPresentationHints(written);
  return presentationHintUsage(written, createPresentationPlan(written, read.hints), read);
}

describe('a slide summary', () => {
  it('records where its slide begins: the sentence it opens with', () => {
    expect(ownSlides.length).toBeGreaterThanOrEqual(3);
    expect(starts.slice(0, ownSlides.length)).toEqual(
      [...starts.slice(0, ownSlides.length)].sort((a, b) => a! - b!),
    );
    expect(starts[0]).toBe(1);
    expect(starts[1]).toBeGreaterThan(1);
  });

  it('stays with its slide when the text of its passage changes', () => {
    const hints = suggested(balanced, 1, 'The middle of the plan');
    const edited = createPresentationPlan(parse(EDITED), hints);
    expect(edited.beats[1]!.headline).toBe('The middle of the plan');
    expect(edited.beats.filter((beat) => beat.headline === 'The middle of the plan')).toHaveLength(
      1,
    );
    expect(unused(EDITED, hints)).toEqual([]);
  });

  it('keeps its slide hidden when the text changes', () => {
    const hints = withSlideHint(balanced, planId, presentationSlideKey(plan, 2), {
      hidden: true,
      at: starts[2]!,
    });
    const edited = createPresentationPlan(parse(EDITED), hints);
    expect(edited.beats.map((beat) => !!beat.hidden)).toEqual(
      plan.beats.map((_, index) => index === 2),
    );
  });

  it('goes to the slide holding its sentence when the section is cut differently', () => {
    const last = ownSlides.length - 1;
    let hints = suggested(balanced, 0, 'How the plan opens');
    hints = suggested(hints, last, 'How the plan ends');
    const two = createPresentationPlan(doc, withBlockHint(hints, planId, { count: 2 }));
    expect(two.beats[0]!.headline).toBe('How the plan opens');
    expect(two.beats[1]!.headline).toBe('How the plan ends');
  });

  it('is left over only when its section makes fewer slides than it has summaries', () => {
    let hints = balanced;
    ownSlides.forEach((_, index) => {
      hints = suggested(hints, index, `Part ${index + 1} of the plan`);
    });
    const one = withBlockHint(hints, planId, { count: 1 });
    const binding = bindPresentationDesigns(createPresentationPlan(doc, one), sections, one);
    expect(binding.slides.size).toBe(1);
    expect(binding.leftover.map((item) => item.reason)).toEqual(
      ownSlides.slice(1).map(() => 'fewer'),
    );
    const issues = unused(STORY, one);
    expect(issues.map((issue) => issue.code)).toEqual(
      ownSlides.slice(1).map(() => 'summary-not-in-use'),
    );
    expect(issues[0]!.message).toContain('fewer slides now than it has summaries');
    // Told in as many slides again, every one has its summary.
    expect(unused(STORY, hints)).toEqual([]);
  });

  it('saved before it recorded its start, matches only its exact passage until it learns it', () => {
    const legacy = suggested(balanced, 1, 'The middle of the plan', { at: undefined });
    const { at: _at, ...withoutStart } = legacy.blocks[0]!.slides![0]!;
    void _at;
    const old: PresentationHints = {
      ...legacy,
      blocks: [{ blockId: planId, slides: [withoutStart] }],
    };
    expect(createPresentationPlan(parse(EDITED), old).beats[1]!.headline).not.toBe(
      'The middle of the plan',
    );
    expect(unused(EDITED, old).map((issue) => issue.message)).toEqual([
      expect.stringContaining('saved before summaries recorded where their slide begins'),
    ]);
    // While it still matches, the next save records where its slide begins.
    const learned = withSlideStarts(plan, sections, old);
    expect(learned.blocks[0]!.slides![0]!.at).toBe(starts[1]);
    expect(createPresentationPlan(parse(EDITED), learned).beats[1]!.headline).toBe(
      'The middle of the plan',
    );
  });

  it('made at another summary length, waits for it', () => {
    const hints = suggested(balanced, 1, 'The middle of the plan');
    const keyPoints = withPresentationDensity(hints, 'keypoints');
    expect(keyPoints.blocks[0]!.slides![0]!.length).toBe('balanced');
    expect(
      createPresentationPlan(doc, keyPoints).beats.some(
        (beat) => beat.headline === 'The middle of the plan',
      ),
    ).toBe(false);
    expect(unused(STORY, keyPoints).map((issue) => issue.code)).toEqual(['summary-other-length']);
    const back = withPresentationDensity(keyPoints, 'balanced');
    expect(back.blocks[0]!.slides![0]!.length).toBeUndefined();
    expect(createPresentationPlan(doc, back).beats[1]!.headline).toBe('The middle of the plan');
    expect(unused(STORY, back)).toEqual([]);
  });

  it('hiding a title slide waits while there are no title slides, and hides nothing else', () => {
    const titled: PresentationHints = { ...defaultPresentationHints(), sectionTitles: true };
    const text = `# Opening\n\nThe deck opens here.\n\n${STORY.replace('# Plan', '## Plan')}`;
    const titledDoc = parse(text);
    const withTitles = createPresentationPlan(titledDoc, titled);
    const index = withTitles.beats.findIndex((beat) => beat.sectionTitle);
    const plan2 = presentationSections(titledDoc).find((item) => item.heading === 'Plan')!;
    const hints = withSlideHint(titled, plan2.blockId, presentationSlideKey(withTitles, index), {
      hidden: true,
      at: 0,
    });
    expect(createPresentationPlan(titledDoc, hints).beats[index]!.hidden).toBe(true);
    const off = { ...hints, sectionTitles: false };
    expect(createPresentationPlan(titledDoc, off).beats.some((beat) => beat.hidden)).toBe(false);
    expect(unused(text, off)).toEqual([]);
  });
});

describe('wording', () => {
  it('never changes which slides a section makes', () => {
    const text = [
      '# Opening',
      '',
      'The deck opens here, before the report.',
      '',
      '## Making a report',
      '',
      'A good report takes a plan before anything is written down, and the plan decides the order of the work. ' +
        'First, gather the sources you trust and note what each one says. ' +
        'Then, write an outline of the sections and what each will argue. ' +
        'Next, draft each section in turn from the outline. ' +
        'Finally, review the whole report against the plan.',
    ].join('\n');
    const reportDoc = parse(text);
    const automatic = createPresentationPlan(reportDoc);
    const report = presentationSections(reportDoc).find(
      (item) => item.heading === 'Making a report',
    )!;
    const own = (planned: typeof automatic) =>
      planned.beats.filter((beat) => beat.sourceStart >= report.sourceStart);
    // An introduction, then its steps: the slide that shows the steps is a
    // supporting slide of its own.
    expect(own(automatic).map((beat) => beat.layout)).toEqual(['statement', 'steps']);
    // Your highlights on the section's opening slide change that slide only.
    const worded = createPresentationPlan(
      reportDoc,
      withSlideHint(defaultPresentationHints(), report.blockId, undefined, {
        points: ['Plan first', 'Then write'],
      }),
    );
    expect(own(worded).map((beat) => [beat.sourceStart, beat.sourceEnd])).toEqual(
      own(automatic).map((beat) => [beat.sourceStart, beat.sourceEnd]),
    );
    expect(own(worded)[0]!.points).toEqual(['Plan first', 'Then write']);
    expect(own(worded)[1]!.points).toEqual(own(automatic)[1]!.points);
  });
});
