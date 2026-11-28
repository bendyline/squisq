/**
 * Key points: a summary that tells each section in one to three slides,
 * showing what an audience should keep while the narration tells the rest.
 * The planner cuts sections evenly at sentences, chooses each slide's points
 * from its passage, and lets a section's author say how many slides it has.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import {
  createPresentationPlan,
  presentationSlideCounts,
} from '../transform/presentationPlanner.js';
import { compilePresentationPlan } from '../transform/presentationCompiler.js';
import {
  DEFAULT_PRESENTATION_DENSITY,
  PRESENTATION_DENSITIES,
  PRESENTATION_SECTION_SLIDES,
  defaultPresentationHints,
  parsePresentationHints,
  presentationPassageKey,
  presentationSections,
  withBlockHint,
  withSlideHint,
  type PresentationHints,
} from '../transform/presentationHints.js';
import { readPresentationHints } from '../transform/presentationHintsDoc.js';
import {
  resetPresentationHints,
  writePresentationHints,
} from '../transform/presentationHintsSource.js';
import { parsePresentationPlan, type PresentationPlan } from '../transform/presentationPlan.js';
import {
  KEY_POINT_CHARACTERS,
  divideSection,
  keyPointText,
  keySentences,
  sectionSlideCount,
  type KeySentence,
} from '../transform/keyPoints.js';

const parse = (text: string) => markdownToDoc(parseMarkdown(text));
const at = (density: PresentationHints['density']): PresentationHints => ({
  ...defaultPresentationHints(),
  density,
});
const passageOf = (plan: PresentationPlan, index: number) =>
  plan.sourceText.slice(plan.beats[index]!.sourceStart, plan.beats[index]!.sourceEnd);
/** The beats made from one section, by its heading. */
function slidesOf(text: string, plan: PresentationPlan, heading: string) {
  const section = presentationSections(parse(text)).find((item) => item.heading === heading)!;
  return plan.beats.filter(
    (beat) => beat.sourceStart >= section.sourceStart && beat.sourceStart < section.sourceEnd,
  );
}

/** Dense prose: three paragraphs, a little over 300 words, no lists. */
const PARAGRAPHS = [
  'Local models have a lower ceiling than frontier models, but they are private, cheap and always available. ' +
    'That trade is worth making for routine work such as reviewing documents and summarizing notes. ' +
    'It is not worth making for open-ended research, where a wrong turn early costs hours. ' +
    'The question is therefore not whether local models are good, but which tasks they are good enough for. ' +
    'We spent a month measuring exactly that across eighteen everyday tasks, from drafting a status report to cleaning a spreadsheet. ' +
    'Each task ran on three models of different sizes, and every result was graded against the same written checklist.',
  'The first finding surprised us. Giving a small model a recipe of careful steps made its results worse, not better. ' +
    'Every step is another chance to lose the thread, and a small model loses it often. ' +
    'A model that fails step three never reaches step four, however well it would have done there. ' +
    'For example, one model spent six attempts renaming a file it had already renamed. ' +
    'Step-by-step plans also cost time, because each step reloads the whole prompt before any work begins. ' +
    'On our hardware that reload alone added between one and three minutes per step.',
  'What helped instead was a contract: a plain statement of the goal, the deliverables and the checks the result must pass. ' +
    'With a contract, the model chooses its own path and is judged only on where it ends up. ' +
    'Small models passed 59 of 90 tasks this way, against 39 of 90 when walked through the steps. ' +
    'Larger models gained less, because they could already follow a recipe without getting lost. ' +
    'The important lesson is that structure belongs in the definition of done, not in the route taken to get there. ' +
    'We are now rewriting every task plan as a contract, and keeping the old recipes only as optional advice.',
];
const ESSAY = ['# Where small models work', '', ...PARAGRAPHS.flatMap((text) => [text, ''])].join(
  '\n',
);

