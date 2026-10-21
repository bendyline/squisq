import { describe, expect, it } from 'vitest';
import type { MarkdownBlockNode, MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc, Transition } from '@bendyline/squisq/schemas';
import { THEMES, TRANSITION_TYPES, VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  buildPreviewDoc,
  expandDocBlocks,
  flattenRenderableBlocks,
  markdownToDoc,
  resolvePersistentLayers,
  resolveThemeForDoc,
} from '@bendyline/squisq/doc';
import { docToPptx, markdownDocToPptx } from '../pptx/export';
import { openPackage, getPartRelationships, getPartXml } from '../ooxml/reader';
import { NS_DRAWINGML, NS_PML, NS_PML_2010, NS_R } from '../ooxml/namespaces';

function docWithSecondSlideTransition(transition: Transition): MarkdownDocument {
  return {
    type: 'document',
    children: [
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'One' }],
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Intro' }],
      },
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'Two' }],
        attributes: {
          params: {
            transition: transition.type,
            ...(transition.duration !== undefined
              ? { transitionDuration: String(transition.duration) }
              : {}),
            ...(transition.direction ? { transitionDirection: transition.direction } : {}),
          },
          blockMeta: { transition },
        },
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Body' }],
      },
    ],
  };
}

function docWithAllTransitions(): MarkdownDocument {
  const children: MarkdownBlockNode[] = [
    {
      type: 'heading',
      depth: 2,
      children: [{ type: 'text', value: 'Transition Gallery' }],
    },
    {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Intro slide before transition checks.' }],
    },
  ];

  for (const type of TRANSITION_TYPES) {
    const transition: Transition = { type, duration: 0.8 };
    children.push(
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: type }],
        attributes: {
          params: { transition: type, transitionDuration: '0.8' },
          blockMeta: { transition },
        },
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: `Transition token: ${type}` }],
      },
    );
  }

  return { type: 'document', children };
}

describe('markdownDocToPptx transitions', () => {
  it('writes valid transition XML for every shared transition token', async () => {
    const pkg = await openPackage(await markdownDocToPptx(docWithAllTransitions()));

    for (let i = 0; i < TRANSITION_TYPES.length; i++) {
      const type = TRANSITION_TYPES[i];
      const slide = await getPartXml(pkg, `ppt/slides/slide${i + 2}.xml`);
      expect(slide, type).not.toBeNull();

      const transitions = slide!.getElementsByTagNameNS(NS_PML, 'transition');
      if (type === 'cut') {
        expect(transitions, type).toHaveLength(0);
        continue;
      }

      expect(transitions, type).toHaveLength(1);
      expect(transitions[0].getAttribute('spd'), type).toBe('med');

      const childElements = Array.from(transitions[0].childNodes).filter(
        (node): node is Element => node.nodeType === 1,
      );
      expect(childElements, type).toHaveLength(1);
      expect([NS_PML, NS_PML_2010], type).toContain(childElements[0].namespaceURI);

      if (childElements[0].namespaceURI === NS_PML_2010) {
        expect(slide!.documentElement.getAttribute('mc:Ignorable'), type).toContain('p14');
      }
    }
  });

  it('writes standard PresentationML transition XML', async () => {
    const md = docWithSecondSlideTransition({
      type: 'checkerboard',
      duration: 1.3,
      direction: 'vertical',
    });

    const pkg = await openPackage(await markdownDocToPptx(md));
    const slide = await getPartXml(pkg, 'ppt/slides/slide2.xml');
    const transition = slide!.getElementsByTagNameNS(NS_PML, 'transition')[0];
    const checker = transition.getElementsByTagNameNS(NS_PML, 'checker')[0];

    expect(transition.getAttribute('spd')).toBe('slow');
    expect(checker.getAttribute('dir')).toBe('vert');
  });

  it('writes PowerPoint 2010 transition XML when needed', async () => {
    const md = docWithSecondSlideTransition({ type: 'flash', duration: 0.4 });

    const pkg = await openPackage(await markdownDocToPptx(md));
    const slide = await getPartXml(pkg, 'ppt/slides/slide2.xml');
    const transition = slide!.getElementsByTagNameNS(NS_PML, 'transition')[0];
    const flash = transition.getElementsByTagNameNS(NS_PML_2010, 'flash')[0];

    expect(transition.getAttribute('spd')).toBe('fast');
    expect(flash).toBeDefined();
    expect(slide!.documentElement.getAttribute('mc:Ignorable')).toBe('p14');
  });
});

