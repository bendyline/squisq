/**
 * Section title slides: asked for, each headed section after the first opens
 * on a slide that shows only its heading, on screen while the heading is
 * read. The section's other slides then each take a headline of their own,
 * and no model is asked to word the title slide.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { createPresentationPlan } from '../transform/presentationPlanner.js';
import { compilePresentationPlan } from '../transform/presentationCompiler.js';
import {
  SUMMARY_SECTION_TITLES_KEY,
  canonicalPresentationHints,
  defaultPresentationHints,
  parsePresentationHints,
  presentationPassageKey,
  presentationSections,
  presentationSlideKey,
  withSlideHint,
  type PresentationHints,
} from '../transform/presentationHints.js';
import { presentationHintUsage, readPresentationHints } from '../transform/presentationHintsDoc.js';
import {
  resetPresentationHints,
  writePresentationHints,
} from '../transform/presentationHintsSource.js';
import {
  parsePresentationPlan,
  presentationBeatIsWorded,
  serializePresentationPlan,
  type PresentationPlan,
} from '../transform/presentationPlan.js';
import {
  presentationSlideNeedsOwnHeadline,
  presentationSlideRequest,
  presentationSlidesToWord,
} from '../transform/presentationAuthor.js';

const parse = (text: string) => markdownToDoc(parseMarkdown(text));
const titled = (hints: Partial<PresentationHints> = {}): PresentationHints => ({
  ...defaultPresentationHints(),
  sectionTitles: true,
  ...hints,
});

const DOC = [
  '# Where small models work',
  '',
  'Local models have a lower ceiling than frontier models, but they are private, cheap and always available. ' +
    'That trade is worth making for routine work such as reviewing documents and summarizing notes. ' +
    'We spent a month measuring which everyday tasks they are good enough for.',
  '',
  '## The first finding',
  '',
  'Giving a small model a recipe of careful steps made its results worse, not better. ' +
    'Every step is another chance to lose the thread, and a small model loses it often. ' +
    'A model that fails step three never reaches step four, however well it would have done there. ' +
    'Step-by-step plans also cost time, because each step reloads the whole prompt before any work begins.',
  '',
  '![A chart of the results](results.png)',
  '',
  '## What helped instead',
  '',
  'What helped instead was a contract: a plain statement of the goal, the deliverables and the checks. ' +
    'With a contract, the model chooses its own path and is judged only on where it ends up. ' +
    'Small models passed 59 of 90 tasks this way, against 39 of 90 when walked through the steps.',
  '',
].join('\n');

const passageOf = (plan: PresentationPlan, index: number) =>
  plan.sourceText.slice(plan.beats[index]!.sourceStart, plan.beats[index]!.sourceEnd);
/** The beats made from one section, by its heading. */
function slidesOf(text: string, plan: PresentationPlan, heading: string) {
  const section = presentationSections(parse(text)).find((item) => item.heading === heading)!;
  return plan.beats.filter(
    (beat) => beat.sourceStart >= section.sourceStart && beat.sourceStart < section.sourceEnd,
  );
}
const blockIdOf = (text: string, heading: string) =>
  presentationSections(parse(text)).find((item) => item.heading === heading)!.blockId;