describe('how many slides tell a section', () => {
  it('is one to three for an ordinary section, and more only for a very long one', () => {
    expect(sectionSlideCount(40)).toBe(1);
    expect(sectionSlideCount(130)).toBe(1);
    expect(sectionSlideCount(131)).toBe(2);
    expect(sectionSlideCount(330)).toBe(2);
    expect(sectionSlideCount(331)).toBe(3);
    expect(sectionSlideCount(660)).toBe(3);
    expect(sectionSlideCount(900)).toBe(5);
    expect(sectionSlideCount(100_000)).toBe(PRESENTATION_SECTION_SLIDES);
  });

  it('never leaves a slide more of the script than a model can be shown', () => {
    // Few words, each very long: the passage, not the word count, decides.
    expect(sectionSlideCount(100, 5000)).toBe(3);
  });
});

describe('dividing a section', () => {
  const starts = [20, 45, 50, 75, 100, 130, 150].map((position) => ({
    word: position,
    position,
    paragraph: position === 50 || position === 100,
  }));

  it('cuts evenly, at a paragraph when one is near the even cut', () => {
    // 80 is the even cut. A sentence begins nearer it, at 75, but the
    // paragraph at 100 is near enough to begin the slide instead.
    expect(divideSection(160, 160, starts, 2)).toEqual([
      [0, 100],
      [100, 160],
    ]);
    // 53 and 107 are the even cuts; the paragraphs at 50 and 100 are near them.
    expect(divideSection(160, 160, starts, 3)).toEqual([
      [0, 50],
      [50, 100],
      [100, 160],
    ]);
  });

  it('makes fewer slides when the passage has too few places to begin one', () => {
    expect(divideSection(60, 60, [{ word: 30, position: 30, paragraph: false }], 4)).toEqual([
      [0, 30],
      [30, 60],
    ]);
    expect(divideSection(60, 60, [], 3)).toEqual([[0, 60]]);
    expect(divideSection(0, 0, [], 3)).toEqual([]);
  });

  it('never makes a sliver of a slide', () => {
    // The only place to cut is five words in.
    expect(divideSection(120, 120, [{ word: 5, position: 5, paragraph: true }], 2)).toEqual([
      [0, 120],
    ]);
  });
});

describe('choosing key sentences', () => {
  const sentences = (text: string): KeySentence[] => {
    let cursor = 0;
    return text
      .split(/(?<=[.?])\s+|(?<=:)\s+(?=A contract lists|The important lesson)/u)
      .map((sentence) => {
        const start = text.indexOf(sentence, cursor);
        cursor = start + sentence.length;
        return { text: sentence, start, end: cursor };
      });
  };

  it('keeps the order they are spoken in and returns all of a short passage', () => {
    const few = sentences('Tea is brewed hot. Coffee is roasted first.');
    expect(keySentences(few, 3)).toEqual(few);
    const chosen = keySentences(sentences(PARAGRAPHS.join(' ')), 3);
    expect(chosen).toHaveLength(3);
    expect(chosen.map((item) => item.start)).toEqual(
      [...chosen.map((item) => item.start)].sort((a, b) => a - b),
    );
  });

  it('passes over an example, a question and a sentence that only introduces a list', () => {
    const chosen = keySentences(
      sentences(
        'Contracts beat recipes for small models. For example, one model renamed a file six times. ' +
          'Why does this happen? A contract lists three things: ' +
          'The important lesson is that structure belongs in the definition of done.',
      ),
      3,
    ).map((item) => item.text);
    expect(chosen).toEqual([
      'Contracts beat recipes for small models.',
      'The important lesson is that structure belongs in the definition of done.',
    ]);
  });

  it('prefers what the section keeps returning to, and what says it is the point', () => {
    const all = sentences(PARAGRAPHS[2]!);
    const chosen = keySentences(all, 2, { heading: 'Contracts', section: all }).map(
      (item) => item.text,
    );
    expect(chosen.some((text) => text.startsWith('What helped instead was a contract'))).toBe(true);
    // It shares no word with the rest of the section; it says it is the lesson.
    const three = keySentences(all, 3, { heading: 'Contracts', section: all }).map(
      (item) => item.text,
    );
    expect(three.some((text) => text.startsWith('The important lesson'))).toBe(true);
  });

  it('does not choose two sentences that say the same thing', () => {
    const chosen = keySentences(
      sentences(
        'A contract states the goal and the checks. The contract states the goal and its checks. ' +
          'Recipes cost time on every step. Small models lose the thread often. Results improved a lot.',
      ),
      2,
    ).map((item) => item.text);
    expect(chosen).toHaveLength(2);
    expect(chosen.filter((text) => /contract states the goal/iu.test(text))).toHaveLength(1);
  });
});