describe('markdownDocToPptx thematic breaks', () => {
  it('drops thematic breaks used redundantly before slide headings and reports them', async () => {
    const warnings: string[] = [];
    const source: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'One' }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'First body' }],
        },
        { type: 'thematicBreak' },
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'Two' }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Second body' }],
        },
      ],
    };

    const pkg = await openPackage(
      await markdownDocToPptx(source, {
        slideBreak: 'h1',
        onWarning: (message) => warnings.push(message),
      }),
    );
    const firstSlide = await getPartXml(pkg, 'ppt/slides/slide1.xml');
    const secondSlide = await getPartXml(pkg, 'ppt/slides/slide2.xml');

    expect(firstSlide?.documentElement.textContent).not.toContain('─');
    expect(secondSlide).not.toBeNull();
    expect(warnings).toEqual([
      'PPTX export removed 1 redundant thematic break(s) immediately before slide headings. ' +
        'A heading already starts the next slide; omit --- unless a visible horizontal rule is intended.',
    ]);
  });

  it('renders an intentional mid-slide thematic break as an unbulleted visual rule', async () => {
    const source: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'One' }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Before' }],
        },
        { type: 'thematicBreak' },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'After' }],
        },
      ],
    };

    const pkg = await openPackage(await markdownDocToPptx(source, { slideBreak: 'h1' }));
    const slide = await getPartXml(pkg, 'ppt/slides/slide1.xml');
    const rule = Array.from(slide!.getElementsByTagNameNS(NS_DRAWINGML, 'p')).find((paragraph) =>
      paragraph.textContent?.includes('─'),
    );

    expect(rule).toBeDefined();
    expect(rule!.getElementsByTagNameNS(NS_DRAWINGML, 'buNone')).toHaveLength(1);
    expect(rule!.getElementsByTagNameNS(NS_DRAWINGML, 'buChar')).toHaveLength(0);
  });
});

// ============================================
// Relationship ID Allocation (regression)
// ============================================

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A deck of `count` H2-delimited slides. */
function deckOf(count: number): MarkdownDocument {
  const children: MarkdownBlockNode[] = [];
  for (let i = 0; i < count; i++) {
    children.push({
      type: 'heading',
      depth: 2,
      children: [{ type: 'text', value: `Slide ${i + 1}` }],
    });
    children.push({ type: 'paragraph', children: [{ type: 'text', value: `Body ${i + 1}` }] });
  }
  return { type: 'document', children };
}

async function relsOf(bytes: ArrayBuffer, path: string): Promise<Element[]> {
  const pkg = await openPackage(bytes);
  const xml = await getPartXml(pkg, path);
  expect(xml, `expected ${path} to exist`).toBeTruthy();
  return Array.from(xml!.getElementsByTagNameNS(REL_NS, 'Relationship'));
}

describe('PPTX relationship ID allocation', () => {
  const SLIDES = 120;

  it('emits unique relationship Ids in presentation.xml.rels for a 120-slide deck', async () => {
    const bytes = await markdownDocToPptx(deckOf(SLIDES));
    const rels = await relsOf(bytes, 'ppt/_rels/presentation.xml.rels');

    const ids = rels.map((r) => r.getAttribute('Id')!);
    // The real bug: slides used rId1..N while slideMaster/theme were hardcoded
    // to rId100/rId101, so a 100-slide deck emitted a duplicate rId100 and
    // PowerPoint rejected the file outright.
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);

    expect(rels.filter((r) => r.getAttribute('Type') === `${OFFICE_REL}/slide`)).toHaveLength(
      SLIDES,
    );
  });

  it('resolves the slideMaster and theme rels alongside 120 slide rels', async () => {
    const bytes = await markdownDocToPptx(deckOf(SLIDES));
    const rels = await relsOf(bytes, 'ppt/_rels/presentation.xml.rels');
    const byType = (t: string) =>
      rels.filter((r) => r.getAttribute('Type') === `${OFFICE_REL}/${t}`);

    const master = byType('slideMaster');
    expect(master).toHaveLength(1);
    expect(master[0]!.getAttribute('Target')).toBe('slideMasters/slideMaster1.xml');

    const theme = byType('theme');
    expect(theme).toHaveLength(1);
    expect(theme[0]!.getAttribute('Target')).toBe('theme/theme1.xml');

    // Neither may be shadowed by a slide rel sharing its Id.
    for (const rel of [...master, ...theme]) {
      const id = rel.getAttribute('Id');
      expect(rels.filter((r) => r.getAttribute('Id') === id)).toHaveLength(1);
    }
  });

  it('points presentation.xml sldMasterId/sldId at declared relationships', async () => {
    const bytes = await markdownDocToPptx(deckOf(SLIDES));
    const pkg = await openPackage(bytes);
    const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
    const declared = new Set(
      (await relsOf(bytes, 'ppt/_rels/presentation.xml.rels')).map((r) => r.getAttribute('Id')!),
    );

    const masterId = presentation!
      .getElementsByTagNameNS(NS_PML, 'sldMasterId')[0]!
      .getAttributeNS(OFFICE_REL, 'id');
    expect(masterId).toBeTruthy();
    expect(declared.has(masterId!)).toBe(true);

    const sldIds = Array.from(presentation!.getElementsByTagNameNS(NS_PML, 'sldId'));
    expect(sldIds).toHaveLength(SLIDES);
    const dangling = sldIds
      .map((el) => el.getAttributeNS(OFFICE_REL, 'id')!)
      .filter((id) => !declared.has(id));
    expect(dangling).toEqual([]);
  });

  it('keeps each slide part rels unique, layout included', async () => {
    const bytes = await markdownDocToPptx(deckOf(3));
    for (let i = 1; i <= 3; i++) {
      const rels = await relsOf(bytes, `ppt/slides/_rels/slide${i}.xml.rels`);
      const ids = rels.map((r) => r.getAttribute('Id')!);
      expect(new Set(ids).size).toBe(ids.length);
      expect(
        rels.filter((r) => r.getAttribute('Type') === `${OFFICE_REL}/slideLayout`),
      ).toHaveLength(1);
    }
  });
});