describe('section title slides', () => {
  it('are off unless asked for', () => {
    expect(defaultPresentationHints().sectionTitles).toBeUndefined();
    const plan = createPresentationPlan(parse(DOC));
    expect(plan.beats.some((beat) => beat.sectionTitle)).toBe(false);
    expect(plan.beats.some((beat) => beat.layout === 'divider')).toBe(false);
  });

  it('open each section after the first on its heading alone, while the heading is read', () => {
    const doc = parse(DOC);
    const plain = createPresentationPlan(doc);
    const plan = createPresentationPlan(doc, titled());
    const titles = plan.beats.filter((beat) => beat.sectionTitle);
    expect(titles.map((beat) => beat.headline)).toEqual([
      'The first finding',
      'What helped instead',
    ]);
    // The deck still opens on its title slide; the rest are the slides it had.
    expect(plan.beats[0]!.layout).toBe('title');
    expect(plan.beats[0]!.sectionTitle).toBeUndefined();
    expect(plan.beats).toHaveLength(plain.beats.length + 2);
    for (const title of titles) {
      const index = plan.beats.indexOf(title);
      expect(title.layout).toBe('divider');
      expect(title.points).toEqual([]);
      // It stands for the heading's own words, and the section's first slide
      // begins at its first sentence.
      expect(passageOf(plan, index)).toBe(title.headline);
      const next = plan.beats[index + 1]!;
      expect(next.sectionTitle).toBeUndefined();
      expect(plan.sourceText.slice(title.sourceEnd, next.sourceStart).trim()).toBe('');
      // The heading was just shown, so that slide sets up its own points.
      expect(next.headline).not.toBe(title.headline);
    }
    expect(slidesOf(DOC, plan, 'The first finding')[1]!.headline).toBe(
      'Giving a small model a recipe of careful steps made its results worse, not better',
    );
  });

  it('carry none of the section’s pictures, tables or diagrams', () => {
    const plan = createPresentationPlan(parse(DOC), titled());
    const [title, ...rest] = slidesOf(DOC, plan, 'The first finding');
    expect(title!.sectionTitle).toBe(true);
    expect(title!.media).toBeUndefined();
    expect(title!.imageSrc).toBeUndefined();
    expect(rest.some((beat) => beat.media?.length || beat.imageSrc)).toBe(true);
  });

  it('are not made for a section that is only a heading', () => {
    const text = `${DOC}\n## Thanks\n`;
    const plan = createPresentationPlan(parse(text), titled());
    const thanks = slidesOf(text, plan, 'Thanks');
    expect(thanks).toHaveLength(1);
    expect(thanks[0]!.sectionTitle).toBeUndefined();
    expect(thanks[0]!.headline).toBe('Thanks');
  });

  it('are never worded by a model, and the slide after one is asked for a headline of its own', () => {
    const plan = createPresentationPlan(parse(DOC), titled());
    const asked = presentationSlidesToWord(plan);
    plan.beats.forEach((beat, index) => {
      if (!beat.sectionTitle) return;
      expect(presentationBeatIsWorded(beat)).toBe(false);
      expect(asked).not.toContain(index);
      expect(asked).toContain(index + 1);
      expect(presentationSlideNeedsOwnHeadline(plan, index + 1)).toBe(true);
      const request = JSON.parse(presentationSlideRequest(plan, index + 1)) as {
        section: string;
        part: string;
        current: { headline?: string };
      };
      expect(request.section).toBe(beat.headline);
      expect(request.part).toMatch(/^2 of \d+$/u);
      expect(request.current.headline).toBeUndefined();
    });
  });

  it('leave your opening wording and hidden opening slide to the slide after them', () => {
    const blockId = blockIdOf(DOC, 'The first finding');
    const worded = createPresentationPlan(
      parse(DOC),
      withSlideHint(titled(), blockId, undefined, { headline: 'Recipes hurt small models' }),
    );
    const [title, opening] = slidesOf(DOC, worded, 'The first finding');
    expect(title!.headline).toBe('The first finding');
    expect(opening!.headline).toBe('Recipes hurt small models');

    const hidden = slidesOf(
      DOC,
      createPresentationPlan(
        parse(DOC),
        withSlideHint(titled(), blockId, undefined, { hidden: true }),
      ),
      'The first finding',
    );
    expect(hidden[0]!.hidden).toBeUndefined();
    expect(hidden[1]!.hidden).toBe(true);
  });

  it('hide one at a time, by the heading they show', () => {
    const blockId = blockIdOf(DOC, 'The first finding');
    const plan = createPresentationPlan(
      parse(DOC),
      withSlideHint(titled(), blockId, presentationPassageKey('The first finding'), {
        hidden: true,
      }),
    );
    const [title, opening] = slidesOf(DOC, plan, 'The first finding');
    expect(title!.sectionTitle).toBe(true);
    expect(title!.hidden).toBe(true);
    expect(opening!.hidden).toBeUndefined();
    expect(slidesOf(DOC, plan, 'What helped instead')[0]!.hidden).toBeUndefined();
  });

  it('keep the AI wording and hidden slides designed without them, and the other way round', () => {
    const doc = parse(DOC);
    const plain = createPresentationPlan(doc);
    const openingOf = (plan: PresentationPlan, heading: string) => {
      const section = presentationSections(doc).find((item) => item.heading === heading)!;
      return plan.beats.findIndex(
        (beat) => !beat.sectionTitle && beat.sourceStart >= section.sourceStart,
      );
    };
    const finding = blockIdOf(DOC, 'The first finding');
    const helped = blockIdOf(DOC, 'What helped instead');
    // Keyed as a deck without title slides keys them: the opening slide's
    // passage begins with the heading.
    let hints = withSlideHint(
      defaultPresentationHints(),
      finding,
      presentationSlideKey(plain, openingOf(plain, 'The first finding')),
      {
        origin: 'ai',
        layout: 'cards',
        headline: 'Recipes made small models worse',
        points: ['Every step can lose the thread', 'Each step reloads the prompt'],
      },
    );
    hints = withSlideHint(
      hints,
      helped,
      presentationSlideKey(plain, openingOf(plain, 'What helped instead')),
      { hidden: true, label: 'What helped instead' },
    );
    const source = writePresentationHints(DOC, { ...hints, sectionTitles: true }).result;
    const saved = parse(source);
    const read = readPresentationHints(saved);
    const plan = createPresentationPlan(saved, read.hints);
    expect(presentationHintUsage(saved, plan, read)).toEqual([]);
    const [findingTitle, findingOpening] = slidesOf(source, plan, 'The first finding');
    expect(findingTitle!.sectionTitle).toBe(true);
    expect(findingOpening!.headline).toBe('Recipes made small models worse');
    expect(findingOpening!.points).toEqual([
      'Every step can lose the thread',
      'Each step reloads the prompt',
    ]);
    const [helpedTitle, helpedOpening] = slidesOf(source, plan, 'What helped instead');
    expect(helpedTitle!.hidden).toBeUndefined();
    expect(helpedOpening!.hidden).toBe(true);

    // Suggested with title slides on, it applies with them off.
    const titledPlan = createPresentationPlan(doc, titled());
    const back = createPresentationPlan(
      doc,
      withSlideHint(
        defaultPresentationHints(),
        helped,
        presentationSlideKey(titledPlan, openingOf(titledPlan, 'What helped instead')),
        { origin: 'ai', layout: 'statement', headline: 'Contracts beat recipes', points: [] },
      ),
    );
    expect(back.beats[openingOf(back, 'What helped instead')]!.headline).toBe(
      'Contracts beat recipes',
    );
  });

  it('keep the slide after them from repeating the heading in AI wording made without them', () => {
    const doc = parse(DOC);
    const plain = createPresentationPlan(doc);
    const section = presentationSections(doc).find((item) => item.heading === 'The first finding')!;
    const index = plain.beats.findIndex((beat) => beat.sourceStart === section.sourceStart);
    const hints = withSlideHint(titled(), section.blockId, presentationSlideKey(plain, index), {
      origin: 'ai',
      layout: 'cards',
      headline: 'The first finding',
      points: ['Every step can lose the thread', 'Each step reloads the prompt'],
    });
    const automatic = slidesOf(DOC, createPresentationPlan(doc, titled()), 'The first finding')[1]!;
    const [, opening] = slidesOf(DOC, createPresentationPlan(doc, hints), 'The first finding');
    expect(opening!.headline).toBe(automatic.headline);
    expect(opening!.points).toEqual([
      'Every step can lose the thread',
      'Each step reloads the prompt',
    ]);
  });

  it('never leave the heading twice in a row where slides follow the text', () => {
    const text = [
      '# Northwind',
      '',
      'Northwind makes planning tools.',
      '',
      '## Offline for years',
      '',
      'Northwind builds careful software for people who plan their week, and it keeps every plan on the machine they already own. ' +
        'While many products depend on remote services that change without notice, Northwind ships tools that keep working offline for years.',
      '',
    ].join('\n');
    const plan = createPresentationPlan(parse(text), titled({ density: 'concise' }));
    const [title, first] = slidesOf(text, plan, 'Offline for years');
    expect(title!.sectionTitle).toBe(true);
    // No sentence is short enough to title the slide whole, so one is
    // shortened to a headline, and it stays whole among the slide's points.
    expect(first!.headline).not.toBe('Offline for years');
    expect(first!.headline.endsWith('…')).toBe(true);
    const sentence = passageOf(plan, plan.beats.indexOf(first!)).split(/(?<=\.)\s/u)[0]!;
    expect(first!.points).toContain(sentence);
    for (const point of first!.points) expect(point.endsWith('…')).toBe(false);
  });

  it('stay up long enough to read, and the deck runs as long as without them', () => {
    const doc = parse(DOC);
    const plain = compilePresentationPlan(doc, createPresentationPlan(doc));
    const plan = createPresentationPlan(doc, titled());
    const deck = compilePresentationPlan(doc, plan);
    const titles = deck.blocks.filter((block) => block.template === 'sectionHeader');
    expect(titles.map((block) => (block as { title?: string }).title)).toEqual([
      'The first finding',
      'What helped instead',
    ]);
    // Said aloud, each heading takes about a second; it stays up for two.
    for (const block of titles) expect(block.duration).toBeGreaterThanOrEqual(2);
    expect(deck.duration).toBe(plain.duration);
    // Every slide follows the one before it without a gap.
    deck.blocks.slice(1).forEach((block, index) => {
      const before = deck.blocks[index]!;
      expect(block.startTime).toBeCloseTo(before.startTime! + before.duration, 6);
    });
  });

  it('are saved with the plan, and only as a heading alone', () => {
    const plan = createPresentationPlan(parse(DOC), titled());
    const back = parsePresentationPlan(serializePresentationPlan(plan))!;
    expect(back.beats.filter((beat) => beat.sectionTitle)).toHaveLength(2);
    const index = plan.beats.findIndex((beat) => beat.sectionTitle);
    const edit = (change: Record<string, unknown>) => ({
      ...plan,
      beats: plan.beats.map((beat, at) => (at === index ? { ...beat, ...change } : beat)),
    });
    expect(parsePresentationPlan(edit({ layout: 'statement' }))).toBeNull();
    expect(parsePresentationPlan(edit({ points: ['A point'] }))).toBeNull();
    expect(parsePresentationPlan(edit({ sectionTitle: false }))).toBeNull();
  });
});

