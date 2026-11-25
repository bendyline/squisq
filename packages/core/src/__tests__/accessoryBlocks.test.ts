/**
 * Accessory blocks: headings tagged with an accessory type (`{[summary]}`)
 * hold side information about their section. They stay in the block tree
 * (so the markdown round-trips) but take no time, make no captions, and are
 * never rendered — and adding them must not change anything else about the
 * document. The differential tests below inject summaries under every heading
 * of a set of documents and compare everything against the original.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown, withoutAccessorySections } from '../markdown/index';
import { countBlocks, flattenBlocks, flattenRenderableBlocks } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';
import {
  collectAccessoryBlocks,
  flattenContentBlocks,
  pruneAccessoryBlocks,
  realChildren,
  withoutAccessoryBlocks,
} from '../doc/accessoryBlocks';
import {
  ACCESSORY_BLOCK_TYPES,
  isAccessoryBlockType,
  type AccessoryBlockType,
} from '../doc/accessoryBlockTypes';
import { isReservedAnnotationToken } from '../doc/templates/templateNames';
import { validateMarkdownSource } from '../doc/validate';
import { writeCustomTemplatesToFrontmatter } from '../doc/customTemplatesFrontmatter';
import { buildNarrationScript } from '../narration/script';
import { docChapters } from '../timing/captionFiles';
import { buildPreviewDoc } from '../doc/buildPreviewDoc';
import { materializePageSections } from '../doc/page/materializePageSection';
import { materializeFlashcards } from '../doc/flashcards/materializeFlashcards';
import { collectVideoDurationSources } from '../doc/videoTiming';
import { applyTransform } from '../transform/applyTransform';
import { getTransformStyleIds } from '../transform/registry';
import { createPresentationPlan } from '../transform/presentationPlanner';
import { presentationBlockImages } from '../transform/presentationMedia';
import { inferDocumentTitle } from '../markdown/utils';
import { DOCUMENTS, convert, strip, withAccessoryBlocks } from './accessoryBlockFixtures';

/** Every registered type alone, and all of them under each heading together. */
const HARNESS_TYPES: Array<[string, AccessoryBlockType | AccessoryBlockType[]]> = [
  ...(Object.keys(ACCESSORY_BLOCK_TYPES) as AccessoryBlockType[]).map(
    (type): [string, AccessoryBlockType] => [type, type],
  ),
  ['every type together', Object.keys(ACCESSORY_BLOCK_TYPES) as AccessoryBlockType[]],
];

describe.each(HARNESS_TYPES)(
  'accessory blocks (%s): adding them changes nothing else',
  (_label, type) => {
    const withSummaries = (md: string) => withAccessoryBlocks(md, type);
    for (const [name, md] of Object.entries(DOCUMENTS)) {
      describe(name, () => {
        const before = convert(md, 'notes.md');
        const after = convert(withSummaries(md), 'notes.md');

        it('really added summaries', () => {
          expect(collectAccessoryBlocks(after.blocks).length).toBeGreaterThan(1);
          expect(withSummaries(md)).not.toBe(md);
        });

        it('leaves the pruned block tree identical — ids, order, timing, inputs', () => {
          expect(strip(pruneAccessoryBlocks(after.blocks))).toEqual(strip(before.blocks));
        });

        it('leaves duration, captions, cover, media and diagnostics identical', () => {
          expect(after.duration).toBe(before.duration);
          expect(after.captions).toEqual(before.captions);
          expect(after.startBlock).toEqual(before.startBlock);
          expect(strip(after.documentMedia)).toEqual(strip(before.documentMedia));
          expect(strip(after.diagnostics)).toEqual(strip(before.diagnostics));
        });

        it('leaves the narration script and chapters identical', () => {
          expect(buildNarrationScript(after)).toEqual(buildNarrationScript(before));
          expect(docChapters(after)).toEqual(docChapters(before));
        });

        it('leaves the rendered and counted blocks identical', () => {
          expect(flattenRenderableBlocks(after.blocks).map((b) => b.id)).toEqual(
            flattenRenderableBlocks(before.blocks).map((b) => b.id),
          );
          expect(countBlocks(after.blocks)).toBe(countBlocks(before.blocks));
        });

        it('round-trips the markdown, summaries included', () => {
          const source = withSummaries(md);
          const canonical = stringifyMarkdown(parseMarkdown(source));
          expect(stringifyMarkdown(docToMarkdown(after))).toBe(canonical);
        });

        it('leaves every projection identical: slides, page, cards, plan, transforms', () => {
          expect(strip(buildPreviewDoc(after))).toEqual(strip(buildPreviewDoc(before)));
          expect(strip(materializePageSections(after))).toEqual(
            strip(materializePageSections(before)),
          );
          // Study cards make their own deck; the cards inferred from headings never change.
          expect(strip(materializeFlashcards(after, { source: 'headings' }))).toEqual(
            strip(materializeFlashcards(before, { source: 'headings' })),
          );
          expect(createPresentationPlan(after)).toEqual(createPresentationPlan(before));
          expect([...presentationBlockImages(after)]).toEqual([...presentationBlockImages(before)]);
          expect(collectVideoDurationSources(after)).toEqual(collectVideoDurationSources(before));
          for (const style of getTransformStyleIds()) {
            // Dynamic slides hands the document on whole, summaries and all: the
            // saved presentation reads them later.
            expect(strip(withoutAccessoryBlocks(applyTransform(after, style).doc)), style).toEqual(
              strip(applyTransform(before, style).doc),
            );
          }
          const source = withSummaries(md);
          expect(inferDocumentTitle(parseMarkdown(source))).toBe(
            inferDocumentTitle(parseMarkdown(md)),
          );
        });

        it('gives accessory blocks no time and no template', () => {
          const all = flattenBlocks(after.blocks).filter((b) => b.accessoryBlock);
          expect(all.length).toBeGreaterThan(0);
          for (const block of all) {
            expect(block.duration).toBe(0);
            expect(block.template).toBeUndefined();
            expect(block.media).toBeUndefined();
          }
        });
      });
    }
  },
);