// ============================================
// Slideshow parity (Doc -> PPTX)
// ============================================

const SLIDESHOW_CORPUS: Doc[] = [
  {
    articleId: 'narrative-list',
    duration: 65,
    audio: {
      segments: [{ src: '', name: 'preview', duration: 65, startTime: 0 }],
    },
    startBlock: { title: 'Narrative List', subtitle: 'A managed cover' },
    blocks: [
      {
        id: 'opening',
        template: 'sectionHeader',
        title: 'Opening',
        startTime: 0,
        duration: 5,
        audioSegment: 0,
      },
      {
        id: 'long-list',
        template: 'list',
        title: 'Seven considerations',
        items: [
          'Scope and ownership',
          'Compatibility and upgrades',
          'Security boundaries',
          'Performance budgets',
          'Testing and observability',
          'Documentation freshness',
          'Release readiness',
        ],
        startTime: 5,
        duration: 60,
        audioSegment: 0,
      },
    ],
  } as unknown as Doc,
  {
    articleId: 'data-table',
    duration: 35,
    audio: {
      segments: [{ src: '', name: 'preview', duration: 35, startTime: 0 }],
    },
    blocks: [
      {
        id: 'table',
        template: 'dataTable',
        title: 'Risk register',
        headers: ['Risk', 'Likelihood', 'Mitigation'],
        rows: [
          ['Version drift', 'High', 'Pin and verify'],
          ['Flaky capture', 'Medium', 'Deterministic fixtures'],
          ['Scope growth', 'High', 'Vertical slices'],
        ],
        startTime: 0,
        duration: 35,
        audioSegment: 0,
      },
    ],
  } as unknown as Doc,
  {
    articleId: 'mixed-cards',
    duration: 30,
    audio: {
      segments: [{ src: '', name: 'preview', duration: 30, startTime: 0 }],
    },
    blocks: [
      {
        id: 'stat',
        template: 'statHighlight',
        stat: '42%',
        description: 'Representative metric',
        startTime: 0,
        duration: 15,
        audioSegment: 0,
      },
      {
        id: 'quote',
        template: 'quote',
        quote: 'A representative quotation.',
        attribution: 'Sample corpus',
        startTime: 15,
        duration: 15,
        audioSegment: 0,
      },
    ],
  } as unknown as Doc,
];

function expectedSlideshowSlideCount(doc: Doc, themeId: string): number {
  const theme = resolveThemeForDoc(doc, themeId);
  const blocks = expandDocBlocks(flattenRenderableBlocks(doc.blocks), {
    audioSegments: doc.audio.segments.map(({ startTime, duration }) => ({ startTime, duration })),
    viewport: VIEWPORT_PRESETS.landscape,
    persistentLayers: resolvePersistentLayers({ persistentLayers: doc.persistentLayers }, theme),
    theme,
    customTemplates: doc.customTemplates,
    // Mirror the discrete deck the exporter emits: the >20s pacing split re-shows
    // one authored slide as identical copies, which belong to timed video, not a
    // .pptx. Model the distinct authored slides the same way docToPptx does.
    splitLongBlocks: false,
  });
  return blocks.length + (doc.startBlock ? 1 : 0);
}

async function pptxSlideCount(bytes: ArrayBuffer): Promise<number> {
  const pkg = await openPackage(bytes);
  const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
  expect(presentation).not.toBeNull();
  return presentation!.getElementsByTagNameNS(NS_PML, 'sldId').length;
}

function namedShape(slide: Document, name: string): Element {
  const shape = Array.from(slide.getElementsByTagNameNS(NS_PML, 'sp')).find((candidate) =>
    Array.from(candidate.getElementsByTagNameNS(NS_PML, 'cNvPr')).some(
      (properties) => properties.getAttribute('name') === name,
    ),
  );
  expect(shape, `expected shape ${name}`).toBeDefined();
  return shape!;
}

describe('PPTX template text geometry', () => {
  it('reserves room beyond the CSS line box for title and subtitle text boxes', async () => {
    const doc = {
      articleId: 'display-type-metrics',
      duration: 5,
      audio: {
        segments: [{ src: '', name: 'preview', duration: 5, startTime: 0 }],
      },
      blocks: [
        {
          id: 'display-title',
          template: 'title',
          title: 'DocBlocks: one Markdown file, many finished forms',
          subtitle: 'Local-first writing for pages, documents, slideshows, and video',
          startTime: 0,
          duration: 5,
          audioSegment: 0,
        },
      ],
    } as unknown as Doc;

    const pkg = await openPackage(
      await docToPptx(doc, { themeId: 'warm-earth', includeCoverSlide: false }),
    );
    const slide = await getPartXml(pkg, 'ppt/slides/slide1.xml');
    expect(slide).not.toBeNull();

    for (const name of ['title', 'subtitle']) {
      const shape = namedShape(slide!, name);
      const extent = shape.getElementsByTagNameNS(NS_DRAWINGML, 'ext')[0];
      const runProperties = shape.getElementsByTagNameNS(NS_DRAWINGML, 'rPr')[0];
      const lineSpacing = shape.getElementsByTagNameNS(NS_DRAWINGML, 'spcPct')[0];
      expect(extent, `${name} extent`).toBeDefined();
      expect(runProperties, `${name} run properties`).toBeDefined();
      expect(lineSpacing, `${name} line spacing`).toBeDefined();

      // One canvas px is half a point, and `lnSpc` is a fraction of Office's
      // ~1.2em single spacing; Office's first ascent and last descent need
      // room past the CSS line box or a no-autofit box clips display type.
      const heightPx =
        (Number(extent!.getAttribute('cy')) / 6_858_000) * VIEWPORT_PRESETS.landscape.height;
      const fontSizePx = Number(runProperties!.getAttribute('sz')) / 50;
      const cssLineHeight = (Number(lineSpacing!.getAttribute('val')) / 100_000) * 1.2;
      expect(heightPx, `${name} height`).toBeGreaterThanOrEqual(
        fontSizePx * (cssLineHeight + 0.3) - 1,
      );
    }
  });
});

