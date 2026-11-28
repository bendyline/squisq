/**
 * The Custom summary design read from the document: frontmatter keys for the
 * document's settings, heading tags for a section's, and `{[summary]}`
 * accessory blocks for each designed slide. The legacy JSON key is still
 * read for older documents, and converts without changing the deck.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';
import { createPresentationPlan } from '../transform/presentationPlanner.js';
import {
  DYNAMIC_PRESENTATION_STYLE,
  PRESENTATION_HINTS_KEY,
  defaultPresentationHints,
  presentationHintsEqual,
  presentationPassageKey,
  presentationSections,
  serializePresentationHints,
  withSlideHint,
  type PresentationHints,
} from '../transform/presentationHints.js';
import {
  presentationHintUsage,
  presentationHintsForPlan,
  readPresentationHints,
} from '../transform/presentationHintsDoc.js';
import type { PresentationPlan } from '../transform/presentationPlan.js';

const parse = (text: string) => markdownToDoc(parseMarkdown(text));
const keyOf = (plan: PresentationPlan, index: number) =>
  presentationPassageKey(
    plan.sourceText.slice(plan.beats[index]!.sourceStart, plan.beats[index]!.sourceEnd),
  );

const STORY = [
  '# Start with an idea',
  '',
  'Write a few bullet points. Build a document with a clear story.',
  '',
  '## Make it visual',
  '',
  'First organize your points. Then add diagrams. Finally share your presentation.',
  '',
  '## Keep your voice',
  '',
  'Narration runs locally. Turn the same document into a narrated video.',
].join('\n');

/** STORY with summaries written where tools write them. */
function designed(keys: { visual: string; voice: string }, frontmatter = ''): string {
  return [
    ...(frontmatter ? ['---', frontmatter, '---', ''] : []),
    '# Start with an idea {[slideLayout=statement]}',
    '',
    'Write a few bullet points. Build a document with a clear story.',
    '',
    '## My opening headline {[summary]}',
    '',
    '- My first point',
    '- My second point',
    '',
    '## Make it visual {[supportingSlides=false]}',
    '',
    'First organize your points. Then add diagrams. Finally share your presentation.',
    '',
    `### Suggested by AI {[summary passage=${keys.visual} origin=ai layout=list]}`,
    '',
    '- An AI point',
    '- Another AI point',
    '',
    '## Keep your voice',
    '',
    'Narration runs locally. Turn the same document into a narrated video.',
    '',
    `### Narration runs locally {[summary passage=${keys.voice} hidden=true]}`,
  ].join('\n');
}

