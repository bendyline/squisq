/**
 * Rolled-up blocks: in a Custom summary, `slideLayout=feature` on a block that
 * draws a picture (a chart, a table, a diagram) shows that block on the last
 * slide of the section before it instead of on a slide of its own, while its
 * text is still narrated.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { coerceAnnotationValues } from '../markdown/annotationCoercion.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { FEATURE_BLOCK_TEMPLATES, isFeatureBlockTemplate } from '../doc/templates/templateNames.js';
import {
  createPresentationPlan,
  createPresentationPlanReport,
} from '../transform/presentationPlanner.js';
import { compilePresentationPlan } from '../transform/presentationCompiler.js';
import { collectPresentationMedia } from '../transform/presentationMedia.js';
import { presentationSlidesToWord } from '../transform/presentationAuthor.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';
import { validateMarkdownSource } from '../doc/validate.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import type { Doc } from '../schemas/Doc.js';
import type { DocBlock } from '../schemas/BlockTemplates.js';
import {
  FEATURE_PRESENTATION_LAYOUT,
  isPresentationBeatLayout,
  isSummaryPresentationLayout,
  presentationBeatIsSlide,
  presentationBeatIsWorded,
  parsePresentationPlan,
  type PresentationBeat,
  type PresentationPlan,
} from '../transform/presentationPlan.js';
import {
  defaultPresentationHints,
  parsePresentationHints,
  presentationPassageKey,
  type PresentationHints,
} from '../transform/presentationHints.js';
import { readPresentationHints } from '../transform/presentationHintsDoc.js';
import { writePresentationHints } from '../transform/presentationHintsSource.js';

const parse = (text: string) => markdownToDoc(parseMarkdown(text));

const REPORT = [
  '# Results',
  '',
  'Revenue grew 40% last year. Most of it came from new customers.',
  '',
  '## By region {[barChart]}',
  '',
  'North led every quarter.',
  '',
  '| Region | Sales |',
  '| --- | --- |',
  '| North | 40 |',
  '| South | 25 |',
  '',
  '## Terms',
  '',
  'Payment is due in thirty days.',
  '',
].join('\n');

describe('the feature layout', () => {
  it('is a section layout, not a summary layout', () => {
    expect(isPresentationBeatLayout(FEATURE_PRESENTATION_LAYOUT)).toBe(true);
    expect(isSummaryPresentationLayout(FEATURE_PRESENTATION_LAYOUT)).toBe(false);
    expect(isSummaryPresentationLayout('authored')).toBe(false);
    expect(isSummaryPresentationLayout('cards')).toBe(true);
  });

  it('is a setting on a heading, and in a design', () => {
    expect(coerceAnnotationValues({ slideLayout: 'feature' }).blockMeta).toEqual({
      slideLayout: 'feature',
    });
    expect(
      parsePresentationHints({
        version: 1,
        density: 'balanced',
        inbetweens: true,
        blocks: [{ blockId: 'by-region', layout: 'feature' }],
      })?.blocks,
    ).toEqual([{ blockId: 'by-region', layout: 'feature' }]);
  });

  it('round-trips through the document', () => {
    const written = writePresentationHints(REPORT, {
      version: 1,
      density: 'balanced',
      inbetweens: true,
      blocks: [{ blockId: 'by-region', layout: 'feature' }],
    });
    expect(written.rejected).toEqual([]);
    expect(written.result).toContain('## By region {[barChart slideLayout=feature]}');
    expect(readPresentationHints(parse(written.result)).hints.blocks).toEqual([
      { blockId: 'by-region', layout: 'feature' },
    ]);
  });

  it('applies to blocks that draw a picture', () => {
    for (const name of ['barChart', 'pieChart', 'dataTable', 'diagram', 'tree', 'timeline'])
      expect(isFeatureBlockTemplate(name), name).toBe(true);
    for (const name of ['sectionHeader', 'quote', 'cards', 'list', 'statHighlight'])
      expect(isFeatureBlockTemplate(name), name).toBe(false);
    expect(isFeatureBlockTemplate('diagramBlock')).toBe(true);
    expect(FEATURE_BLOCK_TEMPLATES.has('diagram')).toBe(true);
  });

  it('says which beats are slides and which are worded', () => {
    expect(presentationBeatIsSlide({ layout: 'cards' })).toBe(true);
    expect(presentationBeatIsSlide({ layout: 'authored' })).toBe(true);
    expect(presentationBeatIsSlide({ layout: 'feature' })).toBe(false);
    expect(presentationBeatIsSlide({ layout: 'cards', hidden: true })).toBe(false);
    expect(presentationBeatIsWorded({ layout: 'cards' })).toBe(true);
    expect(presentationBeatIsWorded({ layout: 'authored' })).toBe(false);
    expect(presentationBeatIsWorded({ layout: 'feature' })).toBe(false);
  });
});

const ROLLED = REPORT.replace('{[barChart]}', '{[barChart slideLayout=feature]}');
const plainOf = (text: string) => {
  const doc = parse(text);
  return { doc, hints: readPresentationHints(doc).hints };
};
const report = (text: string) => {
  const { doc, hints } = plainOf(text);
  return createPresentationPlanReport(doc, hints);
};
const keysOf = (plan: PresentationPlan) =>
  plan.beats.map((beat) =>
    presentationPassageKey(plan.sourceText.slice(beat.sourceStart, beat.sourceEnd)),
  );
const LONG_RESULTS = REPORT.replace(
  'Revenue grew 40% last year. Most of it came from new customers.',
  'Each slide should carry one idea that the narration explains in more depth. '.repeat(8),
);
/** A document whose slides follow the text: a long section makes several, and a picture one of its own. */
const FOLLOWS = '---\nsquisq-summary-density: balanced\n---\n\n';
const follows = (text: string) =>
  createPresentationPlan(parse(FOLLOWS + text), {
    ...defaultPresentationHints(),
    density: 'balanced',
  });

