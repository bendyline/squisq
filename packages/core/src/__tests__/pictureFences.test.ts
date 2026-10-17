/**
 * Picture fences — ```mermaid and ```svg — are pictures, not prose. One
 * predicate (`isPictureFence`) decides it, and every body-text consumer
 * (narration, captions, reading time, slide copy, the recommender) honors it.
 */

import { describe, it, expect } from 'vitest';
import type { Block } from '../schemas/Doc.js';
import { parseMarkdown } from '../markdown/parse.js';
import { getBlockBodyText, markdownToDoc } from '../doc/markdownToDoc.js';
import { isMaterializedMediaNode, isPictureFence } from '../doc/templateInputs.js';
import { materializePageSection } from '../doc/page/materializePageSection.js';
import { buildNarrationScript } from '../narration/script.js';
import { extractFeatureContents } from '../transform/contentSummary.js';
import { profileBlockContents } from '../recommend/templates.js';

const SVG_FENCE = [
  '```svg',
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">',
  '  <circle cx="12" cy="12" r="10" fill="currentColor"/>',
  '  <text x="2" y="20">Badge label words</text>',
  '</svg>',
  '```',
].join('\n');

const MERMAID_FENCE = ['```mermaid', 'flowchart LR', '  alpha --> beta', '```'].join('\n');

function firstBlock(markdown: string): Block {
  const doc = markdownToDoc(parseMarkdown(markdown), { autoTemplates: false });
  return doc.blocks[0] as Block;
}

describe('isPictureFence', () => {
  it('recognizes mermaid and svg fences by language, case- and padding-insensitive', () => {
    for (const lang of ['mermaid', 'svg', 'SVG', ' Svg ']) {
      expect(isPictureFence({ type: 'code', lang, value: 'x' })).toBe(true);
    }
  });

  it('leaves code that only looks like SVG alone', () => {
    for (const lang of ['xml', 'html', 'svgx', '', null, undefined]) {
      expect(isPictureFence({ type: 'code', lang, value: '<svg/>' })).toBe(false);
    }
    expect(isPictureFence({ type: 'paragraph', children: [] })).toBe(false);
  });

  it('counts as materialized media', () => {
    const [svg] = parseMarkdown(SVG_FENCE).children;
    expect(isMaterializedMediaNode(svg!)).toBe(true);
  });
});

describe('body text skips picture fences', () => {
  const markdown = `# Overview\n\nThe prose stays.\n\n${SVG_FENCE}\n\n${MERMAID_FENCE}\n\n\`\`\`xml\n<svg id="shown-as-code"/>\n\`\`\``;

  it('getBlockBodyText keeps prose and markup fences, drops picture fences', () => {
    const text = getBlockBodyText(firstBlock(markdown));
    expect(text).toContain('The prose stays.');
    expect(text).toContain('shown-as-code');
    expect(text).not.toContain('circle');
    expect(text).not.toContain('Badge label words');
    expect(text).not.toContain('flowchart');
  });

  it('narration never speaks diagram source or SVG markup', () => {
    const doc = markdownToDoc(parseMarkdown(markdown), { autoTemplates: false });
    const script = buildNarrationScript(doc);
    expect(script.sourceText).toContain('The prose stays.');
    expect(script.sourceText).not.toContain('flowchart');
    expect(script.sourceText).not.toContain('viewBox');
  });

  it('a picture fence adds no reading time', () => {
    const plain = markdownToDoc(parseMarkdown('# A\n\nShort words here.'), {
      autoTemplates: false,
    });
    const withPictures = markdownToDoc(
      parseMarkdown(`# A\n\nShort words here.\n\n${SVG_FENCE}\n\n${MERMAID_FENCE}`),
      { autoTemplates: false },
    );
    expect(withPictures.blocks[0]!.duration).toBe(plain.blocks[0]!.duration);
    // Control: the same markup shown as code is still read.
    const longMarkup = Array.from({ length: 40 }, (_, i) => `<rect id="r${i}"/>`).join('\n');
    const withCode = markdownToDoc(
      parseMarkdown(`# A\n\nShort words here.\n\n\`\`\`xml\n${longMarkup}\n\`\`\``),
      { autoTemplates: false },
    );
    const withSvg = markdownToDoc(
      parseMarkdown(`# A\n\nShort words here.\n\n\`\`\`svg\n<svg>${longMarkup}</svg>\n\`\`\``),
      { autoTemplates: false },
    );
    expect(withCode.blocks[0]!.duration).toBeGreaterThan(plain.blocks[0]!.duration);
    expect(withSvg.blocks[0]!.duration).toBe(plain.blocks[0]!.duration);
  });
});

describe('page sections', () => {
  it('keeps an svg fence as rich content beside a typed template', () => {
    const block = firstBlock(`# Rich {[factCard]}\n\nNarrative copy.\n\n${SVG_FENCE}`);
    const { section } = materializePageSection(block);
    expect(section.slots.body?.text).not.toContain('circle');
    expect(section.slots.richContent?.markdown).toEqual([
      expect.objectContaining({ type: 'code', lang: 'svg' }),
    ]);
  });

  it('does not repeat picture fences a canvas embed already draws', () => {
    const block = {
      id: 'authored',
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      layers: [{ id: 'l1', type: 'text', content: { text: 'hi' } }],
      contents: parseMarkdown(`${SVG_FENCE}\n\n${MERMAID_FENCE}`).children,
    } as unknown as Block;
    const { section } = materializePageSection(block);
    expect(section.kind).toBe('canvas-embed');
    expect(section.slots.richContent).toBeUndefined();
  });
});

describe('feature lifting and recommendations', () => {
  it('lifts an svg fence as a visual feature', () => {
    const contents = parseMarkdown(`Intro words.\n\n${SVG_FENCE}`).children;
    const features = extractFeatureContents(contents);
    expect(features).toEqual([expect.objectContaining({ type: 'code', lang: 'svg' })]);
  });

  it("a mermaid gantt's dates do not make a block look like a dated event", () => {
    const gantt = '```mermaid\ngantt\n  section Build\n  Pour concrete :2024-07-01, 30d\n```';
    const profile = profileBlockContents(parseMarkdown(gantt).children);
    expect(profile.hasDate).toBe(false);
    expect(profile.wordCount).toBe(0);
  });
});