describe('reading the design from the document', () => {
  const plain = parse(STORY);
  const plan = createPresentationPlan(plain);
  const keys = { visual: keyOf(plan, 1), voice: keyOf(plan, 2) };
  const sections = presentationSections(plain).map((section) => section.blockId);

  it('reads document, section and slide settings', () => {
    const doc = parse(
      designed(keys, 'squisq-summary-density: concise\nsquisq-summary-supporting-slides: false'),
    );
    const read = readPresentationHints(doc);
    expect(read.format).toBe('blocks');
    expect(read.issues).toEqual([]);
    expect(read.hints.density).toBe('concise');
    expect(read.hints.inbetweens).toBe(false);
    expect(read.hints.blocks).toEqual([
      {
        blockId: sections[0],
        layout: 'statement',
        slides: [
          { headline: 'My opening headline', points: ['My first point', 'My second point'] },
        ],
      },
      {
        blockId: sections[1],
        inbetweens: false,
        slides: [
          {
            passage: keys.visual,
            origin: 'ai',
            layout: 'list',
            headline: 'Suggested by AI',
            points: ['An AI point', 'Another AI point'],
          },
        ],
      },
      {
        blockId: sections[2],
        slides: [{ passage: keys.voice, hidden: true, label: 'Narration runs locally' }],
      },
    ]);
    expect(read.entries.map((entry) => entry.accessoryBlockId)).toEqual([
      'start-with-an-idea~summary',
      'make-it-visual~summary',
      'keep-your-voice~summary',
    ]);
  });

  it('applies them: your wording, AI wording, a hidden slide', () => {
    const doc = parse(designed(keys));
    const designedPlan = createPresentationPlan(doc, readPresentationHints(doc).hints);
    expect(designedPlan.sourceText).toBe(plan.sourceText);
    expect(designedPlan.beats[0]).toMatchObject({
      headline: 'My opening headline',
      points: ['My first point', 'My second point'],
    });
    expect(designedPlan.beats[1]).toMatchObject({
      layout: 'list',
      headline: 'Suggested by AI',
      points: ['An AI point', 'Another AI point'],
    });
    expect(designedPlan.origin).toBe('ai');
    expect(designedPlan.beats[2]!.hidden).toBe(true);
  });

  it('keeps your opening wording when the section’s text changes', () => {
    const doc = parse(designed(keys).replace('a clear story', 'a gripping story'));
    const beats = createPresentationPlan(doc, readPresentationHints(doc).hints).beats;
    expect(beats[0]!.headline).toBe('My opening headline');
  });

  it('drops an AI suggestion once its passage changes, and reports it not in use', () => {
    const doc = parse(designed(keys).replace('Then add diagrams.', 'Then draw diagrams.'));
    const read = readPresentationHints(doc);
    const changed = createPresentationPlan(doc, read.hints);
    expect(changed.beats[1]!.headline).not.toBe('Suggested by AI');
    expect(presentationHintUsage(doc, changed, read)).toEqual([
      expect.objectContaining({
        code: 'summary-not-in-use',
        accessoryBlockId: 'make-it-visual~summary',
        blockId: sections[1],
        passage: keys.visual,
      }),
    ]);
  });

  it('lets your wording win over AI on the same slide, and points=none show none', () => {
    const doc = parse(
      [
        '# Start with an idea',
        '',
        'Write a few bullet points. Build a document with a clear story.',
        '',
        '## Mine wins {[summary points=none]}',
        '',
        `## Theirs {[summary passage=${keyOf(plan, 0)} origin=ai layout=list]}`,
        '',
        '- AI point one',
        '- AI point two',
      ].join('\n'),
    );
    const beat = createPresentationPlan(doc, readPresentationHints(doc).hints).beats[0]!;
    expect(beat.headline).toBe('Mine wins');
    expect(beat.points).toEqual([]);
  });

  it('leaves out only what it cannot use, and says why', () => {
    const doc = parse(
      [
        '## Orphan {[summary]}',
        '',
        '# Start with an idea',
        '',
        'Write a few bullet points. Build a document with a clear story.',
        '',
        '## Fine {[summary]}',
        '',
        '## Second opening {[summary]}',
        '',
        `## Bad layout {[summary passage=${keyOf(plan, 0)} layout=poster]}`,
        '',
        `## Bad key {[summary passage=Not-A-Key]}`,
        '',
        '## Too many {[summary passage=abc-1]}',
        '',
        '- 1',
        '- 2',
        '- 3',
        '- 4',
        '- 5',
      ].join('\n'),
    );
    const read = readPresentationHints(doc);
    expect(read.issues.map((issue) => issue.code)).toEqual([
      'summary-no-owner',
      'summary-duplicate',
      'summary-invalid',
      'summary-invalid',
      'summary-invalid',
    ]);
    expect(read.hints.blocks).toEqual([
      { blockId: 'start-with-an-idea', slides: [{ headline: 'Fine' }] },
    ]);
  });

  it('brings a hidden slide back into use when the density that made it returns', () => {
    const long = [
      '# Plan',
      '',
      'Each slide should carry one idea that the narration explains in more depth. '.repeat(8),
    ].join('\n');
    const balancedPlan = createPresentationPlan(parse(long), {
      ...defaultPresentationHints(),
      density: 'balanced',
    });
    expect(balancedPlan.beats.length).toBeGreaterThan(2);
    const doc = parse(
      `${long}\n\n## Later {[summary passage=${keyOf(balancedPlan, 2)} hidden=true]}`,
    );
    const read = readPresentationHints(doc);
    expect(createPresentationPlan(doc, read.hints).beats[2]!.hidden).toBe(true);
    // One slide per section cuts the passage differently: no slide is made from it.
    const perSection = createPresentationPlan(doc, { ...read.hints, density: 'section' });
    expect(presentationHintUsage(doc, perSection, read).map((issue) => issue.code)).toEqual([
      'summary-not-in-use',
    ]);
    expect(presentationHintUsage(doc, createPresentationPlan(doc, read.hints), read)).toEqual([]);
  });
});

