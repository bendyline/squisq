/**
 * Tests for PPTX layout inference: placeholder extraction (EMU→%, master
 * inheritance, chrome exclusion), the built-in-vs-custom classifier, custom
 * template generation, importer annotations, and the dialog inspection API.
 */

import { describe, expect, it } from 'vitest';
import type { MarkdownHeading, MarkdownList } from '@bendyline/squisq/markdown';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import {
  expandDocBlocks,
  markdownToDoc,
  readCustomTemplatesFromFrontmatter,
} from '@bendyline/squisq/doc';
import type { CustomTemplateLayer, TextLayer } from '@bendyline/squisq/schemas';
import { openPackage } from '../ooxml/reader';
import { analyzePptxLayouts, inspectPptxLayouts } from '../pptx/layouts';
import { pptxToContainer, pptxToMarkdownDoc } from '../pptx/import';
import { NS_DRAWINGML, NS_PML, NS_R, REL_IMAGE } from '../ooxml/namespaces';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { buildThemedPptx, layoutXml, phSp, slideXml } from './pptxInferFixtures';

// Shared EMU rects (12192000×6858000 slide → easy percentages).
const TITLE_RECT = { x: 914400, y: 685800, cx: 10363200, cy: 1371600 }; // 7.5,10,85,20
const LEFT_COL = { x: 609600, y: 1714500, cx: 5181600, cy: 4114800 }; // 5,25,42.5,60
const RIGHT_COL = { x: 6400800, y: 1714500, cx: 5181600, cy: 4114800 }; // 52.5,25,42.5,60
const PIC_LEFT = { x: 609600, y: 1714500, cx: 4876800, cy: 3429000 }; // 5,25,40,50
const TEXT_RIGHT = { x: 6096000, y: 1714500, cx: 5486400, cy: 3429000 }; // 50,25,45,50

const twoContentLayout = (name = 'Two Content') =>
  layoutXml({
    name,
    shapes: [
      phSp({ type: 'title', rect: TITLE_RECT }, 2),
      phSp({ idx: 1, rect: LEFT_COL }, 3),
      phSp({ idx: 2, rect: RIGHT_COL }, 4),
    ],
  });

describe('analyzePptxLayouts — extraction', () => {
  it('converts explicit EMU geometry to percent rects', async () => {
    const data = await buildThemedPptx({
      layouts: [layoutXml({ name: 'Weird', shapes: [phSp({ type: 'title', rect: TITLE_RECT })] })],
      slides: [{ xml: slideXml('T'), layoutIndex: 0 }],
    });
    const analysis = await analyzePptxLayouts(await openPackage(data));
    const layout = analysis.layouts[0]!;
    expect(layout.extracted.placeholders).toHaveLength(1);
    expect(layout.extracted.placeholders[0]!.rect).toEqual({ x: 7.5, y: 10, w: 85, h: 20 });
    expect(layout.extracted.placeholders[0]!.inheritedFromMaster).toBe(false);
    expect(layout.extracted.slideCount).toBe(1);
  });

  it('inherits geometry from the master by placeholder type', async () => {
    const data = await buildThemedPptx({
      masterShapes: [phSp({ type: 'title', rect: TITLE_RECT }, 9)],
      layouts: [layoutXml({ name: 'Inherits', shapes: [phSp({ type: 'title' })] })],
      slides: [{ xml: slideXml('T'), layoutIndex: 0 }],
    });
    const analysis = await analyzePptxLayouts(await openPackage(data));
    const ph = analysis.layouts[0]!.extracted.placeholders[0]!;
    expect(ph.inheritedFromMaster).toBe(true);
    expect(ph.rect).toEqual({ x: 7.5, y: 10, w: 85, h: 20 });
  });

  it('excludes date/footer/slide-number chrome placeholders', async () => {
    const data = await buildThemedPptx({
      layouts: [
        layoutXml({
          name: 'Chromed',
          shapes: [
            phSp({ type: 'title', rect: TITLE_RECT }, 2),
            phSp({ type: 'dt', idx: 10, rect: LEFT_COL }, 5),
            phSp({ type: 'ftr', idx: 11, rect: RIGHT_COL }, 6),
            phSp({ type: 'sldNum', idx: 12, rect: PIC_LEFT }, 7),
          ],
        }),
      ],
      slides: [{ xml: slideXml('T'), layoutIndex: 0 }],
    });
    const analysis = await analyzePptxLayouts(await openPackage(data));
    const layout = analysis.layouts[0]!;
    expect(layout.extracted.placeholders).toHaveLength(1);
    expect(layout.extracted.placeholders[0]!.kind).toBe('title');
    // Title-only layout → plain (no template adds value).
    expect(layout.verdict.kind).toBe('plain');
  });
});