describe('docToPptx slideshow parity', () => {
  it('matches the player slide count across representative content and every built-in theme', async () => {
    for (const source of SLIDESHOW_CORPUS) {
      for (const themeId of Object.keys(THEMES)) {
        const doc = { ...source, themeId };
        const expected = expectedSlideshowSlideCount(doc, themeId);
        const actual = await pptxSlideCount(await docToPptx(doc, { themeId }));
        expect(actual, `${source.articleId} / ${themeId}`).toBe(expected);
      }
    }
  });

  it('keeps a long single block as one slide instead of repeated pacing copies', async () => {
    // Regression: a single content block whose scheduled duration exceeds the
    // ~20s pacing threshold used to be cloned into ceil(duration / 20) identical
    // slides (a long prose doc exported as ~18 duplicates). That split is timed-
    // video pacing; a .pptx must keep one authored slide as one slide.
    const longSingleBlock = {
      articleId: 'long-single-block',
      duration: 120,
      audio: { segments: [{ src: '', name: 'preview', duration: 120, startTime: 0 }] },
      blocks: [
        {
          id: 'essay',
          template: 'quote',
          quote: 'A single long passage that pacing would have spread across many slides.',
          attribution: 'Regression',
          startTime: 0,
          duration: 120,
          audioSegment: 0,
        },
      ],
    } as unknown as Doc;

    const count = await pptxSlideCount(
      await docToPptx(longSingleBlock, { themeId: 'documentary' }),
    );
    expect(count).toBe(1);
  });

  it('honors the managed-cover setting without changing expanded block parity', async () => {
    const doc = SLIDESHOW_CORPUS[0]!;
    const withCover = await pptxSlideCount(await docToPptx(doc, { themeId: 'documentary' }));
    const withoutCover = await pptxSlideCount(
      await docToPptx(doc, { themeId: 'documentary', includeCoverSlide: false }),
    );
    expect(withCover).toBe(withoutCover + 1);
  });

  it('uses the same 16:9 canvas as the landscape slideshow viewport', async () => {
    const bytes = await docToPptx(SLIDESHOW_CORPUS[2]!, { themeId: 'documentary' });
    const pkg = await openPackage(bytes);
    const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
    const size = presentation!.getElementsByTagNameNS(NS_PML, 'sldSz')[0]!;
    expect(size.getAttribute('cx')).toBe('12192000');
    expect(size.getAttribute('cy')).toBe('6858000');
    expect(size.getAttribute('type')).toBe('screen16x9');
  });

  it('exports the initial ten-row view of a scrollable data table', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => [
      index === 9 ? 'VISIBLE_TENTH_ROW' : index === 10 ? 'HIDDEN_ELEVENTH_ROW' : `Row ${index + 1}`,
      String(index + 1),
    ]);
    const doc = {
      articleId: 'large-table-window',
      duration: 5,
      audio: { segments: [{ src: '', name: 'preview', duration: 5, startTime: 0 }] },
      blocks: [
        {
          id: 'table',
          template: 'dataTable',
          title: 'Large table',
          headers: ['Name', 'Value'],
          rows,
          startTime: 0,
          duration: 5,
          audioSegment: 0,
        },
      ],
    } as unknown as Doc;

    const [slideText] = await pptxSlideTexts(await docToPptx(doc, { includeCoverSlide: false }));
    expect(slideText).toContain('VISIBLE_TENTH_ROW');
    expect(slideText).not.toContain('HIDDEN_ELEVENTH_ROW');
  });
});

// ============================================
// Markdown-authored parity
// ============================================

/** Concatenated `<a:t>` text of every slide, in slide order. */
async function pptxSlideTexts(bytes: ArrayBuffer): Promise<string[]> {
  const pkg = await openPackage(bytes);
  const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
  const count = presentation!.getElementsByTagNameNS(NS_PML, 'sldId').length;
  const texts: string[] = [];
  for (let index = 1; index <= count; index++) {
    const slide = await getPartXml(pkg, `ppt/slides/slide${index}.xml`);
    const runs = slide!.getElementsByTagNameNS(NS_DRAWINGML, 't');
    texts.push(Array.from(runs, (run) => run.textContent ?? '').join(' '));
  }
  return texts;
}

