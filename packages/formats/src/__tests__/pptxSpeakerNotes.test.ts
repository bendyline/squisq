import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { docToPptx, markdownDocToPptx } from '../pptx/export';
import { getPartXml, openPackage } from '../ooxml/reader';
import { NS_DRAWINGML, NS_PML } from '../ooxml/namespaces';

// A deck's sources belong in its speaker notes. Before notes existed, the
// semantic export dropped footnotes entirely and the template export drew
// every definition as body text on the last slide.

const DECK = [
  '# Origins',
  '',
  '- A legend credits an emperor.[^legend]',
  '- Tea spread to Japan.[^japan]',
  '',
  '# Today',
  '',
  '- Most drunk after water.[^legend]',
  '',
  '[^legend]: tasks/4/sources/notes.md',
  '[^japan]: tasks/4/sources/japan.md',
  '',
].join('\n');

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function partTexts(bytes: ArrayBuffer, part: string): Promise<string[] | null> {
  const xml = await getPartXml(await openPackage(bytes), part);
  if (!xml) return null;
  return Array.from(xml.getElementsByTagNameNS(NS_DRAWINGML, 't')).map((t) => t.textContent ?? '');
}

async function rels(bytes: ArrayBuffer, part: string): Promise<Element[]> {
  const xml = await getPartXml(await openPackage(bytes), part);
  return xml ? Array.from(xml.getElementsByTagNameNS(REL_NS, 'Relationship')) : [];
}

async function expectNotesForDeck(bytes: ArrayBuffer): Promise<void> {
  expect(await partTexts(bytes, 'ppt/notesSlides/notesSlide1.xml')).toEqual([
    '[1] tasks/4/sources/notes.md',
    '[2] tasks/4/sources/japan.md',
  ]);
  expect(await partTexts(bytes, 'ppt/notesSlides/notesSlide2.xml')).toEqual([
    '[1] tasks/4/sources/notes.md',
  ]);
  for (const slide of [1, 2]) {
    const slideText = (await partTexts(bytes, `ppt/slides/slide${slide}.xml`))!.join(' ');
    expect(slideText).not.toContain('tasks/4/sources');

    const slideRels = await rels(bytes, `ppt/slides/_rels/slide${slide}.xml.rels`);
    const ids = slideRels.map((r) => r.getAttribute('Id'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      slideRels
        .filter((r) => r.getAttribute('Type') === `${OFFICE_REL}/notesSlide`)
        .map((r) => r.getAttribute('Target')),
    ).toEqual([`../notesSlides/notesSlide${slide}.xml`]);

    const notesRels = await rels(bytes, `ppt/notesSlides/_rels/notesSlide${slide}.xml.rels`);
    expect(notesRels.map((r) => r.getAttribute('Target')).sort()).toEqual([
      '../notesMasters/notesMaster1.xml',
      `../slides/slide${slide}.xml`,
    ]);
  }

  const pkg = await openPackage(bytes);
  const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
  const notesMasterId = presentation!
    .getElementsByTagNameNS(NS_PML, 'notesMasterId')[0]
    ?.getAttributeNS(OFFICE_REL, 'id');
  const declared = (await rels(bytes, 'ppt/_rels/presentation.xml.rels')).find(
    (r) => r.getAttribute('Id') === notesMasterId,
  );
  expect(declared?.getAttribute('Target')).toBe('notesMasters/notesMaster1.xml');
  expect(await getPartXml(pkg, 'ppt/notesMasters/notesMaster1.xml')).toBeTruthy();
  expect(
    (await rels(bytes, 'ppt/notesMasters/_rels/notesMaster1.xml.rels'))[0]?.getAttribute('Target'),
  ).toBe('../theme/theme2.xml');
}

describe('PPTX speaker notes from footnotes', () => {
  it('puts each slide’s footnotes in its notes on the semantic path', async () => {
    const bytes = await markdownDocToPptx(parseMarkdown(DECK), { slideBreak: 'h1' });
    await expectNotesForDeck(bytes);
  });

  it('puts them in the notes, not on the last slide, on the template path', async () => {
    const doc = markdownToDoc(parseMarkdown(DECK), {
      generateCoverBlock: false,
      autoTemplates: true,
    });
    const bytes = await docToPptx(doc, { slideBreak: 'h1' });
    await expectNotesForDeck(bytes);
  });

  it('writes no notes parts for a deck without footnotes', async () => {
    const bytes = await markdownDocToPptx(parseMarkdown('# One\n\n- Plain bullet\n'));
    const pkg = await openPackage(bytes);
    expect(await getPartXml(pkg, 'ppt/notesMasters/notesMaster1.xml')).toBeNull();
    const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
    expect(presentation!.getElementsByTagNameNS(NS_PML, 'notesMasterIdLst')).toHaveLength(0);
  });
});
