/**
 * Writing a Custom summary design into the document: frontmatter keys,
 * section settings on heading tags, and `{[summary]}` blocks — by targeted
 * edits that read back as the design written, touch nothing they need not,
 * and never change what is narrated.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { flattenContentBlocks, markdownToDoc } from '../doc/index.js';
import { buildNarrationScript } from '../narration/script.js';
import { createPresentationPlan } from '../transform/presentationPlanner.js';
import {
  DYNAMIC_PRESENTATION_STYLE,
  PRESENTATION_HINTS_KEY,
  defaultPresentationHints,
  presentationHintsEqual,
  presentationPassageKey,
  presentationSections,
  serializePresentationHints,
  type PresentationHints,
} from '../transform/presentationHints.js';
import {
  presentationHintsForPlan,
  readPresentationHints,
} from '../transform/presentationHintsDoc.js';
import {
  removeSummaryBlocks,
  resetPresentationHints,
  writePresentationHints,
} from '../transform/presentationHintsSource.js';
import type { PresentationPlan } from '../transform/presentationPlan.js';

const parse = (text: string) => markdownToDoc(parseMarkdown(text));
const read = (text: string) => readPresentationHints(parse(text));
const keyOf = (plan: PresentationPlan, index: number) =>
  presentationPassageKey(
    plan.sourceText.slice(plan.beats[index]!.sourceStart, plan.beats[index]!.sourceEnd),
  );
const realIds = (text: string) => flattenContentBlocks(parse(text).blocks).map((b) => b.id);
const narration = (text: string) => buildNarrationScript(parse(text)).sourceText;

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
  '',
].join('\n');

const plan = createPresentationPlan(parse(STORY));
const [start, visual, voice] = presentationSections(parse(STORY)).map((s) => s.blockId);

const DESIGN: PresentationHints = {
  version: 1,
  density: 'concise',
  inbetweens: false,
  blocks: [
    {
      blockId: start!,
      layout: 'statement',
      slides: [{ headline: 'My *opening*', points: ['First # point', 'Second point'] }],
    },
    {
      blockId: visual!,
      inbetweens: true,
      slides: [
        {
          passage: keyOf(plan, 1),
          origin: 'ai',
          layout: 'hub',
          center: 'Two words',
          headline: 'Suggested by AI',
          points: ['One', 'Two', 'Three'],
        },
      ],
    },
    {
      blockId: voice!,
      slides: [{ passage: keyOf(plan, 2), hidden: true, label: 'Narration runs locally' }],
    },
  ],
};

describe('writing a design', () => {
  const written = writePresentationHints(STORY, DESIGN);

  it('writes readable markdown in the right places', () => {
    expect(written.rejected).toEqual([]);
    expect(written.result).toBe(
      [
        '---',
        'squisq-summary-density: concise',
        'squisq-summary-supporting-slides: false',
        '---',
        '# Start with an idea {[slideLayout=statement]}',
        '',
        'Write a few bullet points. Build a document with a clear story.',
        '',
        '## My \\*opening\\* {[summary]}',
        '',
        '- First # point',
        '- Second point',
        '',
        '## Make it visual {[supportingSlides=true]}',
        '',
        'First organize your points. Then add diagrams. Finally share your presentation.',
        '',
        `### Suggested by AI {[summary passage=${keyOf(plan, 1)} origin=ai layout=hub center="Two words"]}`,
        '',
        '- One',
        '- Two',
        '- Three',
        '',
        '## Keep your voice',
        '',
        'Narration runs locally. Turn the same document into a narrated video.',
        '',
        `### Narration runs locally {[summary passage=${keyOf(plan, 2)} hidden=true]}`,
        '',
      ].join('\n'),
    );
  });

  it('reads back as the design written', () => {
    expect(presentationHintsEqual(written.hints, DESIGN)).toBe(true);
    expect(presentationHintsEqual(read(written.result).hints, DESIGN)).toBe(true);
  });

  it('changes nothing narrated and no real block’s id', () => {
    expect(narration(written.result)).toBe(narration(STORY));
    expect(realIds(written.result)).toEqual(realIds(STORY));
  });

  it('applies the edits it returns', () => {
    let out = '';
    let cursor = 0;
    for (const edit of written.edits) {
      out += STORY.slice(cursor, edit.start) + edit.text;
      cursor = edit.end;
    }
    expect(out + STORY.slice(cursor)).toBe(written.result);
  });

  it('is idempotent: writing what is there touches nothing', () => {
    const again = writePresentationHints(written.result, written.hints);
    expect(again.edits).toEqual([]);
    expect(again.result).toBe(written.result);
  });

  it('touches only the block that changes', () => {
    const changed = structuredClone(written.hints);
    changed.blocks.find((b) => b.blockId === visual)!.slides![0]!.points = ['Uno', 'Dos', 'Tres'];
    const next = writePresentationHints(written.result, changed);
    expect(next.edits).toHaveLength(1);
    expect(next.result).toBe(
      written.result.replace('- One\n- Two\n- Three', '- Uno\n- Dos\n- Tres'),
    );
  });

  it('removes a slide’s block with what is under it, at the end of the document too', () => {
    const fewer = structuredClone(written.hints);
    fewer.blocks = fewer.blocks.filter((b) => b.blockId !== voice);
    const next = writePresentationHints(written.result, fewer);
    expect(next.result.endsWith('Turn the same document into a narrated video.\n')).toBe(true);
    expect(next.result).not.toContain('hidden=true');
    const none = writePresentationHints(next.result, {
      ...fewer,
      blocks: fewer.blocks.map(({ slides: _slides, ...rest }) => rest),
    });
    expect(none.result).not.toContain('{[summary');
    expect(none.result).toContain(
      'Write a few bullet points. Build a document with a clear story.\n\n## Make it visual',
    );
  });

  it('resets to the automatic design, invalid summaries included', () => {
    const messy = `${written.result}\n### Typo {[summary layout=poster]}\n`;
    const reset = resetPresentationHints(messy);
    expect(reset.result).toBe(STORY);
    expect(read(reset.result).format).toBe('none');
  });

  it('removes chosen summary blocks', () => {
    const removed = removeSummaryBlocks(written.result, [`${voice}~summary`]);
    expect(removed.result).not.toContain('hidden=true');
    expect(removed.result).toContain('Suggested by AI');
  });
});

describe('where summaries go', () => {
  it('after the section’s own text, at its first sub-section’s depth', () => {
    const md = ['## Plan', '', 'Text.', '', '#### Deep child', '', 'More.', ''].join('\n');
    const out = writePresentationHints(md, {
      ...defaultPresentationHints(),
      blocks: [{ blockId: 'plan', slides: [{ headline: 'Mine' }] }],
    }).result;
    expect(out).toBe(
      [
        '## Plan',
        '',
        'Text.',
        '',
        '#### Mine {[summary]}',
        '',
        '#### Deep child',
        '',
        'More.',
        '',
      ].join('\n'),
    );
    expect(read(out).hints.blocks).toEqual([{ blockId: 'plan', slides: [{ headline: 'Mine' }] }]);
  });

  it('keeps the opening slide’s summary first and adds the rest after', () => {
    const long = [
      '# Plan',
      '',
      'Each slide should carry one idea that the narration explains in more depth. '.repeat(8),
      '',
    ].join('\n');
    const follows = { ...defaultPresentationHints(), density: 'balanced' as const };
    const longPlan = createPresentationPlan(parse(long), follows);
    const first = writePresentationHints(long, {
      ...follows,
      blocks: [{ blockId: 'plan', slides: [{ passage: keyOf(longPlan, 2), hidden: true }] }],
    });
    const second = writePresentationHints(first.result, {
      ...first.hints,
      blocks: [
        {
          blockId: 'plan',
          slides: [...first.hints.blocks[0]!.slides!, { headline: 'Opening words' }],
        },
      ],
    });
    const headings = second.result.split('\n').filter((line) => line.startsWith('##'));
    expect(headings[0]).toBe('## Opening words {[summary]}');
    expect(headings[1]).toContain('hidden=true');
  });

  it('puts the text before the first heading’s summaries at the top', () => {
    const md = 'An introduction.\n\n## First\n\nText.\n';
    const out = writePresentationHints(md, {
      ...defaultPresentationHints(),
      blocks: [{ blockId: 'preamble', slides: [{ headline: 'Intro' }] }],
    });
    expect(out.result).toBe('An introduction.\n\n## Intro {[summary]}\n\n## First\n\nText.\n');
    expect(out.hints.blocks).toEqual([{ blockId: 'preamble', slides: [{ headline: 'Intro' }] }]);
  });

  it('names the owner where a summary cannot nest under it', () => {
    const md = '##### Five\n\nText.\n\n###### Six\n\nDeep text.\n';
    const six = writePresentationHints(md, {
      ...defaultPresentationHints(),
      blocks: [{ blockId: 'six', slides: [{ headline: 'Deepest' }] }],
    });
    expect(six.result).toContain('###### Deepest {[summary of=six]}');
    expect(six.hints.blocks).toEqual([{ blockId: 'six', slides: [{ headline: 'Deepest' }] }]);
    expect(realIds(six.result)).toEqual(realIds(md));
  });

  it('names a standalone section as its owner, after the section around it', () => {
    const md = [
      '## Story',
      '',
      'Opening.',
      '',
      '{[quote]}',
      '',
      'Words worth keeping.',
      '',
      '## Next',
      '',
    ].join('\n');
    const quote = flattenContentBlocks(parse(md).blocks).find((b) => b.standaloneAnnotation)!.id;
    const out = writePresentationHints(md, {
      ...defaultPresentationHints(),
      blocks: [{ blockId: quote, slides: [{ headline: 'Her words' }] }],
    });
    expect(out.rejected).toEqual([]);
    expect(out.result).toContain(`### Her words {[summary of=${quote}]}`);
    expect(narration(out.result)).toBe(narration(md));
    expect(realIds(out.result)).toEqual(realIds(md));
  });
});

describe('what cannot be written', () => {
  it('leaves out a headline markdown would read as settings, and writes the rest', () => {
    const out = writePresentationHints(STORY, {
      ...defaultPresentationHints(),
      blocks: [
        { blockId: start!, slides: [{ headline: 'Ends in {braces}' }] },
        { blockId: visual!, slides: [{ headline: 'Fine' }] },
      ],
    });
    expect(out.rejected.map((issue) => [issue.code, issue.blockId])).toEqual([
      ['summary-invalid', start],
    ]);
    expect(out.hints.blocks).toEqual([{ blockId: visual, slides: [{ headline: 'Fine' }] }]);
  });

  it('cannot put settings on a setext heading or the text before the first heading', () => {
    const md = 'Intro.\n\nTitle\n=====\n\nText.\n';
    const out = writePresentationHints(md, {
      ...defaultPresentationHints(),
      blocks: [
        { blockId: 'preamble', layout: 'statement' },
        { blockId: 'title', layout: 'cards' },
      ],
    });
    expect(out.rejected.map((issue) => issue.blockId)).toEqual(['preamble', 'title']);
    expect(out.result).toBe(md);
  });
});

describe('settings', () => {
  it('replaces a Pandoc setting, which would win over the tag', () => {
    const md = '## A {slideLayout=cards}\n\nText.\n';
    const out = writePresentationHints(md, {
      ...defaultPresentationHints(),
      blocks: [{ blockId: 'a', layout: 'statement' }],
    });
    expect(out.result).toBe('## A {[slideLayout=statement]}\n\nText.\n');
  });

  it('keeps line endings', () => {
    const md = STORY.replace(/\n/g, '\r\n');
    const out = writePresentationHints(md, DESIGN);
    expect(out.result.replace(/\r\n/g, '')).not.toContain('\n');
    expect(presentationHintsEqual(out.hints, DESIGN)).toBe(true);
  });
});

describe('converting a legacy design', () => {
  it('keeps the deck exactly as it was', () => {
    const sections = presentationSections(parse(STORY));
    const legacy: PresentationHints = {
      ...defaultPresentationHints(),
      blocks: [
        {
          blockId: sections[0]!.blockId,
          wording: { source: sections[0]!.text, headline: 'A legacy headline', points: [] },
        },
        {
          blockId: sections[1]!.blockId,
          layout: 'cards',
          build: { mode: 'items' },
          ai: [
            {
              source: plan.sourceText.slice(plan.beats[1]!.sourceStart, plan.beats[1]!.sourceEnd),
              layout: 'statement',
              headline: 'An AI headline',
              points: ['An AI point'],
            },
          ],
        },
        { blockId: sections[2]!.blockId, hidden: [keyOf(plan, 2)] },
      ],
    };
    const md = [
      '---',
      `squisq-transform: ${DYNAMIC_PRESENTATION_STYLE}`,
      `${PRESENTATION_HINTS_KEY}: ${serializePresentationHints(legacy)}`,
      '---',
      STORY,
    ].join('\n');
    const doc = parse(md);
    const before = createPresentationPlan(doc, readPresentationHints(doc).hints);
    const converted = presentationHintsForPlan(doc, readPresentationHints(doc).hints, before);
    const out = writePresentationHints(md, converted);
    expect(out.rejected).toEqual([]);
    expect(out.result).not.toContain(PRESENTATION_HINTS_KEY);
    expect(out.result).toContain('## Make it visual {[slideLayout=cards build=items]}');
    expect(out.result).toContain('## A legacy headline {[summary points=none]}');
    const after = parse(out.result);
    expect(readPresentationHints(after).format).toBe('blocks');
    expect(createPresentationPlan(after, readPresentationHints(after).hints)).toEqual(before);
  });
});