/** The slide sequence the player renders for the same markdown. */
function slideshowBlockCount(doc: Doc): number {
  const theme = resolveThemeForDoc(doc, doc.themeId);
  const projected = buildPreviewDoc(doc);
  return expandDocBlocks(flattenRenderableBlocks(projected.blocks), {
    viewport: VIEWPORT_PRESETS.landscape,
    persistentLayers: resolvePersistentLayers({ persistentLayers: doc.persistentLayers }, theme),
    theme,
    customTemplates: doc.customTemplates,
  }).length;
}

describe('docToPptx markdown-authored parity', () => {
  it('emits one slide per authored block when slides are deeper than H2', async () => {
    // Regression: the export ran the semantic Markdown path, which starts a new
    // slide only at H1/H2. A deck whose sampler slides are `###` headings lost
    // every one of them into the parent section — the About sample exported 17
    // slides where the slideshow showed 23 plus a cover.
    const markdown = [
      '# Deck {[title]}',
      '',
      'Opening prose.',
      '',
      '## Sampler {[sectionHeader]}',
      '',
      'Intro to the sampler.',
      '',
      '### Stat {[statHighlight stat="42%"]}',
      '',
      'A measured thing.',
      '',
      '### Quote {[quote]}',
      '',
      '> Something quotable.',
      '',
      '### Definition {[definitionCard]}',
      '',
      'A defined thing.',
      '',
      '## Close {[sectionHeader]}',
      '',
      'Wrapping up.',
    ].join('\n');

    const doc = markdownToDoc(parseMarkdown(markdown), { articleId: 'deep-headings' });
    const authored = flattenRenderableBlocks(doc.blocks).length;
    expect(authored).toBe(6);

    const count = await pptxSlideCount(await docToPptx(doc, { includeCoverSlide: false }));
    expect(count).toBe(authored);
    expect(count).toBe(slideshowBlockCount(doc));
  });

  it('keeps the managed cover as slide 1, matching the slideshow cover', async () => {
    const doc = markdownToDoc(
      parseMarkdown('# Deck {[title]}\n\nOpening prose.\n\n## Next\n\nMore.'),
      {
        articleId: 'cover-parity',
      },
    );
    expect(doc.startBlock).toBeDefined();
    const count = await pptxSlideCount(await docToPptx(doc));
    expect(count).toBe(slideshowBlockCount(doc) + 1);
  });

  it('keeps the body prose of headings that carry no template annotation', async () => {
    // The visual path renders an unannotated heading through `sectionHeader`,
    // which draws the heading alone. Running the doc through the slideshow
    // projection first promotes those blocks to `content` so the deck keeps the
    // prose the semantic exporter always preserved.
    const doc = markdownToDoc(
      parseMarkdown(
        '# Title\n\nOpening prose.\n\n## Section A\n\nBody of section A.\n\n- one\n- two',
      ),
      { articleId: 'unannotated', generateCoverBlock: false },
    );
    const texts = await pptxSlideTexts(await docToPptx(doc));
    expect(texts.join('\n')).toContain('Body of section A.');
    expect(texts.join('\n')).toContain('Opening prose.');
  });

  it('renders full-bleed quote text rather than an empty slide', async () => {
    // `fullBleedQuote` takes `text`, not `quote`. The projection used to emit
    // the wrong key, so the template's only text layer came out empty.
    const doc = markdownToDoc(
      parseMarkdown('## One Line {[fullBleedQuote]}\n\nSometimes a single line is enough.'),
      { articleId: 'full-bleed', generateCoverBlock: false },
    );
    const texts = await pptxSlideTexts(await docToPptx(doc));
    expect(texts.join('\n')).toContain('Sometimes a single line is enough.');
  });

  it('keeps every authored slide when the doc carries narration audio', async () => {
    // Narration pacing merges sub-5s blocks into their predecessor so timed
    // playback does not flash slides. A .pptx advances by click, so that merge
    // is pure content loss — `mergeShortBlocks: false` keeps the deck complete.
    const narrated = {
      articleId: 'narrated',
      duration: 30,
      audio: { segments: [{ src: 'audio/take.webm', name: 'take', duration: 30, startTime: 0 }] },
      blocks: Array.from({ length: 8 }, (_, index) => ({
        id: `beat-${index}`,
        template: 'quote',
        quote: `Beat ${index}`,
        startTime: index * 2,
        duration: 2,
        audioSegment: 0,
      })),
    } as unknown as Doc;

    const count = await pptxSlideCount(await docToPptx(narrated, { includeCoverSlide: false }));
    expect(count).toBe(8);
  });
});

// ============================================
// Native lists
// ============================================

interface ExportedParagraph {
  shape: string;
  text: string;
  bullet: 'char' | 'number' | null;
  level: number | null;
  startAt: string | null;
  size: string | null;
  /** `spcBef` in hundredths of a point, when the paragraph has it. */
  spaceBefore: number | null;
}