describe('a key point’s wording', () => {
  it('shows a sentence that fits whole, without the word that joined it to the one before', () => {
    expect(keyPointText('However, small models lose the thread often.')).toBe(
      'Small models lose the thread often.',
    );
    expect(keyPointText('In fact, a contract is enough for most tasks.')).toBe(
      'A contract is enough for most tasks.',
    );
    // Not a join: what is left would not stand alone.
    expect(keyPointText('So what?')).toBe('So what?');
  });

  it('cuts a long sentence at a clause that says something, and marks the cut', () => {
    const long =
      'Giving a small model a recipe of careful steps made its results worse, because every step is another chance to lose the thread, and a small model loses it often enough to matter.';
    const point = keyPointText(long);
    expect(point.length).toBeLessThanOrEqual(KEY_POINT_CHARACTERS);
    expect(point).toBe('Giving a small model a recipe of careful steps made its results worse…');
    // A cut at an early comma would say nothing: it is cut at a word instead.
    expect(
      keyPointText(
        'We believe, with the right set of supports in place around them and enough care in how tasks are framed for each kind of model, that local models are good enough.',
      ),
    ).toMatch(
      /^We believe, with the right set of supports in place around them and enough care in .*…$/u,
    );
  });

  it('drops an aside in brackets before it cuts anything', () => {
    expect(
      keyPointText(
        'Local models are good enough for many common knowledge worker tasks (reviewing documents; transcribing audio; watching an inbox; simple analysis).',
      ),
    ).toBe('Local models are good enough for many common knowledge worker tasks.');
  });

  it('shows a task-list item without the way its checkbox is spoken', () => {
    expect(keyPointText('[checked] · It has a rollback section')).toBe('It has a rollback section');
  });
});

