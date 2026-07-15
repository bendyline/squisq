/**
 * OOXML run-property child ORDER conformance.
 *
 * `w:rPr` (WordprocessingML) and `a:rPr` / `a:defRPr` (DrawingML) are XSD
 * `xsd:sequence` types: their children must appear in a fixed order, not merely
 * be present. Word/PowerPoint are lenient when reading, so a bad order survives
 * a manual smoke test — but strict OOXML validators reject the part, and Office
 * can route the file into its repair path.
 *
 * These tests export REAL packages and validate every run-property element in
 * the generated parts against the ECMA-376 sequences, so any emitter (present
 * or future) that pushes children out of order fails here.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { markdownDocToDocx } from '../docx/export';
import { markdownDocToPptx } from '../pptx/export';

// ============================================
// Canonical ECMA-376 sequences
// ============================================

/**
 * ECMA-376 Part 1, `EG_RPrBase` (the child sequence of `CT_RPr`), in order.
 * Trimmed to the elements this codebase can emit plus their neighbours.
 */
const W_RPR_SEQUENCE = [
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
];

/**
 * ECMA-376 Part 1, `CT_TextCharacterProperties` child sequence, in order.
 * The `EG_FillProperties` group (`solidFill`, …) precedes `latin`.
 */
const A_RPR_SEQUENCE = [
  'ln',
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
  'effectLst',
  'effectDag',
  'highlight',
  'uLnTx',
  'uLn',
  'uFillTx',
  'uFill',
  'latin',
  'ea',
  'cs',
  'sym',
  'hlinkClick',
  'hlinkMouseOver',
  'rtl',
  'extLst',
];

/**
 * Assert an element's children appear in a subsequence of `sequence`.
 * Returns a human-readable description of the violation, or null.
 */
function findOrderViolation(el: Element, sequence: string[]): string | null {
  const names = Array.from(el.children).map((c) => c.localName);
  let cursor = -1;
  for (const name of names) {
    const index = sequence.indexOf(name);
    if (index === -1) continue; // Unknown/extension element — not our concern.
    if (index < cursor) {
      return `<${el.localName}> children [${names.join(', ')}] — "${name}" must precede the element before it`;
    }
    cursor = index;
  }
  return null;
}

function collectViolations(xml: string, tagNames: string[], sequence: string[]): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const violations: string[] = [];
  let checked = 0;
  for (const tag of tagNames) {
    const els = doc.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) {
      checked++;
      const violation = findOrderViolation(els[i], sequence);
      if (violation) violations.push(violation);
    }
  }
  // Guard against a vacuous pass: the fixture must actually produce rPr nodes.
  expect(checked).toBeGreaterThan(0);
  return violations;
}

