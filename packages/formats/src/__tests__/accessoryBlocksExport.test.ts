/**
 * Accessory blocks (`### Headline {[summary]}`, `{[flashcard]}`, `{[quiz]}`
 * and what is under them) are side information — a section's custom slide
 * wording, its study cards — and never content. Every export leaves them out:
 * a document with them exports exactly what it exports without them.
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { ACCESSORY_BLOCK_TYPES, markdownToDoc } from '@bendyline/squisq/doc';
import { withoutBlockTags } from '../shared/blockTags';
import { markdownDocToDocx, docToDocx } from '../docx/export';
import { markdownDocToEpub } from '../epub/export';
import { markdownDocToPdf } from '../pdf/export';
import { markdownDocToPlainHtml } from '../html/plainHtml';
import { markdownDocToXlsx } from '../xlsx/export';
import { markdownDocToPptx, docToPptx } from '../pptx/export';
import { generateInlineHtml } from '../html/htmlTemplate';

/** Appears only inside the summaries. */
const MARK = 'Zanzibarsummary';

const PLAIN = [
  '# Launch plan',
  '',
  'We ship the editor in March.[^1]',
  '',
  '| Team | Owns |',
  '| --- | --- |',
  '| Design | The look |',
  '',
  '## What ships',
  '',
  'The editor and the exporter ship together.',
  '',
  '[^1]: Dates can move.',
].join('\n');

/**
 * The plain document with blocks of `type` in both places tools put them:
 * after a section's own text, and at the very end after its footnote
 * definitions. Each carries things that must never leak: a list (a checklist
 * for a quiz), a table, a picture, a footnote, a nested heading.
 */
function withAccessory(type: string): string {
  const keyed =
    type === 'summary' ? 'passage=abc-1 origin=ai layout=statement' : 'passage=abc-1 origin=ai';
  return [
    '# Launch plan',
    '',
    'We ship the editor in March.[^1]',
    '',
    '| Team | Owns |',
    '| --- | --- |',
    '| Design | The look |',
    '',
    `## ${MARK} headline {[${type}]}`,
    '',
    type === 'quiz' ? `- [ ] ${MARK} choice\n- [x] ${MARK} right choice` : `- ${MARK} point[^2]`,
    '',
    `| ${MARK} | table |`,
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    `![${MARK} picture](images/${MARK}.png)`,
    '',
    `### ${MARK} nested heading`,
    '',
    `[^2]: ${MARK} footnote.`,
    '',
    '## What ships',
    '',
    'The editor and the exporter ship together.',
    '',
    '[^1]: Dates can move.',
    '',
    // Tools write a section's blocks after all of its own text, footnote
    // definitions included; anything after a block's heading is the block's.
    `### ${MARK} second {[${type} ${keyed}]}`,
  ].join('\n');
}

async function zipText(bytes: ArrayBuffer, suffix: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((name) => name.endsWith(suffix))
    .sort();
  return (await Promise.all(names.map((name) => zip.file(name)!.async('string')))).join('\n');
}

async function zipNames(bytes: ArrayBuffer): Promise<string[]> {
  return Object.keys((await JSZip.loadAsync(bytes)).files).sort();
}

describe.each(Object.keys(ACCESSORY_BLOCK_TYPES))('accessory blocks (%s) in exports', (type) => {
  const WITH_SUMMARIES = withAccessory(type);
  it('are removed with what is under them, before block tags', () => {
    const stripped = withoutBlockTags(parseMarkdown(WITH_SUMMARIES));
    expect(JSON.stringify(stripped)).not.toContain(MARK);
    expect(JSON.stringify(stripped)).toContain('The editor and the exporter ship together.');
  });

  it('are not in Word', async () => {
    const xml = await zipText(await markdownDocToDocx(parseMarkdown(WITH_SUMMARIES)), '.xml');
    expect(xml).not.toContain(MARK);
    expect(xml).toContain('The editor and the exporter ship together.');
    const fromDoc = await zipText(
      await docToDocx(markdownToDoc(parseMarkdown(WITH_SUMMARIES))),
      '.xml',
    );
    expect(fromDoc).not.toContain(MARK);
  });

  it('are not in EPUB', async () => {
    const bytes = await markdownDocToEpub(parseMarkdown(WITH_SUMMARIES));
    const xhtml = await zipText(bytes, '.xhtml');
    expect(xhtml).not.toContain(MARK);
    expect(xhtml).toContain('The editor and the exporter ship together.');
    expect(await zipNames(bytes)).toEqual(
      await zipNames(await markdownDocToEpub(parseMarkdown(PLAIN))),
    );
  });

  it('do not change a PDF', async () => {
    const withSummaries = await markdownDocToPdf(parseMarkdown(WITH_SUMMARIES));
    const plain = await markdownDocToPdf(parseMarkdown(PLAIN));
    // Only the creation and modification dates may differ.
    expect(withSummaries.byteLength).toBe(plain.byteLength);
  });

  it('are not on an HTML page, and do not number its footnotes', () => {
    const html = markdownDocToPlainHtml(parseMarkdown(WITH_SUMMARIES));
    expect(html).not.toContain(MARK);
    expect(html).toBe(markdownDocToPlainHtml(parseMarkdown(PLAIN)));
  });

  it('are not a spreadsheet’s tables', async () => {
    const withSummaries = await zipNames(await markdownDocToXlsx(parseMarkdown(WITH_SUMMARIES)));
    expect(withSummaries).toEqual(await zipNames(await markdownDocToXlsx(parseMarkdown(PLAIN))));
  });

  it('are not slides or speaker notes in PowerPoint', async () => {
    const fromMarkdown = await markdownDocToPptx(parseMarkdown(WITH_SUMMARIES));
    expect(await zipText(fromMarkdown, '.xml')).not.toContain(MARK);
    expect(await zipNames(fromMarkdown)).toEqual(
      await zipNames(await markdownDocToPptx(parseMarkdown(PLAIN))),
    );

    const fromDoc = await docToPptx(markdownToDoc(parseMarkdown(WITH_SUMMARIES)));
    expect(await zipText(fromDoc, '.xml')).not.toContain(MARK);
    expect(await zipNames(fromDoc)).toEqual(
      await zipNames(await docToPptx(markdownToDoc(parseMarkdown(PLAIN)))),
    );
  });

  it('are not in an exported player page', () => {
    const html = generateInlineHtml(markdownToDoc(parseMarkdown(WITH_SUMMARIES)), {
      playerScript: '',
    });
    expect(html).not.toContain(MARK);
    expect(html).toContain('The editor and the exporter ship together.');
  });
});