/** Every paragraph of one exported slide, with its shape name and bullet facts. */
async function slideParagraphs(bytes: ArrayBuffer, index = 1): Promise<ExportedParagraph[]> {
  const slide = await getPartXml(await openPackage(bytes), `ppt/slides/slide${index}.xml`);
  return Array.from(slide!.getElementsByTagNameNS(NS_PML, 'sp')).flatMap((shape) => {
    const name = shape.getElementsByTagNameNS(NS_PML, 'cNvPr')[0]?.getAttribute('name') ?? '';
    return Array.from(shape.getElementsByTagNameNS(NS_DRAWINGML, 'p'), (paragraph) => {
      const pPr = paragraph.getElementsByTagNameNS(NS_DRAWINGML, 'pPr')[0];
      const autoNum = paragraph.getElementsByTagNameNS(NS_DRAWINGML, 'buAutoNum')[0];
      const char = paragraph.getElementsByTagNameNS(NS_DRAWINGML, 'buChar')[0];
      return {
        shape: name,
        text: Array.from(
          paragraph.getElementsByTagNameNS(NS_DRAWINGML, 't'),
          (run) => run.textContent ?? '',
        ).join(''),
        bullet: autoNum ? ('number' as const) : char ? ('char' as const) : null,
        level: pPr?.hasAttribute('lvl') ? Number(pPr.getAttribute('lvl')) : null,
        startAt: autoNum?.getAttribute('startAt') ?? null,
        size: paragraph.getElementsByTagNameNS(NS_DRAWINGML, 'rPr')[0]?.getAttribute('sz') ?? null,
        spaceBefore: (() => {
          const points = paragraph
            .getElementsByTagNameNS(NS_DRAWINGML, 'spcBef')[0]
            ?.getElementsByTagNameNS(NS_DRAWINGML, 'spcPts')[0];
          return points ? Number(points.getAttribute('val')) : null;
        })(),
      };
    });
  });
}

describe('docToPptx native lists', () => {
  it('writes content-body list items as PowerPoint bullets, not bullet characters', async () => {
    // Regression: the content template's body reached PowerPoint as lines
    // beginning with a typed `• `, so they were not a list (no hanging
    // indent, no list formatting) once opened in an Office app.
    const doc = markdownToDoc(
      parseMarkdown(
        '## Local AI driven\n\nAn opening paragraph.\n\n- First\n  - Nested\n- Second\n\n3. Third\n4. Fourth',
      ),
      { articleId: 'content-bullets', generateCoverBlock: false },
    );
    const body = (await slideParagraphs(await docToPptx(doc, { includeCoverSlide: false }))).filter(
      (paragraph) => paragraph.shape === 'body',
    );

    expect(body.map(({ text, bullet, level, startAt }) => [text, bullet, level, startAt])).toEqual([
      ['An opening paragraph.', null, null, null],
      ['First', 'char', 0, null],
      ['Nested', 'char', 1, null],
      ['Second', 'char', 0, null],
      // Every item of a run that does not start at 1 repeats `startAt`:
      // PowerPoint starts a new run at any change in numbering attributes.
      ['Third', 'number', 0, '3'],
      ['Fourth', 'number', 0, '3'],
    ]);
    expect(body.some((paragraph) => /^\s*(•|\d+\.)\s/.test(paragraph.text))).toBe(false);

    // The blank line between blocks is the player's block margin, not an
    // empty paragraph: 0.4em after a paragraph, 0.7em after a list.
    const size = Number(body[0]!.size);
    const gaps = Object.fromEntries(body.map(({ text, spaceBefore }) => [text, spaceBefore]));
    expect(gaps.First).toBeCloseTo(size * 0.4, -1);
    expect(gaps.Third).toBeCloseTo(size * 0.7, -1);
    expect(gaps.Nested).toBeNull();
    expect(gaps.Fourth).toBeNull();
  });

  it('exports a list-template slide as one text box with uniform bullets', async () => {
    // Regression: the list template draws each item as a marker layer beside
    // a body layer (a hanging indent in SVG). Exported layer by layer that was
    // a separate shape per marker and per item, and each item shape shrank
    // its font on its own, so the items came out in different sizes.
    const doc = markdownToDoc(
      parseMarkdown(
        [
          '## Products {[list]}',
          '',
          '- Gezel - multi-agent platform and harness focused on making it easy to use local AI to its fullest. Gezel is a machine-level service that orchestrates agentic workloads, with app, CLI, and API',
          '- DocBlocks - content editor application that integrates local AI for content editing tasks.',
          '- Qualla - an attempt to tell more historical stories from all around the world.',
        ].join('\n'),
      ),
      { articleId: 'list-bullets', generateCoverBlock: false },
    );
    const paragraphs = await slideParagraphs(await docToPptx(doc, { includeCoverSlide: false }));

    expect(paragraphs.some((paragraph) => /^item-\d+/.test(paragraph.shape))).toBe(false);
    const items = paragraphs.filter((paragraph) => paragraph.shape === 'list-items');
    expect(items.map((item) => item.text.split(' - ')[0])).toEqual([
      'Gezel',
      'DocBlocks',
      'Qualla',
    ]);
    expect(items.every((item) => item.bullet === 'char' && item.level === 0)).toBe(true);
    expect(new Set(items.map((item) => item.size)).size).toBe(1);
  });

  it('numbers an ordered list-template slide with one auto-numbered run', async () => {
    const doc = markdownToDoc(parseMarkdown('## Steps {[list]}\n\n1. First\n2. Second\n3. Third'), {
      articleId: 'list-numbers',
      generateCoverBlock: false,
    });
    const items = (
      await slideParagraphs(await docToPptx(doc, { includeCoverSlide: false }))
    ).filter((paragraph) => paragraph.shape === 'list-items');
    expect(items.map(({ text, bullet, startAt }) => [text, bullet, startAt])).toEqual([
      ['First', 'number', null],
      ['Second', 'number', null],
      ['Third', 'number', null],
    ]);
  });
});