describe('a deck told as key points', () => {
  it('is the default, and tells a long section in a few slides instead of a dozen', () => {
    expect(defaultPresentationHints().density).toBe(DEFAULT_PRESENTATION_DENSITY);
    expect(DEFAULT_PRESENTATION_DENSITY).toBe('keypoints');
    const doc = parse(ESSAY);
    const plan = createPresentationPlan(doc);
    expect(plan).toEqual(createPresentationPlan(doc, at('keypoints')));
    // Two slides for its 300 words, after the title that opens the deck.
    expect(plan.beats.map((beat) => beat.layout)).toEqual(['title', 'cards', 'cards']);
    expect(createPresentationPlan(doc, at('balanced')).beats.length).toBeGreaterThan(8);
    // The title shows as the passage begins, with its first sentence beneath it…
    expect(passageOf(plan, 0)).toBe(
      'Where small models work\nLocal models have a lower ceiling than frontier models, but they are private, cheap and always available.',
    );
    expect(plan.beats[0]!.points).toEqual([
      'Local models have a lower ceiling than frontier models, but they are private, cheap and always available.',
    ]);
    // …and the second slide begins at a paragraph. Together they cover the narration.
    expect(passageOf(plan, 1).startsWith('That trade is worth making')).toBe(true);
    expect(passageOf(plan, 2).startsWith('What helped instead was a contract')).toBe(true);
    expect(parsePresentationPlan(plan)).toEqual(plan);
    expect(compilePresentationPlan(doc, plan).blocks).toHaveLength(3);
  });

  it('shows the sentences that carry each passage, not its opening ones', () => {
    const plan = createPresentationPlan(parse(ESSAY));
    const [, finding, contract] = plan.beats;
    const shown = (beat: PresentationPlan['beats'][number]) =>
      [beat.headline, ...beat.points].join(' ');
    // The example and the reload detail are left to the narration.
    expect(shown(finding!)).not.toContain('renaming a file');
    // A later slide of the section is titled by the sentence that best
    // carries its passage, not by the section heading again.
    expect(finding!.headline).toBe(
      'Giving a small model a recipe of careful steps made its results worse, not better',
    );
    expect(contract!.points.some((point) => point.startsWith('The important lesson'))).toBe(true);
    expect(shown(contract!)).toContain('59 of 90');
    for (const beat of plan.beats) {
      expect(beat.points.length).toBeLessThanOrEqual(4);
      for (const point of beat.points)
        expect(point.length).toBeLessThanOrEqual(KEY_POINT_CHARACTERS);
    }
  });

  it('titles only a section’s first slide with its heading; each later one sets up its own points', () => {
    const essay = createPresentationPlan(parse(ESSAY));
    expect(essay.beats.map((beat) => beat.headline)).toEqual([
      'Where small models work',
      'Giving a small model a recipe of careful steps made its results worse, not better',
      'Small models passed 59 of 90 tasks this way, against 39 of 90 when walked through the steps',
    ]);
    // A line that sets up what follows titles its slide (a question here), and
    // the list it introduces stays whole beneath it.
    const text = [
      '# Fewer steps',
      '',
      'We gave small models two ways to do the same eighteen tasks. One way walked the model through a recipe of careful steps, each checked before the next began. The other way gave the model the goal and the checks its result had to pass, and left the route to the model. We expected the recipe to win, since small models lose the thread on long tasks. It did not. The goal-only runs passed more tasks on every small model we tried, and they finished in a third of the time.',
      '',
      'Why does less structure help a small model? The trial records point to three things:',
      '',
      '- Each step starts a fresh conversation that knows only what earlier steps wrote down',
      '- Each step has its own check with a limited number of attempts',
      '- Every hand-off reloads the whole prompt before any work begins',
      '',
      'A model that keeps everything in one conversation never has to rebuild what it already knew.',
    ].join('\n');
    const slides = createPresentationPlan(parse(text)).beats;
    expect(slides[0]!.headline).toBe('Fewer steps');
    const why = slides.find(
      (beat) => beat.headline === 'Why does less structure help a small model?',
    );
    expect(why?.points).toEqual([
      'Each step starts a fresh conversation that knows only what earlier steps wrote down',
      'Each step has its own check with a limited number of attempts',
      'Every hand-off reloads the whole prompt before any work begins',
    ]);
    // No later slide carries the heading, and none repeats its headline below it.
    for (const beat of slides.slice(1)) {
      expect(beat.headline).not.toBe('Fewer steps');
      expect(beat.points.map((point) => point.replace(/\.$/u, ''))).not.toContain(beat.headline);
    }
  });

  it('titles a later slide that follows the text only with a sentence it can show whole', () => {
    const short =
      '# Northwind\n\nNorthwind builds careful software for people who plan their week. Our tools run on the hardware you own. They keep working offline for years. Nothing leaves your machine without asking. Updates arrive when you choose to install them.';
    const plan = createPresentationPlan(parse(short), at('concise'));
    expect(plan.beats.map((beat) => beat.headline)).toEqual([
      'Northwind',
      'Nothing leaves your machine without asking',
    ]);
    expect(plan.beats[1]!.points).toEqual(['Updates arrive when you choose to install them.']);
    // Given a headline of the author's own, the slide shows that sentence again.
    const [section] = presentationSections(parse(short));
    const later = plan.beats[1]!;
    const retitled = createPresentationPlan(
      parse(short),
      withSlideHint(
        at('concise'),
        section!.blockId,
        presentationPassageKey(plan.sourceText.slice(later.sourceStart, later.sourceEnd)),
        { headline: 'Private by default' },
      ),
    ).beats[1]!;
    expect(retitled.headline).toBe('Private by default');
    expect(retitled.points).toEqual([
      'Nothing leaves your machine without asking.',
      'Updates arrive when you choose to install them.',
    ]);
    // Every sentence too long to title a slide whole: the heading does, so no
    // words the slide follows are cut short above it.
    const long =
      '# Northwind\n\nNorthwind builds careful software for people who plan their week, and it keeps every plan on the machine they already own. ' +
      'While many products depend on remote services that change without notice, Northwind ships tools that keep working offline for years. ' +
      'By relying on local storage and the steady growth of laptop processors, we think anyone can keep their planning private and fast.';
    const following = createPresentationPlan(parse(long), at('concise')).beats;
    expect(following.length).toBeGreaterThan(1);
    for (const beat of following) {
      expect(beat.headline).toBe('Northwind');
      for (const point of beat.points) expect(point.endsWith('…')).toBe(false);
    }
  });

  it('makes fewer slides than every length that follows the text, and says how many each makes', () => {
    const doc = parse(ESSAY);
    const counts = presentationSlideCounts(doc);
    expect(Object.keys(counts)).toEqual([...PRESENTATION_DENSITIES]);
    expect(counts.section).toBe(1);
    expect(counts.keypoints).toBe(3);
    expect(counts.detailed!).toBeGreaterThan(counts.keypoints!);
    expect(counts.balanced!).toBeGreaterThan(counts.detailed!);
    expect(counts.concise!).toBeGreaterThanOrEqual(counts.balanced!);
    // A hidden slide is not counted.
    expect(presentationSlideCounts(parse(''))).toEqual({});
  });

  it('takes an author’s list as the points, a numbered one as steps', () => {
    const text = [
      '# Writing a report',
      '',
      'A good report takes more care than people expect, and the care goes into preparation rather than typing. Most of the effort is spent before a single paragraph exists, which surprises new writers.',
      '',
      'A plan breaks the work into steps:',
      '',
      '1. Assemble sources and review the research',
      '2. Build an outline of the document',
      '3. Write the document from the outline',
      '',
      'Each step is small enough to check before the next one starts, which keeps mistakes from compounding.',
      '',
      '## What to check',
      '',
      'Before sending it, look for the things readers notice first.',
      '',
      '- Every figure has a source',
      '- The summary matches the body',
      '',
      'Nothing else matters as much as those two.',
    ].join('\n');
    const plan = createPresentationPlan(parse(text), { ...at('keypoints'), inbetweens: false });
    const [report] = slidesOf(text, plan, 'Writing a report');
    expect(report!.points).toEqual([
      'Assemble sources and review the research',
      'Build an outline of the document',
      'Write the document from the outline',
    ]);
    const [check] = slidesOf(text, plan, 'What to check');
    expect(check!.layout).toBe('cards');
    // A short list leaves room for one thing the prose around it says.
    expect(check!.points).toHaveLength(3);
    expect(check!.points).toEqual(
      expect.arrayContaining(['Every figure has a source', 'The summary matches the body']),
    );
    // With supporting slides, the introduction has a slide and the steps a diagram.
    const supported = createPresentationPlan(parse(text), at('keypoints'));
    const [intro, steps] = slidesOf(text, supported, 'Writing a report');
    expect([intro!.layout, steps!.layout]).toEqual(['statement', 'steps']);
    // The heading titles the introduction; the line that introduces the steps
    // titles them, and every step is still shown.
    expect(intro!.headline).toBe('Writing a report');
    expect(steps!.headline).toBe('A plan breaks the work into steps');
    expect(steps!.points).toEqual(report!.points);
  });

  it('never cuts a short list from what introduces it', () => {
    const lead =
      'Planning matters more than typing, and most of the work happens before the first paragraph. '.repeat(
        6,
      );
    const text = `# Report\n\n${lead}\n\nThe plan has three steps:\n\n- Gather\n- Outline\n- Write\n\n${lead}`;
    const plan = createPresentationPlan(parse(text), { ...at('keypoints'), inbetweens: false });
    const listed = plan.beats.findIndex((_, index) => passageOf(plan, index).includes('Gather'));
    expect(passageOf(plan, listed)).toContain('The plan has three steps:');
    expect(passageOf(plan, listed)).toContain('Write');
  });

  it('shows a table once, on the slide whose passage speaks of it', () => {
    const text = [
      '# Results',
      '',
      PARAGRAPHS[0],
      '',
      '| Model | Passed |',
      '| --- | --- |',
      '| Small | 59 |',
      '| Large | 80 |',
      '',
      PARAGRAPHS[1],
      '',
      PARAGRAPHS[2],
    ].join('\n');
    const doc = parse(text);
    const plan = createPresentationPlan(doc);
    expect(plan.beats).toHaveLength(3);
    const carrying = plan.beats.filter((beat) => beat.media?.length);
    expect(carrying).toHaveLength(1);
    expect(passageOf(plan, plan.beats.indexOf(carrying[0]!))).toContain('Small 59');
    // Slides that follow the text are short, so there the table stays up across them.
    const following = createPresentationPlan(doc, at('balanced'));
    expect(following.beats.filter((beat) => beat.media?.length).length).toBeGreaterThan(1);
    expect(compilePresentationPlan(doc, plan).blocks).toHaveLength(3);
  });

  it('keeps a section’s points when it has a picture', () => {
    const short =
      '# Intro\n\nOpening words.\n\n## Results\n\nRevenue grew 40% last year. Most of it came from new customers.\n\n![Map](images/map.png)';
    const plan = createPresentationPlan(parse(short));
    // Too short to share with a picture slide: the picture sits beside the words.
    expect(plan.beats[1]!.layout).not.toBe('image');
    expect(plan.beats[1]!.media).toEqual(['results#image-0']);
    expect(plan.beats[1]!.points.length).toBeGreaterThan(0);
    // One slide per section never adds a slide, so there the section is its picture.
    expect(createPresentationPlan(parse(short), at('section')).beats[1]!.layout).toBe('image');
    // A long section shares its narration with a supporting picture slide.
    const long = `# Intro\n\nOpening words.\n\n## Results\n\n${PARAGRAPHS[2]}\n\n![Map](images/map.png)`;
    const supported = createPresentationPlan(parse(long));
    expect(supported.beats.slice(1).map((beat) => beat.layout)).toEqual(['statement', 'image']);
    expect(supported.beats[1]!.points.length).toBeGreaterThan(0);
  });
});

