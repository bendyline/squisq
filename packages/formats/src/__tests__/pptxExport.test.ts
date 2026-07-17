import { describe, expect, it } from 'vitest';
import type { MarkdownBlockNode, MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc, Transition } from '@bendyline/squisq/schemas';
import { THEMES, TRANSITION_TYPES, VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  expandDocBlocks,
  flattenRenderableBlocks,
  resolvePersistentLayers,
  resolveThemeForDoc,
} from '@bendyline/squisq/doc';
import { docToPptx, markdownDocToPptx } from '../pptx/export';
import { openPackage, getPartXml } from '../ooxml/reader';
import { NS_PML, NS_PML_2010 } from '../ooxml/namespaces';

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
  });
  return blocks.length + (doc.startBlock ? 1 : 0);
}

async function pptxSlideCount(bytes: ArrayBuffer): Promise<number> {
  const pkg = await openPackage(bytes);
  const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
  expect(presentation).not.toBeNull();
  return presentation!.getElementsByTagNameNS(NS_PML, 'sldId').length;
}

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
});