describe('layout classification → importer annotations', () => {
  it('annotates a title-layout slide with {[title subtitle="…"]} and omits the subtitle bullet', async () => {
    const data = await buildThemedPptx({
      layouts: [
        layoutXml({
          type: 'title',
          name: 'Title Slide',
          shapes: [
            phSp({ type: 'ctrTitle', rect: TITLE_RECT }, 2),
            phSp({ type: 'subTitle', idx: 1, rect: LEFT_COL }, 3),
          ],
        }),
      ],
      slides: [
        {
          xml: slideXml('Deck Title', [{ phType: 'subTitle', phIdx: 1, texts: ['The subtitle'] }]),
          layoutIndex: 0,
        },
      ],
    });
    const doc = await pptxToMarkdownDoc(data);
    const heading = doc.children[0] as MarkdownHeading;
    expect(heading.templateAnnotation).toEqual({
      template: 'title',
      params: { subtitle: 'The subtitle' },
    });
    // The subtitle moved into the card — no bullet list remains.
    expect(doc.children.some((b) => b.type === 'list')).toBe(false);

    // The annotation survives a stringify → parse round-trip.
    const reparsed = parseMarkdown(stringifyMarkdown(doc));
    const rtHeading = reparsed.children.find((b) => b.type === 'heading') as MarkdownHeading;
    expect(rtHeading.templateAnnotation?.template).toBe('title');
    expect(rtHeading.templateAnnotation?.params?.subtitle).toBe('The subtitle');
  });

  it('generates a custom two-column template for "Two Content" and annotates its slides', async () => {
    const data = await buildThemedPptx({
      layouts: [twoContentLayout()],
      slides: [
        {
          xml: slideXml('Side by side', [
            { phIdx: 1, texts: ['Left one', 'Left two'] },
            { phIdx: 2, texts: ['Right one'] },
          ]),
          layoutIndex: 0,
        },
      ],
    });
    const doc = await pptxToMarkdownDoc(data);

    const heading = doc.children[0] as MarkdownHeading;
    expect(heading.templateAnnotation?.template).toBe('pptx-two-content');
    // Body text still flows as bullets (nothing is lost from the document).
    const list = doc.children.find((b) => b.type === 'list') as MarkdownList;
    expect(list.children).toHaveLength(3);

    // The definition rides in frontmatter and round-trips through markdown.
    const templates = readCustomTemplatesFromFrontmatter(doc.frontmatter);
    expect(templates).toHaveLength(1);
    const def = templates![0]!;
    expect(def.name).toBe('pptx-two-content');
    expect(def.label).toBe('Two Content');

    const repeatLayer = def.layers.find((l): l is CustomTemplateLayer & TextLayer =>
      Boolean(l.repeat),
    );
    expect(repeatLayer).toBeDefined();
    expect(repeatLayer!.repeat).toEqual({ source: 'listItems', direction: 'row', gap: 5, max: 2 });
    expect(repeatLayer!.type).toBe('text');
    expect((repeatLayer as TextLayer).content.text).toBe('{item}');
    expect((repeatLayer as TextLayer).position.x).toBe('5%');
    expect((repeatLayer as TextLayer).position.width).toBe('42.5%');

    // End-to-end: the custom template resolves tokens against the slide content.
    const reparsed = parseMarkdown(stringifyMarkdown(doc));
    const squisqDoc = markdownToDoc(reparsed);
    expect(squisqDoc.customTemplates).toHaveLength(1);
    const blocks = expandDocBlocks(squisqDoc.blocks, {
      customTemplates: squisqDoc.customTemplates,
    });
    const block = blocks.find((b) => b.template === 'pptx-two-content');
    expect(block).toBeDefined();
    const textLayers = (block!.layers ?? []).filter((l): l is TextLayer => l.type === 'text');
    expect(textLayers.some((l) => l.content.text === 'Side by side')).toBe(true);
    expect(textLayers.some((l) => l.content.text === 'Left one')).toBe(true);
  });

  it('maps a picture-beside-text layout to leftFeature with image params (container path)', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
    const slideWithPic =
      `${xmlDeclaration()}<p:sld xmlns:p="${NS_PML}" xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}"><p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>Photo slide</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="2"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>Beside text</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Photo" descr="A nice photo"/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill></p:pic>` +
      `</p:spTree></p:cSld></p:sld>`;
    const build = () =>
      buildThemedPptx({
        layouts: [
          layoutXml({
            type: 'cust',
            name: 'Photo Left',
            shapes: [
              phSp({ type: 'title', rect: TITLE_RECT }, 2),
              phSp({ type: 'pic', idx: 1, rect: PIC_LEFT }, 3),
              phSp({ idx: 2, rect: TEXT_RIGHT }, 4),
            ],
          }),
        ],
        slides: [
          {
            xml: slideWithPic,
            layoutIndex: 0,
            rels: [{ id: 'rIdImg', type: REL_IMAGE, target: '../media/photo.png' }],
            media: [{ path: 'ppt/media/photo.png', data: pngBytes, contentType: 'image/png' }],
          },
        ],
      });

    // With extracted images (container path) → annotated with the image param.
    const container = await pptxToContainer(await build());
    const markdown = (await container.readDocument())!;
    const parsed = parseMarkdown(markdown);
    const heading = parsed.children.find((b) => b.type === 'heading') as MarkdownHeading;
    expect(heading.templateAnnotation?.template).toBe('leftFeature');
    expect(heading.templateAnnotation?.params?.imageSrc).toBe('images/image1.png');
    expect(heading.templateAnnotation?.params?.imageAlt).toBe('A nice photo');

    // Without extractImages → the feature verdict downgrades to plain.
    const plainDoc = await pptxToMarkdownDoc(await build());
    const plainHeading = plainDoc.children[0] as MarkdownHeading;
    expect(plainHeading.templateAnnotation).toBeUndefined();
  });

  it('skips blank layouts and leaves title-and-content plain', async () => {
    const data = await buildThemedPptx({
      layouts: [
        layoutXml({ type: 'blank', name: 'Blank', shapes: [] }),
        layoutXml({
          type: 'obj',
          name: 'Title and Content',
          shapes: [
            phSp({ type: 'title', rect: TITLE_RECT }, 2),
            phSp({ idx: 1, rect: LEFT_COL }, 3),
          ],
        }),
      ],
      slides: [
        { xml: slideXml('On blank', [{ texts: ['stray text'] }]), layoutIndex: 0 },
        { xml: slideXml('Normal', [{ phIdx: 1, texts: ['a bullet'] }]), layoutIndex: 1 },
      ],
    });
    const doc = await pptxToMarkdownDoc(data);
    const headings = doc.children.filter((b) => b.type === 'heading') as MarkdownHeading[];
    expect(headings[0]!.templateAnnotation).toBeUndefined();
    expect(headings[1]!.templateAnnotation).toBeUndefined();
    // Content still converts on both slides.
    expect(doc.children.filter((b) => b.type === 'list')).toHaveLength(2);
    // No custom templates were generated → no frontmatter payload.
    expect(doc.frontmatter?.['squisq-custom-templates']).toBeUndefined();
  });

  it('deduplicates: two slides on one layout share a single definition', async () => {
    const data = await buildThemedPptx({
      layouts: [twoContentLayout()],
      slides: [
        { xml: slideXml('One', [{ phIdx: 1, texts: ['a'] }]), layoutIndex: 0 },
        { xml: slideXml('Two', [{ phIdx: 1, texts: ['b'] }]), layoutIndex: 0 },
      ],
    });
    const doc = await pptxToMarkdownDoc(data);
    const headings = doc.children.filter((b) => b.type === 'heading') as MarkdownHeading[];
    expect(headings[0]!.templateAnnotation?.template).toBe('pptx-two-content');
    expect(headings[1]!.templateAnnotation?.template).toBe('pptx-two-content');
    expect(readCustomTemplatesFromFrontmatter(doc.frontmatter)).toHaveLength(1);
  });

  it('builds twoColumn comparison params from idx-matched texts, downgrading when headers are missing', async () => {
    const HEADER_L = { x: 609600, y: 1371600, cx: 5181600, cy: 685800 }; // 5,20,42.5,10
    const HEADER_R = { x: 6400800, y: 1371600, cx: 5181600, cy: 685800 };
    const BODY_L = { x: 609600, y: 2286000, cx: 5181600, cy: 3429000 }; // 5,33.33,42.5,50
    const BODY_R = { x: 6400800, y: 2286000, cx: 5181600, cy: 3429000 };
    const comparisonLayout = layoutXml({
      type: 'twoTxTwoObj',
      name: 'Comparison',
      shapes: [
        phSp({ type: 'title', rect: TITLE_RECT }, 2),
        phSp({ type: 'body', idx: 1, rect: HEADER_L }, 3),
        phSp({ type: 'body', idx: 2, rect: HEADER_R }, 4),
        phSp({ idx: 3, rect: BODY_L }, 5),
        phSp({ idx: 4, rect: BODY_R }, 6),
      ],
    });
    const data = await buildThemedPptx({
      layouts: [comparisonLayout],
      slides: [
        {
          xml: slideXml('Compare', [
            { phType: 'body', phIdx: 1, texts: ['Alpha'] },
            { phType: 'body', phIdx: 2, texts: ['Beta'] },
            { phIdx: 3, texts: ['fast'] },
            { phIdx: 4, texts: ['steady'] },
          ]),
          layoutIndex: 0,
        },
        {
          // Missing the right header text → no annotation.
          xml: slideXml('Half compare', [{ phType: 'body', phIdx: 1, texts: ['Alpha'] }]),
          layoutIndex: 0,
        },
      ],
    });
    const doc = await pptxToMarkdownDoc(data);
    const headings = doc.children.filter((b) => b.type === 'heading') as MarkdownHeading[];
    expect(headings[0]!.templateAnnotation).toEqual({
      template: 'twoColumn',
      params: { left: 'Alpha|fast', right: 'Beta|steady' },
    });
    expect(headings[1]!.templateAnnotation).toBeUndefined();
  });

  it('caps generated templates at maxTemplates, keeping the most-used layouts', async () => {
    const data = await buildThemedPptx({
      layouts: [twoContentLayout('Grid A'), twoContentLayout('Grid B'), twoContentLayout('Grid C')],
      slides: [
        { xml: slideXml('a1', [{ phIdx: 1, texts: ['x'] }]), layoutIndex: 0 },
        { xml: slideXml('a2', [{ phIdx: 1, texts: ['x'] }]), layoutIndex: 0 },
        { xml: slideXml('b1', [{ phIdx: 1, texts: ['x'] }]), layoutIndex: 1 },
        { xml: slideXml('b2', [{ phIdx: 1, texts: ['x'] }]), layoutIndex: 1 },
        { xml: slideXml('c1', [{ phIdx: 1, texts: ['x'] }]), layoutIndex: 2 },
      ],
    });
    const analysis = await analyzePptxLayouts(await openPackage(data), { maxTemplates: 2 });
    const verdicts = analysis.layouts.map((l) => l.verdict.kind);
    expect(verdicts.filter((k) => k === 'custom')).toHaveLength(2);
    // The least-used layout (Grid C, 1 slide) was downgraded.
    const gridC = analysis.layouts.find((l) => l.extracted.name === 'Grid C')!;
    expect(gridC.verdict.kind).toBe('plain');
    expect(analysis.warnings.some((w) => w.includes('kept the 2 most used'))).toBe(true);
  });

  it('uses a portrait viewport for portrait decks', async () => {
    const data = await buildThemedPptx({
      sldSz: { cx: 6858000, cy: 12192000 },
      layouts: [
        layoutXml({
          name: 'Tall Two',
          shapes: [
            phSp({ type: 'title', rect: { x: 342900, y: 609600, cx: 6172200, cy: 1219200 } }, 2),
            phSp({ idx: 1, rect: { x: 342900, y: 2438400, cx: 2743200, cy: 7315200 } }, 3),
            phSp({ idx: 2, rect: { x: 3771900, y: 2438400, cx: 2743200, cy: 7315200 } }, 4),
          ],
        }),
      ],
      slides: [{ xml: slideXml('Tall', [{ phIdx: 1, texts: ['x'] }]), layoutIndex: 0 }],
    });
    const analysis = await analyzePptxLayouts(await openPackage(data));
    const verdict = analysis.layouts[0]!.verdict;
    expect(verdict.kind).toBe('custom');
    if (verdict.kind === 'custom') {
      expect(verdict.def.viewport).toEqual({ width: 1080, height: 1920 });
    }
  });
});