// ============================================
// Text size
// ============================================

/** The first player-ready slide's layers, as the exporter materializes them. */
function materializedSlide(doc: Doc) {
  const theme = resolveThemeForDoc(doc, doc.themeId);
  const projected = buildPreviewDoc(doc);
  const [block] = expandDocBlocks(flattenRenderableBlocks(projected.blocks), {
    viewport: VIEWPORT_PRESETS.landscape,
    persistentLayers: resolvePersistentLayers({ persistentLayers: doc.persistentLayers }, theme),
    theme,
    customTemplates: doc.customTemplates,
    splitLongBlocks: false,
    mergeShortBlocks: false,
  });
  return block!;
}

function nominalFontSize(doc: Doc, layerId: string): number {
  const layer = materializedSlide(doc).layers?.find((candidate) => candidate.id === layerId);
  if (layer?.type !== 'text') throw new Error(`no text layer ${layerId}`);
  return layer.content.style.fontSize;
}

describe('docToPptx text size', () => {
  it('exports text at the size the slideshow grows it to, one scale per slide', async () => {
    // The slideshow grows a slide's text to fill its boxes (up to 2x), so a
    // short body reads far larger than its template's base size. Exporting
    // the base size made such slides half the size of the slideshow.
    const doc = markdownToDoc(
      parseMarkdown('## Why local first\n\nA short body leaves the slide room to grow.'),
      { articleId: 'grown-text', generateCoverBlock: false },
    );
    const paragraphs = await slideParagraphs(await docToPptx(doc, { includeCoverSlide: false }));
    const exportedPx = (shape: string) =>
      Number(paragraphs.find((paragraph) => paragraph.shape === shape)!.size) / 50;

    expect(exportedPx('body')).toBeCloseTo(nominalFontSize(doc, 'body') * 2, 1);
    expect(exportedPx('title')).toBeCloseTo(nominalFontSize(doc, 'title') * 2, 1);
  });

  it('keeps geometry-bound slides at their authored size', async () => {
    // Charts, tables and diagrams label drawn geometry; the slideshow never
    // grows them, so neither does the export. One canvas px is half a point.
    const doc = markdownToDoc(
      parseMarkdown('## Numbers {[dataTable]}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'),
      { articleId: 'table-size', generateCoverBlock: false },
    );
    const block = materializedSlide(doc);
    const title = block.layers?.find((layer) => layer.type === 'text');
    if (title?.type !== 'text') throw new Error('no title layer');
    const paragraphs = await slideParagraphs(await docToPptx(doc, { includeCoverSlide: false }));
    expect(Number(paragraphs.find((paragraph) => paragraph.shape === title.id)!.size)).toBe(
      Math.round(title.content.style.fontSize * 50),
    );
  });

  it('writes stroke and border widths in canvas px', async () => {
    // A canvas px is 6350 EMU (12192000 EMU across 1920px); 9525 is a CSS px
    // at 96dpi, which drew every line half again too thick.
    const doc = markdownToDoc(
      parseMarkdown('## Numbers {[dataTable]}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'),
      { articleId: 'stroke-width', generateCoverBlock: false },
    );
    const slide = await getPartXml(
      await openPackage(await docToPptx(doc, { includeCoverSlide: false })),
      'ppt/slides/slide1.xml',
    );
    const cell = namedShape(slide!, 'table-0-0');
    const line = cell.getElementsByTagNameNS(NS_DRAWINGML, 'ln')[0];
    expect(line?.getAttribute('w')).toBe('6350');
  });
});

// ============================================
// Backgrounds, layouts and the master
// ============================================

/** Every shape or picture on a slide that covers the whole slide. */
function fullSlideShapes(slide: Document): string[] {
  return ['sp', 'pic'].flatMap((tag) =>
    Array.from(slide.getElementsByTagNameNS(NS_PML, tag))
      .filter((shape) => {
        const off = shape.getElementsByTagNameNS(NS_DRAWINGML, 'off')[0];
        const ext = shape.getElementsByTagNameNS(NS_DRAWINGML, 'ext')[0];
        return (
          off?.getAttribute('x') === '0' &&
          off?.getAttribute('y') === '0' &&
          ext?.getAttribute('cx') === '12192000' &&
          ext?.getAttribute('cy') === '6858000'
        );
      })
      .map((shape) => shape.getElementsByTagNameNS(NS_PML, 'cNvPr')[0]?.getAttribute('name') ?? ''),
  );
}