describe('a section told in a number of slides its author chose', () => {
  const ids = (text: string) => presentationSections(parse(text)).map((item) => item.blockId);

  it('applies at every summary length, and to that section alone', () => {
    const text = `${ESSAY}\n## Next\n\n${PARAGRAPHS[0]}`;
    const [essay] = ids(text);
    const doc = parse(text);
    for (const density of PRESENTATION_DENSITIES) {
      const automatic = createPresentationPlan(doc, at(density));
      const two = createPresentationPlan(doc, withBlockHint(at(density), essay!, { count: 2 }));
      expect(slidesOf(text, two, 'Where small models work'), density).toHaveLength(2);
      expect(slidesOf(text, two, 'Next'), density).toHaveLength(
        slidesOf(text, automatic, 'Next').length,
      );
      expect(compilePresentationPlan(doc, two).blocks).toHaveLength(two.beats.length);
    }
    const one = createPresentationPlan(doc, withBlockHint(at('concise'), essay!, { count: 1 }));
    expect(slidesOf(text, one, 'Where small models work')).toHaveLength(1);
  });

  it('makes as many as the text divides into when asked for more', () => {
    const text = '# Short\n\nOne sentence here is all there is to say about it today.';
    const [short] = ids(text);
    const plan = createPresentationPlan(
      parse(text),
      withBlockHint(defaultPresentationHints(), short!, { count: 6 }),
    );
    expect(plan.beats).toHaveLength(1);
  });

  it('is read from and written to the section’s heading', () => {
    const tagged = ESSAY.replace(
      '# Where small models work',
      '# Where small models work {[slideCount=2]}',
    );
    const read = readPresentationHints(parse(tagged));
    expect(read.issues).toEqual([]);
    expect(read.hints.density).toBe('keypoints');
    expect(read.hints.blocks).toEqual([{ blockId: 'where-small-models-work', count: 2 }]);
    expect(createPresentationPlan(parse(tagged), read.hints).beats).toHaveLength(2);

    const written = writePresentationHints(
      ESSAY,
      withBlockHint(defaultPresentationHints(), 'where-small-models-work', { count: 2 }),
    );
    expect(written.rejected).toEqual([]);
    expect(written.result).toBe(tagged);
    const cleared = writePresentationHints(
      written.result,
      withBlockHint(written.hints, 'where-small-models-work', { count: undefined }),
    );
    expect(cleared.result).toBe(ESSAY);
    expect(resetPresentationHints(tagged).result).toBe(ESSAY);
  });

  it('refuses a count that is not a whole number of slides', () => {
    const block = (count: unknown) => ({
      ...defaultPresentationHints(),
      blocks: [{ blockId: 'a', count }],
    });
    expect(parsePresentationHints(block(3))).not.toBeNull();
    for (const count of [0, 1.5, -1, PRESENTATION_SECTION_SLIDES + 1, '2'])
      expect(parsePresentationHints(block(count)), String(count)).toBeNull();
    // A heading that says something else is left alone, and reported by the parser.
    const read = readPresentationHints(parse('# A {[slideCount=many]}\n\nText.'));
    expect(read.hints.blocks).toEqual([]);
  });
});