describe('a block shown on the slide before it', () => {
  it('rides on the slide of the section before it and makes no slide of its own', () => {
    const { plan, rollups } = report(ROLLED);
    const results = plan.beats[0]!;
    const chart = plan.beats[1]!;
    expect(results.media).toEqual(['results#block-0']);
    expect(chart).toMatchObject({ layout: 'feature', headline: 'By region', points: [] });
    expect(rollups).toEqual([
      { blockId: 'by-region', ownerId: 'results', beatId: chart.id, carrierBeatId: results.id },
    ]);
    expect(presentationSlidesToWord(plan)).not.toContain(1);
  });

  it('changes nothing narrated, and switching it off restores the deck', () => {
    const before = createPresentationPlan(parse(REPORT));
    const { plan } = report(ROLLED);
    const authored = report(REPORT.replace('{[barChart]}', '{[barChart slideLayout=authored]}'));
    expect(plan.sourceText).toBe(before.sourceText);
    expect(authored.plan.sourceText).toBe(before.sourceText);
    expect(keysOf(plan)).toEqual(keysOf(authored.plan));
    expect(createPresentationPlan(parse(REPORT))).toEqual(before);
  });

  it('goes on the last slide only, leaving the section’s other slides as they are', () => {
    const { plan } = report(
      FOLLOWS + LONG_RESULTS.replace('{[barChart]}', '{[barChart slideLayout=feature]}'),
    );
    const owner = plan.beats.filter((beat) => beat.layout !== 'feature');
    const chartIndex = plan.beats.findIndex((beat) => beat.layout === 'feature');
    const carriers = plan.beats.filter((beat) => beat.media?.includes('results#block-0'));
    expect(carriers).toEqual([plan.beats[chartIndex - 1]]);
    expect(owner.length).toBeGreaterThan(3);
    const without = follows(LONG_RESULTS);
    for (const [index, beat] of without.beats.slice(0, chartIndex - 1).entries())
      expect(plan.beats[index], `slide ${index + 1}`).toEqual(beat);
  });

  it('puts several in a row on the same slide, in document order', () => {
    const two = ROLLED.replace(
      '## Terms',
      '## Share {[pieChart slideLayout=feature]}\n\n| Region | Share |\n| --- | --- |\n| North | 60 |\n| South | 40 |\n\n## Terms',
    );
    const { plan, rollups } = report(two);
    expect(plan.beats[0]!.media).toEqual(['results#block-0', 'results#block-1']);
    expect(plan.beats.slice(1, 3).map((beat) => beat.layout)).toEqual(['feature', 'feature']);
    expect(rollups.map((rollup) => rollup.carrierBeatId)).toEqual(['beat-1', 'beat-1']);
  });

  it('turns a picture slide that would carry it into a text slide, the picture beside it', () => {
    const withPicture = [
      '# Intro',
      '',
      'Opening words for the report.',
      '',
      '## Results',
      '',
      'Revenue grew 40% last year. Most of it came from new customers.',
      '',
      '![A map of the regions](images/map.png)',
      '',
      '## By region {[barChart slideLayout=feature]}',
      '',
      '| Region | Sales |',
      '| --- | --- |',
      '| North | 40 |',
    ].join('\n');
    const before = follows(withPicture.replace(' slideLayout=feature', ''));
    expect(before.beats[1]!.layout).toBe('image');
    const { plan } = report(FOLLOWS + withPicture);
    expect(plan.beats[1]!.layout).not.toBe('image');
    expect(plan.beats[1]!.imageSrc).toBeUndefined();
    expect(plan.beats[1]!.media).toEqual(['results#block-0', 'results#image-0']);
    // The picture moves with the block to that slide alone, even when the
    // section has other slides to share its pictures out to.
    const longer = withPicture.replace(
      'Revenue grew 40% last year. Most of it came from new customers.',
      'Revenue grew 40% last year. Most of it came from new customers. '.repeat(6),
    );
    const shared = report(longer).plan.beats.filter((beat) =>
      beat.media?.includes('results#image-0'),
    );
    expect(shared.map((beat) => beat.media)).toEqual([['results#block-0', 'results#image-0']]);
  });

  it('has a slide of its own, exactly as authored, when it cannot be carried, and says why', () => {
    const authored = (text: string) =>
      createPresentationPlan(...(Object.values(plainOf(text)) as [Doc, PresentationHints]));
    const cases: Array<[string, string, string]> = [
      [
        'not-eligible',
        REPORT.replace('## By region {[barChart]}', '## By region {[quote slideLayout=feature]}'),
        REPORT.replace('## By region {[barChart]}', '## By region {[quote slideLayout=authored]}'),
      ],
      [
        'no-section-before',
        REPORT.replace(
          '# Results\n\nRevenue grew 40% last year. Most of it came from new customers.\n\n',
          '',
        ).replace('{[barChart]}', '{[barChart slideLayout=feature]}'),
        REPORT.replace(
          '# Results\n\nRevenue grew 40% last year. Most of it came from new customers.\n\n',
          '',
        ).replace('{[barChart]}', '{[barChart slideLayout=authored]}'),
      ],
      [
        'section-before-authored',
        ROLLED.replace('# Results', '# Results {[slideLayout=authored]}'),
        REPORT.replace('# Results', '# Results {[slideLayout=authored]}').replace(
          '{[barChart]}',
          '{[barChart slideLayout=authored]}',
        ),
      ],
    ];
    for (const [problem, rolled, asAuthored] of cases) {
      const result = report(rolled);
      expect(
        result.rollups.map((rollup) => rollup.problem),
        problem,
      ).toEqual([problem]);
      expect(result.plan, problem).toEqual(authored(asAuthored));
    }
  });

  it('has a slide of its own when every slide of the section before it is hidden', () => {
    const plain = createPresentationPlan(parse(REPORT));
    const hiding = (text: string) =>
      text.replace(
        '## By region',
        `## Results summary {[summary passage=${keysOf(plain)[0]} hidden=true]}\n\n## By region`,
      );
    const rolled = report(hiding(ROLLED));
    expect(rolled.rollups[0]!.problem).toBe('section-before-hidden');
    expect(rolled.plan).toEqual(
      report(hiding(REPORT.replace('{[barChart]}', '{[barChart slideLayout=authored]}'))).plan,
    );
  });

  it('never takes AI wording or a hidden flag meant for a slide of its own', () => {
    const plain = createPresentationPlan(parse(REPORT));
    const chartKey = keysOf(plain)[1]!;
    const designed = ROLLED.replace(
      '## Terms',
      `### Its own words {[summary passage=${chartKey} origin=ai layout=statement]}\n\n### Hide it {[summary passage=${chartKey} hidden=true]}\n\n## Terms`,
    );
    const chart = report(designed).plan.beats[1]!;
    expect(chart.layout).toBe('feature');
    expect(chart.hidden).toBeUndefined();
  });
});