describe('the legacy JSON design', () => {
  const plain = parse(STORY);
  const plan = createPresentationPlan(plain);
  const sections = presentationSections(plain);
  const legacy: PresentationHints = {
    ...defaultPresentationHints(),
    density: 'balanced',
    blocks: [
      {
        blockId: sections[0]!.blockId,
        wording: { source: sections[0]!.text, headline: 'A legacy headline' },
      },
      {
        blockId: sections[1]!.blockId,
        layout: 'cards',
        ai: [
          {
            source: plan.sourceText.slice(plan.beats[1]!.sourceStart, plan.beats[1]!.sourceEnd),
            layout: 'statement',
            headline: 'An AI headline',
            points: ['An AI point'],
          },
          {
            source: 'A passage that is no longer in the document.',
            layout: 'statement',
            headline: 'Stale',
            points: [],
          },
        ],
      },
      { blockId: sections[2]!.blockId, hidden: [keyOf(plan, 2), 'zzzz-9'] },
    ],
  };
  const withLegacy = (text: string, hints: PresentationHints | string) =>
    parse(
      [
        '---',
        `squisq-transform: ${DYNAMIC_PRESENTATION_STYLE}`,
        `${PRESENTATION_HINTS_KEY}: ${typeof hints === 'string' ? hints : serializePresentationHints(hints)}`,
        '---',
        '',
        text,
      ].join('\n'),
    );

  it('is read when the document has no summaries', () => {
    const read = readPresentationHints(withLegacy(STORY, legacy));
    expect(read.format).toBe('legacy');
    expect(presentationHintsEqual(read.hints, legacy)).toBe(true);
  });

  it('converts to summaries without changing the deck, keeping only what applies', () => {
    const doc = withLegacy(STORY, legacy);
    const before = createPresentationPlan(doc, legacy);
    const converted = presentationHintsForPlan(doc, legacy, before);
    expect(createPresentationPlan(doc, converted)).toEqual(before);
    // Each slide summary records where its slide begins: each section's first
    // sentence here.
    expect(converted.blocks).toEqual([
      { blockId: sections[0]!.blockId, slides: [{ headline: 'A legacy headline' }] },
      {
        blockId: sections[1]!.blockId,
        layout: 'cards',
        slides: [
          {
            passage: keyOf(plan, 1),
            at: 1,
            origin: 'ai',
            layout: 'statement',
            headline: 'An AI headline',
            points: ['An AI point'],
          },
        ],
      },
      {
        blockId: sections[2]!.blockId,
        slides: [
          { passage: keyOf(plan, 2), at: 1, hidden: true, label: before.beats[2]!.headline },
        ],
      },
    ]);
  });

  it('drops legacy wording whose section has changed when converting', () => {
    const edited = STORY.replace('a clear story', 'a gripping story');
    const doc = withLegacy(edited, legacy);
    const converted = presentationHintsForPlan(doc, legacy, createPresentationPlan(doc, legacy));
    expect(converted.blocks.find((block) => block.blockId === sections[0]!.blockId)).toBe(
      undefined,
    );
  });

  it('gives way to summaries in the document, and says so', () => {
    const doc = withLegacy(`${STORY}\n\n### Mine {[summary]}`, legacy);
    const read = readPresentationHints(doc);
    expect(read.format).toBe('blocks');
    expect(read.issues.map((issue) => issue.code)).toEqual(['legacy-ignored']);
    expect(read.hints.blocks).toEqual([
      { blockId: sections[2]!.blockId, slides: [{ headline: 'Mine' }] },
    ]);
  });

  it('reports an unreadable legacy design as before', () => {
    const preview = buildPreviewDoc(withLegacy(STORY, '{"version":2}'));
    expect(preview.diagnostics?.map((d) => d.code)).toContain('presentation-invalid');
  });
});

describe('the design in the slideshow', () => {
  it('shows your wording and never shows a summary as a slide', () => {
    const plan = createPresentationPlan(parse(STORY));
    const doc = parse(
      designed(
        { visual: keyOf(plan, 1), voice: keyOf(plan, 2) },
        `squisq-transform: ${DYNAMIC_PRESENTATION_STYLE}`,
      ),
    );
    const slides = buildPreviewDoc(doc);
    expect(slides.diagnostics ?? []).toEqual([]);
    const text = JSON.stringify(slides.blocks);
    expect(text).toContain('My opening headline');
    expect(text).toContain('An AI point');
    // The hidden slide is left out; nothing else is added.
    expect(slides.blocks).toHaveLength(2);
  });
});

describe('editing a design', () => {
  it('replaces and removes one slide’s design, keeping the rest', () => {
    let hints = withSlideHint(defaultPresentationHints(), 'a', undefined, { headline: 'One' });
    hints = withSlideHint(hints, 'a', 'abc-1', { hidden: true, label: 'Two' });
    hints = withSlideHint(hints, 'a', undefined, { headline: 'Uno' });
    expect(hints.blocks).toEqual([
      {
        blockId: 'a',
        slides: [{ passage: 'abc-1', hidden: true, label: 'Two' }, { headline: 'Uno' }],
      },
    ]);
    hints = withSlideHint(withSlideHint(hints, 'a', 'abc-1', null), 'a', undefined, null);
    expect(hints.blocks).toEqual([]);
  });
});