describe('the section title setting', () => {
  it('is a frontmatter key, written only when on', () => {
    const on = writePresentationHints(DOC, titled());
    expect(on.result).toMatch(new RegExp(`^${SUMMARY_SECTION_TITLES_KEY}: true$`, 'mu'));
    expect(on.rejected).toEqual([]);
    const read = readPresentationHints(parse(on.result));
    expect(read.format).toBe('blocks');
    expect(read.hints.sectionTitles).toBe(true);

    const off = writePresentationHints(on.result, { ...read.hints, sectionTitles: false });
    expect(off.result).not.toContain(SUMMARY_SECTION_TITLES_KEY);
    expect(resetPresentationHints(on.result).result).not.toContain(SUMMARY_SECTION_TITLES_KEY);
    // Writing a design without it adds nothing.
    expect(writePresentationHints(DOC, defaultPresentationHints()).result).toBe(DOC);
  });

  it('reads false as off and reports a value it does not know', () => {
    const at = (value: string) =>
      readPresentationHints(parse(`---\n${SUMMARY_SECTION_TITLES_KEY}: ${value}\n---\n${DOC}`));
    expect(at('false').hints.sectionTitles).toBeUndefined();
    expect(at('false').issues).toEqual([]);
    const unknown = at('sometimes');
    expect(unknown.hints.sectionTitles).toBeUndefined();
    expect(unknown.issues.map((issue) => issue.code)).toEqual(['setting-invalid']);
  });

  it('is part of the design wherever it is compared or checked', () => {
    expect(parsePresentationHints(titled())?.sectionTitles).toBe(true);
    expect(parsePresentationHints({ ...defaultPresentationHints(), sectionTitles: 'yes' })).toBe(
      null,
    );
    expect(canonicalPresentationHints(titled()).sectionTitles).toBe(true);
    expect(
      canonicalPresentationHints({ ...defaultPresentationHints(), sectionTitles: false }),
    ).toEqual(canonicalPresentationHints(defaultPresentationHints()));
  });
});