describe('accessory blocks: parsing', () => {
  const md = [
    'Before the first heading.',
    '',
    '## Summary of the document {[summary]}',
    '',
    '## Results',
    '',
    'Revenue grew.',
    '',
    '### Revenue grew {[summary]}',
    '',
    '- Up 40%',
    '',
    '#### Inside the summary',
    '',
    'A note.',
    '',
    '### Next steps {[summary passage=abc-1 origin=ai]}',
    '',
    '### Summary of the document',
    '',
    'A real heading whose text a summary also uses.',
    '',
    '## Elsewhere',
    '',
    '### For results {[summary of=results]}',
  ].join('\n');
  const doc = convert(md);
  const byId = new Map(flattenBlocks(doc.blocks).map((b) => [b.id, b]));

  it('names each block’s owner and gives it an id of its own', () => {
    expect(byId.get('preamble~summary')?.accessoryBlock).toEqual({
      type: 'summary',
      of: 'preamble',
    });
    expect(byId.get('results~summary')?.accessoryBlock).toEqual({
      type: 'summary',
      of: 'results',
    });
    expect(byId.get('results~summary-2')?.templateOverrides).toEqual({
      passage: 'abc-1',
      origin: 'ai',
    });
    // An `of=` names the owner wherever the block sits.
    expect(byId.get('results~summary-3')?.accessoryBlock).toEqual({
      type: 'summary',
      of: 'results',
    });
  });

  it('keeps the title, so the heading is the slide headline', () => {
    expect(byId.get('results~summary')?.title).toBe('Revenue grew');
  });

  it('treats headings nested under an accessory block as part of it', () => {
    const nested = byId.get('results~summary~1');
    expect(nested?.title).toBe('Inside the summary');
    expect(nested?.accessoryBlock).toEqual({
      type: 'summary',
      of: 'results',
      within: 'results~summary',
    });
    expect(collectAccessoryBlocks(doc.blocks).map((b) => b.id)).toEqual([
      'preamble~summary',
      'results~summary',
      'results~summary-2',
      'results~summary-3',
    ]);
  });

  it('never takes a real block’s slug, so real ids do not move', () => {
    // The real "Summary of the document" heading keeps the plain slug.
    expect(byId.get('summary-of-the-document')?.accessoryBlock).toBeUndefined();
    expect(byId.has('summary-of-the-document-2')).toBe(false);
  });

  it('leaves accessory blocks out of rendering and counts, but not out of the tree', () => {
    const results = doc.blocks.find((b) => b.id === 'results')!;
    expect(results.children?.map((b) => b.id)).toEqual([
      'results~summary',
      'results~summary-2',
      'summary-of-the-document',
    ]);
    expect(realChildren(results).map((b) => b.id)).toEqual(['summary-of-the-document']);
    expect(flattenRenderableBlocks(doc.blocks).map((b) => b.id)).toEqual([
      'preamble',
      'results',
      'summary-of-the-document',
      'elsewhere',
    ]);
    expect(flattenContentBlocks(doc.blocks).map((b) => b.id)).toEqual([
      'preamble',
      'results',
      'summary-of-the-document',
      'elsewhere',
    ]);
    expect(countBlocks(doc.blocks)).toBe(4);
  });

  it('prunes without copying a tree that has none', () => {
    const plain = convert('# A\n\n## B\n\nText.');
    expect(pruneAccessoryBlocks(plain.blocks)).toBe(plain.blocks);
    expect(withoutAccessoryBlocks(plain)).toBe(plain);
  });

  it('has no owner at the top of a document with no text before its first heading', () => {
    const orphan = convert('## Note {[summary]}\n\n## Real\n\nText.');
    expect(orphan.blocks[0].accessoryBlock).toEqual({ type: 'summary' });
    expect(orphan.blocks[0].id).toBe('~summary');
    expect(orphan.startBlock?.title).toBe('Real');
  });

  it('keeps an unregistered tag an ordinary block', () => {
    const other = convert('## A\n\n### Note {[aside]}\n\nText.');
    expect(other.blocks[0].children?.[0].accessoryBlock).toBeUndefined();
    expect(isAccessoryBlockType('aside')).toBe(false);
  });

  it('keeps a standalone summary paragraph an ordinary (unknown) block', () => {
    const standalone = convert('## A\n\nText.\n\n{[summary]}\n\nMore.');
    expect(flattenBlocks(standalone.blocks).some((b) => b.accessoryBlock)).toBe(false);
  });
});