describe('how long a document without the key is summarized', () => {
  const body =
    '# Plan\n\nEach slide should carry one idea that the narration explains in more depth.\n';

  it('is key points for a document with no design, or one with settings only', () => {
    expect(readPresentationHints(parse(body)).hints.density).toBe('keypoints');
    expect(
      readPresentationHints(parse(body.replace('# Plan', '# Plan {[slideLayout=cards]}'))).hints
        .density,
    ).toBe('keypoints');
    expect(readPresentationHints(parse(`${body}\n## My words {[summary]}\n`)).hints.density).toBe(
      'keypoints',
    );
    expect(
      readPresentationHints(parse(`---\nsquisq-summary-supporting-slides: false\n---\n${body}`))
        .hints.density,
    ).toBe('keypoints');
  });

  it('is the older default for one that holds summaries keyed to a passage', () => {
    const keyed = `${body}\n## Old {[summary passage=1dbwj0s-1u hidden=true]}\n`;
    expect(readPresentationHints(parse(keyed)).hints.density).toBe('balanced');
    // …unless it says otherwise.
    expect(
      readPresentationHints(parse(`---\nsquisq-summary-density: keypoints\n---\n${keyed}`)).hints
        .density,
    ).toBe('keypoints');
  });

  it('is written whenever leaving it out would change how the document is read', () => {
    const keyed = {
      ...defaultPresentationHints(),
      blocks: [{ blockId: 'plan', slides: [{ passage: '1dbwj0s-1u', hidden: true as const }] }],
    };
    const written = writePresentationHints(body, keyed);
    expect(written.result).toContain('squisq-summary-density: keypoints');
    expect(written.hints.density).toBe('keypoints');
    // Settings and your own opening wording apply at any length: no key.
    const settings = writePresentationHints(body, {
      ...defaultPresentationHints(),
      blocks: [{ blockId: 'plan', layout: 'cards', slides: [{ headline: 'Mine' }] }],
    });
    expect(settings.result).not.toContain('squisq-summary-density');
    // Any other length always says so, and the default is taken back out.
    const balanced = writePresentationHints(body, at('balanced'));
    expect(balanced.result).toContain('squisq-summary-density: balanced');
    expect(writePresentationHints(balanced.result, defaultPresentationHints()).result).toBe(body);
  });

  it('reports a length it does not know and names the ones it does', () => {
    const read = readPresentationHints(parse(`---\nsquisq-summary-density: brief\n---\n${body}`));
    expect(read.hints.density).toBe('keypoints');
    expect(read.issues.map((issue) => issue.message)).toEqual([
      'The summary density "brief" is not one of section, keypoints, detailed, balanced or concise.',
    ]);
  });
});