describe('inspectPptxLayouts', () => {
  it('summarizes verdicts, includes built-in matches, and can list unused layouts', async () => {
    const data = await buildThemedPptx({
      layouts: [
        layoutXml({
          type: 'title',
          name: 'Title Slide',
          shapes: [phSp({ type: 'ctrTitle', rect: TITLE_RECT }, 2)],
        }),
        twoContentLayout(),
        layoutXml({ type: 'blank', name: 'Blank', shapes: [] }),
      ],
      slides: [
        { xml: slideXml('T'), layoutIndex: 0 },
        { xml: slideXml('S', [{ phIdx: 1, texts: ['x'] }]), layoutIndex: 1 },
      ],
    });

    const usedOnly = await inspectPptxLayouts(data);
    expect(usedOnly.layouts).toHaveLength(2);
    expect(usedOnly.slideSize).toEqual({ cx: 12192000, cy: 6858000 });

    const titleRow = usedOnly.layouts.find((l) => l.name === 'Title Slide')!;
    expect(titleRow.verdict).toBe('builtin');
    expect(titleRow.builtinTemplate).toBe('title');
    expect(titleRow.slideCount).toBe(1);

    const twoRow = usedOnly.layouts.find((l) => l.name === 'Two Content')!;
    expect(twoRow.verdict).toBe('custom');
    expect(twoRow.customTemplate?.name).toBe('pptx-two-content');

    const all = await inspectPptxLayouts(data, { includeUnused: true });
    expect(all.layouts).toHaveLength(3);
    const blankRow = all.layouts.find((l) => l.name === 'Blank')!;
    expect(blankRow.verdict).toBe('skip');
    expect(blankRow.slideCount).toBe(0);
  });
});