describe('a deck carrying a block', () => {
  it('draws the block on the carrying slide, which stays up while its text is read', () => {
    const { doc, hints } = plainOf(ROLLED);
    const plan = createPresentationPlan(doc, hints);
    const deck = compilePresentationPlan(doc, plan);
    expect(deck.blocks.map((block) => block.id)).toEqual(['beat-1', 'beat-3']);
    const carrier = deck.blocks[0]!;
    expect(carrier.template).toBe('bottomFeature');
    expect(carrier.featureBlocks?.map((block) => [block.id, block.template])).toEqual([
      ['by-region', 'barChart'],
    ]);
    // On screen from the start until the next section's slide.
    expect(carrier.startTime + carrier.duration).toBeCloseTo(deck.blocks[1]!.startTime);
    const slides = buildPreviewDoc(
      parse(`---\nsquisq-transform: dynamic-slides\n---\n${ROLLED}`),
    ).blocks;
    expect(slides.map((slide) => slide.id)).toEqual(['beat-1', 'beat-3']);
    const layers = materializeBlockLayers(slides[0] as unknown as DocBlock).layers;
    expect(layers.some((layer) => layer.id.startsWith('beat-1-feature-1-'))).toBe(true);
  });

  it('keeps a saved plan honest', () => {
    const { plan } = report(ROLLED);
    const chart = plan.beats[1]!;
    const tamper = (beat: Partial<PresentationBeat>, index = 1) => ({
      ...plan,
      beats: plan.beats.map((item, at) => (at === index ? { ...item, ...beat } : item)),
    });
    expect(parsePresentationPlan(plan)).toEqual(plan);
    expect(parsePresentationPlan(tamper({ points: ['A point'] }))).toBeNull();
    expect(parsePresentationPlan(tamper({ media: ['results#0'] }))).toBeNull();
    expect(parsePresentationPlan(tamper({ hidden: true }))).toBeNull();
    expect(
      parsePresentationPlan({
        ...plan,
        beats: [{ ...plan.beats[0]!, layout: 'feature', points: [] }, chart],
      }),
    ).toBeNull();
  });

  it('collects the block as one feature of the section before it', () => {
    const doc = parse(ROLLED);
    const media = collectPresentationMedia(
      doc,
      ['results', 'by-region', 'terms'],
      new Set(['by-region']),
    );
    expect([...media.keys()]).toEqual(['results']);
    expect(media.get('results')!.map((item) => [item.ref, item.kind])).toEqual([
      ['results#block-0', 'block'],
    ]);
    // Without a roll-up its table is the chart section's own, as before.
    expect(
      collectPresentationMedia(doc, ['results', 'by-region', 'terms'])
        .get('by-region')!
        .map((item) => item.ref),
    ).toEqual(['by-region#table-0']);
  });
});

describe('validating a block shown on the slide before it', () => {
  const codes = (text: string) =>
    validateMarkdownSource(text).diagnostics.map((diagnostic) => diagnostic.code);

  it('warns when the block cannot be drawn there, naming its line', () => {
    const quote = REPORT.replace('{[barChart]}', '{[quote slideLayout=feature]}');
    const found = validateMarkdownSource(quote).diagnostics.find(
      (diagnostic) => diagnostic.code === 'slide-layout-feature-unsupported',
    );
    expect(found).toMatchObject({ severity: 'warning', blockId: 'by-region' });
    expect(found?.message).toContain('"quote"');
    expect(found?.line).toBe(
      quote.split('\n').indexOf('## By region {[quote slideLayout=feature]}') + 1,
    );
  });

  it('says nothing for a block that can be, or for other layouts', () => {
    expect(codes(ROLLED)).not.toContain('slide-layout-feature-unsupported');
    expect(codes(REPORT.replace('{[barChart]}', '{[quote slideLayout=authored]}'))).not.toContain(
      'slide-layout-feature-unsupported',
    );
  });
});