describe('docToPptx backgrounds', () => {
  it('puts background paint on the master and layouts, never as a shape on a slide', async () => {
    // Regression: every template's full-bleed `bg` rect (and a title's tint)
    // exported as a slide-sized rectangle on each slide, so selecting
    // anything on a slide picked up the background instead.
    const doc = markdownToDoc(
      parseMarkdown(
        [
          '## Bendyline {[title]}',
          '',
          '### About',
          '',
          'A paragraph of body text.',
          '',
          '### Products {[list]}',
          '',
          '- Gezel',
          '- DocBlocks',
          '',
          '### More',
          '',
          'Another paragraph.',
        ].join('\n'),
      ),
      { articleId: 'masters', generateCoverBlock: false },
    );
    const pkg = await openPackage(
      await docToPptx(doc, { themeId: 'gezellig', includeCoverSlide: false }),
    );
    const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
    const slideCount = presentation!.getElementsByTagNameNS(NS_PML, 'sldId').length;
    expect(slideCount).toBe(4);

    const layoutNames: string[] = [];
    for (let index = 1; ; index++) {
      const layout = await getPartXml(pkg, `ppt/slideLayouts/slideLayout${index}.xml`);
      if (!layout) break;
      layoutNames.push(
        layout.getElementsByTagNameNS(NS_PML, 'cSld')[0]?.getAttribute('name') ?? '',
      );
      expect(fullSlideShapes(layout), `layout ${index} shapes`).toEqual([]);
    }
    expect(layoutNames).toEqual(['Title', 'Content', 'List']);

    const slideLayouts: string[] = [];
    for (let index = 1; index <= slideCount; index++) {
      const slide = await getPartXml(pkg, `ppt/slides/slide${index}.xml`);
      expect(fullSlideShapes(slide!), `slide ${index}`).toEqual([]);
      const rels = await getPartRelationships(pkg, `ppt/slides/slide${index}.xml`);
      const layout = rels.find((rel) => rel.type.endsWith('/slideLayout'));
      slideLayouts.push(layout!.target.replace(/^.*slideLayout(\d+)\.xml$/, '$1'));
    }
    expect(slideLayouts).toEqual(['1', '2', '3', '2']);

    // The deck's base background lives on the master; the title's tint is
    // composited into its layout's own radial background.
    const master = await getPartXml(pkg, 'ppt/slideMasters/slideMaster1.xml');
    const masterBackground = master!.getElementsByTagNameNS(NS_PML, 'bg')[0];
    expect(
      masterBackground?.getElementsByTagNameNS(NS_DRAWINGML, 'srgbClr')[0]?.getAttribute('val'),
    ).toBe('1F1A17');
    const titleLayout = await getPartXml(pkg, 'ppt/slideLayouts/slideLayout1.xml');
    const titleBackground = titleLayout!.getElementsByTagNameNS(NS_PML, 'bg')[0];
    expect(
      titleBackground?.getElementsByTagNameNS(NS_DRAWINGML, 'path')[0]?.getAttribute('path'),
    ).toBe('circle');
  });

  it("writes the deck's theme into the theme part and a dark colour map onto the master", async () => {
    const doc = markdownToDoc(parseMarkdown('## One\n\nBody.'), {
      articleId: 'theme-part',
      generateCoverBlock: false,
    });
    const pkg = await openPackage(
      await docToPptx(doc, { themeId: 'gezellig', includeCoverSlide: false }),
    );
    const theme = await getPartXml(pkg, 'ppt/theme/theme1.xml');
    const slot = (name: string) =>
      theme!
        .getElementsByTagNameNS(NS_DRAWINGML, name)[0]
        ?.getElementsByTagNameNS(NS_DRAWINGML, 'srgbClr')[0]
        ?.getAttribute('val');
    expect(slot('dk1')).toBe('1F1A17');
    expect(slot('lt1')).toBe('F3EDE0');
    expect(slot('accent1')).toBe('B0724C');
    const master = await getPartXml(pkg, 'ppt/slideMasters/slideMaster1.xml');
    expect(master!.getElementsByTagNameNS(NS_PML, 'clrMap')[0]?.getAttribute('bg1')).toBe('dk1');
  });

  it('makes a full-bleed photo the slide background, cropped to the slide', async () => {
    const doc = {
      articleId: 'photo-bg',
      duration: 5,
      blocks: [
        {
          id: 'lake',
          template: 'imageWithCaption',
          imageSrc: 'photo.png',
          imageAlt: 'A lake',
          caption: 'Morning light.',
          startTime: 0,
          duration: 5,
          audioSegment: 0,
        },
      ],
    } as unknown as Doc;
    // A square PNG header: enough for the exporter to read its size.
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 800);
    new DataView(png.buffer).setUint32(20, 800);
    const pkg = await openPackage(
      await docToPptx(doc, {
        includeCoverSlide: false,
        images: new Map([['photo.png', png.buffer]]),
      }),
    );
    const slide = await getPartXml(pkg, 'ppt/slides/slide1.xml');
    expect(fullSlideShapes(slide!)).toEqual([]);
    const background = slide!.getElementsByTagNameNS(NS_PML, 'bg')[0];
    const blip = background?.getElementsByTagNameNS(NS_DRAWINGML, 'blip')[0];
    const embed = blip?.getAttributeNS(NS_R, 'embed');
    const rels = await getPartRelationships(pkg, 'ppt/slides/slide1.xml');
    expect(rels.find((rel) => rel.id === embed)?.type).toMatch(/\/image$/);
    expect(background?.getElementsByTagNameNS(NS_DRAWINGML, 'srcRect')[0]?.getAttribute('t')).toBe(
      '21875',
    );
  });
});