describe('accessory blocks: tags and validation', () => {
  it('reserves accessory type names against inline icons', () => {
    for (const type of Object.keys(ACCESSORY_BLOCK_TYPES))
      expect(isReservedAnnotationToken(type), type).toBe(true);
  });

  it('does not report the summary tag as an unknown template', () => {
    const result = validateMarkdownSource(
      '## A\n\nText.\n\n### Headline {[summary passage=abc-1 origin=ai]}\n\n- Point',
    );
    expect(result.diagnostics.map((d) => d.code)).not.toContain('unknown-template');
    expect(result.warningCount).toBe(0);
  });

  it('warns that a custom template named summary is never used', () => {
    const encoded = writeCustomTemplatesToFrontmatter([
      { name: 'summary', label: 'Summary', viewport: { width: 1920, height: 1080 }, layers: [] },
    ]);
    const result = validateMarkdownSource(
      ['---', `squisq-custom-templates: ${encoded}`, '---', '', '## A'].join('\n'),
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('custom-template-shadowed');
  });
});

describe('summary section settings on a heading', () => {
  it('are typed on the block, round-trip, and never reach a template', () => {
    const md = [
      '## Results {[slideLayout=cards supportingSlides=false]}',
      '',
      'Revenue grew 40% last year.',
      '',
      '## Plan {[list slideLayout=authored]}',
      '',
      '- Hire',
      '- Ship',
    ].join('\n');
    const doc = convert(md);
    const [results, plan] = doc.blocks;
    expect(results.slideLayout).toBe('cards');
    expect(results.supportingSlides).toBe(false);
    expect(plan.template).toBe('list');
    expect(plan.slideLayout).toBe('authored');
    expect(stringifyMarkdown(docToMarkdown(doc))).toBe(stringifyMarkdown(parseMarkdown(md)));
    const slides = JSON.stringify(buildPreviewDoc(doc).blocks);
    expect(slides).not.toContain('slideLayout');
    expect(slides).not.toContain('supportingSlides');
    expect(validateMarkdownSource(md).warningCount).toBe(0);
  });
});

describe('accessory sections in a markdown tree', () => {
  it('drops each accessory heading and what is under it, up to its level', () => {
    const md = parseMarkdown(
      [
        '## A',
        '',
        'Kept.',
        '',
        '### Headline {[summary]}',
        '',
        '- Dropped',
        '',
        '#### Nested',
        '',
        'Dropped too.',
        '',
        '### Real child',
        '',
        'Kept.',
      ].join('\n'),
    );
    const kept = withoutAccessorySections(md);
    expect(stringifyMarkdown(kept)).toBe('## A\n\nKept.\n\n### Real child\n\nKept.\n');
    const plain = parseMarkdown('## A\n\nText.');
    expect(withoutAccessorySections(plain)).toBe(plain);
  });
});
