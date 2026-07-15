import { describe, expect, it } from 'vitest';
import type { MarkdownBlockNode, MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Transition } from '@bendyline/squisq/schemas';
import { TRANSITION_TYPES } from '@bendyline/squisq/schemas';
import { markdownDocToPptx } from '../pptx/export';
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