/** A document exercising every run-property emitter: bold/italic/strike/code/links. */
const RICH_DOC: MarkdownDocument = {
  type: 'document',
  children: [
    { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Title' }] },
    {
      type: 'paragraph',
      children: [
        { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
        { type: 'emphasis', children: [{ type: 'text', value: 'italic' }] },
        { type: 'delete', children: [{ type: 'text', value: 'struck' }] },
        { type: 'inlineCode', value: 'code()' },
        // Strike + code in ONE run, so `w:strike` and `w:rFonts` co-occur and
        // their relative order is actually exercised.
        { type: 'delete', children: [{ type: 'inlineCode', value: 'struckCode()' }] },
        {
          type: 'strong',
          children: [
            {
              type: 'emphasis',
              children: [{ type: 'inlineCode', value: 'boldItalicCode()' }],
            },
          ],
        },
        {
          type: 'link',
          url: 'https://example.com',
          children: [{ type: 'text', value: 'plain link' }],
        },
        // `**[bold link](url)**` — a link nested INSIDE strong is what threads
        // bold/italic into the hyperlink run itself (`makeHyperlinkRun`).
        {
          type: 'strong',
          children: [
            {
              type: 'emphasis',
              children: [
                {
                  type: 'link',
                  url: 'https://example.com/bold',
                  children: [{ type: 'text', value: 'bold italic link' }],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: 'code', lang: 'ts', value: 'const x = 1;\nconst y = 2;' },
    {
      type: 'blockquote',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'q' }] }],
    },
  ],
};

// ============================================
// DOCX
// ============================================

describe('DOCX w:rPr child order (ECMA-376 EG_RPrBase)', () => {
  it('emits every w:rPr in schema sequence order', async () => {
    const buffer = await markdownDocToDocx(RICH_DOC);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('text');

    expect(collectViolations(xml, ['w:rPr'], W_RPR_SEQUENCE)).toEqual([]);
  });

  it('emits every w:rPr in styles.xml in schema sequence order', async () => {
    const buffer = await markdownDocToDocx(RICH_DOC);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/styles.xml')!.async('text');

    expect(collectViolations(xml, ['w:rPr'], W_RPR_SEQUENCE)).toEqual([]);
  });

  it('puts w:rFonts before w:b/w:i/w:color on a bold inline-code run', async () => {
    const buffer = await markdownDocToDocx(RICH_DOC);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('text');

    // Target the nested strong>emphasis>inlineCode run, which carries
    // rFonts + b + i + sz together — the case where the order actually differs.
    const rPrs = xml.match(/<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>/g) ?? [];
    const rPr = rPrs.find((p) => p.includes('w:ascii') && p.includes('<w:b/>'));
    expect(rPr, 'fixture must produce a bold inline-code run').toBeDefined();
    expect(rPr!.indexOf('<w:rFonts')).toBeLessThan(rPr!.indexOf('<w:b/>'));
    expect(rPr!.indexOf('<w:b/>')).toBeLessThan(rPr!.indexOf('<w:sz'));
  });

  it('orders hyperlink run properties rStyle → b/i → color → u', async () => {
    const buffer = await markdownDocToDocx(RICH_DOC);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('text');

    const rPrs = xml.match(/<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>/g) ?? [];
    // The `**[bold italic link]()**` run carries rStyle + b + i + color + u.
    const rPr = rPrs.find((p) => p.includes('Hyperlink') && p.includes('<w:b/>'));
    expect(rPr, 'fixture must produce a bold hyperlink run').toBeDefined();
    expect(rPr!.indexOf('<w:rStyle')).toBeLessThan(rPr!.indexOf('<w:b/>'));
    expect(rPr!.indexOf('<w:b/>')).toBeLessThan(rPr!.indexOf('<w:i/>'));
    expect(rPr!.indexOf('<w:i/>')).toBeLessThan(rPr!.indexOf('<w:color'));
    expect(rPr!.indexOf('<w:color')).toBeLessThan(rPr!.indexOf('<w:u '));
  });
});

// ============================================
// PPTX
// ============================================

describe('PPTX a:rPr child order (ECMA-376 CT_TextCharacterProperties)', () => {
  it('emits every a:rPr / a:defRPr in schema sequence order', async () => {
    const buffer = await markdownDocToPptx(RICH_DOC);
    const zip = await JSZip.loadAsync(buffer);

    const slidePaths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    expect(slidePaths.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const path of slidePaths) {
      const xml = await zip.file(path)!.async('text');
      violations.push(...collectViolations(xml, ['a:rPr', 'a:defRPr'], A_RPR_SEQUENCE));
    }
    expect(violations).toEqual([]);
  });

  it('puts a:solidFill before a:latin on code runs', async () => {
    const buffer = await markdownDocToPptx(RICH_DOC);
    const zip = await JSZip.loadAsync(buffer);

    const slidePaths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    let sawLatinRun = false;
    for (const path of slidePaths) {
      const xml = await zip.file(path)!.async('text');
      const rPrs = xml.match(/<a:rPr\b[^>]*>(?:(?!<\/a:rPr>).)*<\/a:rPr>/g) ?? [];
      for (const rPr of rPrs) {
        if (!rPr.includes('<a:latin') || !rPr.includes('<a:solidFill')) continue;
        sawLatinRun = true;
        expect(rPr.indexOf('<a:solidFill')).toBeLessThan(rPr.indexOf('<a:latin'));
      }
    }
    expect(sawLatinRun).toBe(true);
  });
});
