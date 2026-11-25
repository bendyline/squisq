/**
 * A block drawn on the slide of the section before it (a Custom summary's
 * `slideLayout=feature`) exports to PowerPoint as it plays: the chart's own
 * shapes and labels, inside the band beneath the slide's words, the labels at
 * the size the chart chose.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { docToPptx } from '../pptx/export';
import { openPackage, getPartXml } from '../ooxml/reader';
import { NS_DRAWINGML, NS_PML } from '../ooxml/namespaces';

const MARKDOWN = [
  '---',
  'squisq-transform: dynamic-slides',
  '---',
  '# Results',
  '',
  'Revenue grew 40% last year. Most of it came from new customers.',
  '',
  '## By region {[barChart slideLayout=feature]}',
  '',
  '| Region | Sales |',
  '| --- | --- |',
  '| North | 40 |',
  '| South | 25 |',
  '',
  '## Terms',
  '',
  'Net thirty days. Prices are fixed for the year.',
].join('\n');

describe('a rolled-up chart in PowerPoint', () => {
  it('draws the chart inside the band beneath the words of the slide carrying it', async () => {
    const doc = markdownToDoc(parseMarkdown(MARKDOWN), { articleId: 'rolled-up' });
    const pkg = await openPackage(await docToPptx(doc, { includeCoverSlide: false }));
    const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
    expect(presentation!.getElementsByTagNameNS(NS_PML, 'sldId')).toHaveLength(2);
    const size = presentation!.getElementsByTagNameNS(NS_PML, 'sldSz')[0]!;
    const height = Number(size.getAttribute('cy'));
    const width = Number(size.getAttribute('cx'));

    const slide = await getPartXml(pkg, 'ppt/slides/slide1.xml');
    const shapes = Array.from(slide!.getElementsByTagNameNS(NS_PML, 'sp'));
    const named = (shape: Element) =>
      shape.getElementsByTagNameNS(NS_PML, 'cNvPr')[0]?.getAttribute('name') ?? '';
    const chart = shapes.filter((shape) => /-feature-1-/.test(named(shape)));
    expect(chart.length).toBeGreaterThan(0);
    const text = chart
      .flatMap((shape) => Array.from(shape.getElementsByTagNameNS(NS_DRAWINGML, 't')))
      .map((run) => run.textContent);
    expect(text).toEqual(expect.arrayContaining(['North', 'South']));
    for (const shape of chart) {
      const offset = shape.getElementsByTagNameNS(NS_DRAWINGML, 'off')[0];
      if (!offset) continue;
      const y = Number(offset.getAttribute('y'));
      const x = Number(offset.getAttribute('x'));
      expect(y, named(shape)).toBeGreaterThan(height * 0.15);
      expect(y, named(shape)).toBeLessThanOrEqual(height);
      expect(x, named(shape)).toBeGreaterThanOrEqual(0);
      expect(x, named(shape)).toBeLessThanOrEqual(width);
    }
    // The slide's own words are still there.
    const words = Array.from(slide!.getElementsByTagNameNS(NS_DRAWINGML, 't'))
      .map((run) => run.textContent)
      .join(' ');
    expect(words).toContain('Results');
  });
});
