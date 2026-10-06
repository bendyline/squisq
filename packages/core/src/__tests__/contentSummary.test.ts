import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { stringifyMarkdown } from '../markdown/stringify.js';
import { extractPlainText } from '../markdown/utils.js';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { docToMarkdown } from '../doc/docToMarkdown.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import {
  applyTransform,
  getTransformStyleSummaries,
  createTransformStyleRegistry,
  resolveTransformStyle,
} from '../transform/index.js';
import { isTemplateBlock } from '../schemas/BlockTemplates.js';
import type { Block, Doc, Layer } from '../schemas/Doc.js';

function source(markdown: string, cover = false): Doc {
  return markdownToDoc(parseMarkdown(markdown), { generateCoverBlock: cover });
}
function layers(block: Block): Layer[] {
  const result = materializeBlockLayers(block, { persistentLayers: false });
  expect(result.diagnostic).toBeUndefined();
  return result.layers;
}
function visibleText(block: Block): string {
  return layers(block)
    .flatMap((layer) => (layer.type === 'text' ? [layer.content.text] : []))
    .join('\n');
}

describe('Headings and features summaries', () => {
  it('uses every heading in document order, without body prose or source mutation', () => {
    const doc = source(
      '# Parent\n\nParent prose that belongs only to this section.\n\n## Child\n\nChild prose that must stay out of the presentation.\n\n### Detail\n\n- List prose is not a heading.\n\n## Next\n\n> Quoted prose also stays out.',
    );
    const before = JSON.stringify(doc);
    const result = applyTransform(doc, 'headings-and-features');
    const slides = buildPreviewDoc(result.doc).blocks;
    expect(slides.map((slide) => slide.title)).toEqual(['Parent', 'Child', 'Detail', 'Next']);
    expect(slides.map(visibleText)).toEqual(['Parent', 'Child', 'Detail', 'Next']);
    expect(slides.every((slide) => !slide.children?.length)).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
    expect(result.stats.transformedBlocks).toBe(4);
    const markdown = stringifyMarkdown(docToMarkdown(result.doc));
    expect(markdown).toContain('### Detail');
    expect(markdown).not.toContain('prose');
  });

  it('works for single-word headings and visual-only sections', () => {
    const doc = source('# Intro\n\n## Photo\n\n![A feature](photo.png)\n\n## End');
    const slides = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks;
    expect(slides.map((slide) => slide.title)).toEqual(['Intro', 'Photo', 'End']);
    expect(layers(slides[1]).filter((layer) => layer.type === 'image')).toHaveLength(1);
  });

  it('keeps all scoped images, videos and Mermaid on the owning slide without interleaving', () => {
    const doc = source(
      '# Features\n\nProse beside ![First](first.png) that should disappear.\n\n- ![Second](second.png) with more prose.\n\n[Demo](demo.mp4)\n\n```mermaid\ngraph LR\n  A --> B\n```\n\n## Child\n\n![Child only](child.png)',
    );
    const slides = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks;
    expect(slides).toHaveLength(2);
    const first = layers(slides[0]);
    expect(
      first.filter((layer) => layer.type === 'image').map((layer) => layer.content.src),
    ).toEqual(['first.png', 'second.png']);
    expect(first.find((layer) => layer.type === 'video')?.content).toMatchObject({
      src: 'demo.mp4',
    });
    expect(first.find((layer) => layer.type === 'mermaid')?.content).toMatchObject({
      source: 'graph LR\n  A --> B',
    });
    expect(visibleText(slides[0])).toBe('Features');
    expect(
      layers(slides[1])
        .filter((layer) => layer.type === 'image')
        .map((layer) => layer.content.src),
    ).toEqual(['child.png']);
  });

  it('retains HTML media and inline video clip timing, stripping HTML prose', () => {
    const doc = source(
      '# Media\n\n<div><p>HTML prose disappears.</p><img src="resized.png" width="640" height="320"><video src="demo.mp4" data-squisq-video-start-at="2" data-squisq-video-clip-start="4" data-squisq-video-clip-end="9"></video></div>',
    );
    const slide = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks[0];
    const rendered = layers(slide);
    expect(rendered.find((layer) => layer.type === 'image')?.content).toMatchObject({
      src: 'resized.png',
    });
    expect(rendered.find((layer) => layer.type === 'video')?.content).toMatchObject({
      src: 'demo.mp4',
      startAt: 2,
      clipStart: 4,
      clipEnd: 9,
    });
    expect(JSON.stringify(slide.contents)).not.toContain('HTML prose');
    expect(visibleText(slide)).toBe('Media');
  });

  it('keeps ASCII diagrams and trees while removing ordinary code and narrative text', () => {
    const doc = source(
      '# Diagram\n\nNarrative explanation is not part of the visual.\n\n```diagram\n┌──────┐    ┌──────┐\n│ One  │───▶│ Two  │\n└──────┘    └──────┘\n```\n\n```tree\nsrc/\n├── main.ts\n└── lib.ts\n```\n\n```ts\nconst prose = "ordinary source code is excluded";\n```',
    );
    const slides = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks;
    expect(slides).toHaveLength(1);
    const rendered = layers(slides[0]);
    expect(rendered.some((layer) => layer.type === 'tree')).toBe(true);
    expect(visibleText(slides[0])).toContain('One');
    expect(visibleText(slides[0])).toContain('Two');
    expect(visibleText(slides[0])).not.toContain('Narrative');
    expect(JSON.stringify(slides[0].contents)).not.toContain('ordinary source code');
  });

  it('preserves table/chart features without their accompanying prose', () => {
    const doc = source(
      '# Results {[barChart]}\n\nLong context for the numbers should disappear.\n\n| Item | Value |\n| --- | --- |\n| First | 10 |\n| Second | 20 |',
    );
    const slide = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks[0];
    expect(slide.template).toBe('barChart');
    expect(visibleText(slide)).toContain('First');
    expect(visibleText(slide)).not.toContain('Long context');
  });

  it('retains diagram-owned child nodes without turning them into separate slides', () => {
    const doc = source(
      '# Flow {[diagram]}\n\n## Input {#input x=0 y=0 connectsTo=output}\n\n## Output {#output x=10 y=0}',
    );
    const slides = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks;
    expect(slides).toHaveLength(1);
    expect(slides[0].children).toHaveLength(2);
    expect(visibleText(slides[0])).toContain('Input');
    expect(visibleText(slides[0])).toContain('Output');
  });

  it('respects an authored stat template, removes prose, and removes the cover subtitle', () => {
    const doc = source(
      '# Title\n\nA long paragraph that becomes the inferred cover subtitle.\n\n## Stat {[statHighlight stat=42 description="Hidden description"]}\n\nMany more narrative words that are not visual features.',
      true,
    );
    const result = applyTransform(doc, 'headings-and-features').doc;
    expect(result.startBlock?.subtitle).toBeUndefined();
    const slides = buildPreviewDoc(result).blocks;
    expect(slides[1].template).toBe('statHighlight');
    expect(slides.map(visibleText)).toEqual(['Title', '42\nStat']);
    expect(doc.startBlock?.subtitle).toContain('long paragraph');
  });

  it('keeps source timing and scheduled media for narration', () => {
    const doc = source('# One\n\nFirst section.\n\n## Two\n\nSecond section.');
    const flat = flattenRenderableBlocks(doc.blocks);
    flat[0].startTime = 0;
    flat[0].duration = 35;
    flat[1].startTime = 35;
    flat[1].duration = 45;
    doc.duration = 80;
    doc.documentMedia = [
      { id: 'narration', kind: 'audio', src: 'narration.webm', anchor: 'document', startAt: 0 },
    ];
    const result = applyTransform(doc, 'headings-and-features').doc;
    expect(result.blocks.map((block) => [block.startTime, block.duration])).toEqual([
      [0, 35],
      [35, 45],
    ]);
    expect(result.blocks.map((block) => block.sourceBlockId)).toEqual(
      flat.map((block) => block.id),
    );
    expect(result.documentMedia).toEqual(doc.documentMedia);
  });

  it('is advertised through the shared registry and validates custom content policies', () => {
    expect(getTransformStyleSummaries()).toContainEqual(
      expect.objectContaining({ id: 'headings-and-features', name: 'Headings and features' }),
    );
    const custom = { ...resolveTransformStyle('minimal'), id: 'custom-brief' };
    expect(createTransformStyleRegistry([custom]).get('custom-brief')?.contentMode).toBe('brief');
    expect(() =>
      createTransformStyleRegistry([{ ...custom, contentMode: 'invalid' as 'brief' }]),
    ).toThrow(/contentMode/);
  });

  it('retains media supplied only through explicit template inputs', () => {
    const doc = source(
      '# Photo {[imageWithCaption imageSrc=photo.png caption="Body caption"]}\n\nProse disappears.\n\n## Video {[videoWithCaption videoSrc=demo.mp4 posterSrc=poster.png]}\n\nMore prose disappears.',
    );
    const slides = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks;
    expect(layers(slides[0]).find((layer) => layer.type === 'image')?.content).toMatchObject({
      src: 'photo.png',
    });
    expect(layers(slides[1]).find((layer) => layer.type === 'video')?.content).toMatchObject({
      src: 'demo.mp4',
      posterSrc: 'poster.png',
    });
    expect(slides.map(visibleText)).toEqual(['Photo', 'Video']);
    expect(slides.map((slide) => slide.template)).toEqual(['imageWithCaption', 'videoWithCaption']);
  });

  it.each(['leftFeature', 'rightFeature'])(
    'keeps an authored %s with title-only contained imagery',
    (template) => {
      const doc = source(
        `# Feature {[${template} imageSrc=photo.png body="Hidden typed body"]}\n\nHidden body prose.`,
      );
      const before = JSON.stringify(doc);
      const slide = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks[0];
      expect(slide.template).toBe(template);
      expect(slide.summaryLayout).toBeUndefined();
      expect(visibleText(slide)).toBe('Feature');
      expect(layers(slide).find((layer) => layer.type === 'image')).toMatchObject({
        content: { src: 'photo.png', fit: 'contain' },
        position: { width: '60%', height: '90%', x: template === 'leftFeature' ? '5%' : '35%' },
      });
      expect(JSON.stringify(doc)).toBe(before);
    },
  );

  it('respects explicit list/content templates without reintroducing prose or placeholder items', () => {
    const doc = source(
      '# List {[list items="Hidden,Items"]}\n\n- Hidden list prose\n\n## Content {[content]}\n\nHidden prose.\n\n![Feature alt](feature.png)',
    );
    const slides = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks;
    expect(slides.map((slide) => slide.template)).toEqual(['list', 'content']);
    expect(slides.map(visibleText)).toEqual(['List', 'Content']);
    expect(layers(slides[1]).filter((layer) => layer.type === 'image')).toHaveLength(1);
  });

  it.each([0.5, 1, 16 / 9, 3])(
    'uses more feature area for aspect ratio %s, leaving title margins',
    (aspect) => {
      const doc = source(
        `# Seeing this in action\n\n<img src="feature.png" width="${aspect * 1000}" height="1000">`,
      );
      const slide = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks[0];
      const rendered = layers(slide);
      const image = rendered.find((layer) => layer.type === 'image')!;
      const title = rendered.find((layer) => layer.type === 'text')!;
      expect(slide.summaryLayout).toBe('feature');
      expect(image.content.fit).toBe('contain');
      expect(Number(image.position.height)).toBeGreaterThan(1080 * 0.79);
      expect(Number(image.position.x)).toBeGreaterThanOrEqual(40);
      expect(Number(image.position.y)).toBeGreaterThanOrEqual(40);
      expect(Number(image.position.x) + Number(image.position.width)).toBeLessThanOrEqual(
        1920 - 40,
      );
      expect(Number(image.position.y) + Number(image.position.height)).toBeLessThanOrEqual(
        1080 - 40,
      );
      if (aspect <= 1) {
        expect(title.position.anchor).toBe('top-left');
        expect(Number(title.position.x) + Number(title.position.width)).toBeLessThan(
          Number(image.position.x),
        );
      } else {
        expect(title.position.anchor).toBe('center');
        expect(Number(title.position.y) + Number(title.position.height) / 2).toBeLessThan(
          Number(image.position.y),
        );
      }
    },
  );

  it('uses intrinsic ratios when Markdown omits dimensions, without changing authored layouts', () => {
    const doc = source('# Feature\n\n![Feature](feature.png)');
    const slide = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks[0];
    const initial = layers(slide).find((layer) => layer.type === 'image')!;
    const measured = materializeBlockLayers(slide, {
      persistentLayers: false,
      mediaAspectRatios: { 'feature.png': 0.5 },
    }).layers;
    const image = measured.find((layer) => layer.type === 'image')!;
    expect(Number(image.position.height)).toBeGreaterThan(Number(initial.position.height));
    expect(measured.find((layer) => layer.type === 'text')?.position.anchor).toBe('top-left');
  });

  it.each([
    { width: 1080, height: 1920 },
    { width: 1080, height: 1080 },
  ])('keeps long titles and multiple features inside a $width × $height slide', (viewport) => {
    const doc = source(
      '# A long heading about making images and diagrams easier to see while keeping comfortable margins on the slide\n\n![First](first.png)\n\n![Second](second.png)',
    );
    const slide = buildPreviewDoc(applyTransform(doc, 'headings-and-features').doc).blocks[0];
    const rendered = materializeBlockLayers(slide, {
      viewport: { ...viewport, name: 'Summary test' },
      persistentLayers: false,
      mediaAspectRatios: { 'first.png': 0.6, 'second.png': 1 },
    }).layers;
    const images = rendered.filter((layer) => layer.type === 'image');
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(Number(image.position.x)).toBeGreaterThan(0);
      expect(Number(image.position.y)).toBeGreaterThan(0);
      expect(Number(image.position.x) + Number(image.position.width)).toBeLessThan(viewport.width);
      expect(Number(image.position.y) + Number(image.position.height)).toBeLessThan(
        viewport.height,
      );
    }
    const title = rendered.find((layer) => layer.type === 'text')!;
    const bottom =
      Number(title.position.y) +
      Number(title.position.height) / (title.position.anchor === 'center' ? 2 : 1);
    if (title.position.anchor === 'center') {
      expect(bottom).toBeLessThan(Number(images[0].position.y));
    } else {
      expect(Number(title.position.x) + Number(title.position.width)).toBeLessThan(
        Number(images[0].position.x),
      );
    }
  });
});

describe('Minimal content summaries', () => {
  it('bounds every unpromoted section and cover subtitle, retaining nested headings and features', () => {
    const long =
      'This opening sentence contains deliberately repetitive narrative words to represent the very long paragraphs people write in documents before turning them into presentation slides without rewriting all of their content by hand. Later paragraphs must disappear.';
    const doc = source(`# Parent\n\n${long}\n\n![Feature](photo.png)\n\n## Child\n\n${long}`, true);
    const before = JSON.stringify(doc);
    const result = applyTransform(doc, 'minimal').doc;
    const slides = buildPreviewDoc(result).blocks;
    expect(slides.map((block) => block.title)).toEqual(['Parent', 'Child']);
    for (const slide of slides) {
      const text = (slide.contents ?? [])
        .filter((node) => node.type === 'paragraph')
        .map(extractPlainText)
        .join(' ')
        .trim();
      expect(text.split(/\s+/)).toHaveLength(24);
      expect(text.length).toBeLessThanOrEqual(180);
      expect(text).not.toContain('Later paragraphs');
    }
    expect(layers(slides[0]).some((layer) => layer.type === 'image')).toBe(true);
    expect(result.startBlock?.subtitle?.split(/\s+/).length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('bounds promoted quotes and stat descriptions as well as unselected prose', () => {
    const words = 'carefully chosen words '.repeat(35);
    const doc = source(
      `# Quote\n\n> "${words}"\n\n## Stat\n\nRevenue increased 42% across ${words}.\n\n## Plain\n\n${words}`,
    );
    const result = applyTransform(doc, 'minimal', { overrides: { transformRatio: 1 } }).doc;
    let highlights = 0;
    for (const block of result.blocks) {
      if (
        !isTemplateBlock(block) ||
        (block.template !== 'quote' && block.template !== 'statHighlight')
      )
        continue;
      highlights++;
      const text = block.template === 'quote' ? block.quote : block.description;
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(24);
      expect(text.length).toBeLessThanOrEqual(180);
    }
    expect(highlights).toBeGreaterThan(0);
    const slides = buildPreviewDoc(result).blocks;
    expect(slides.map(visibleText).join(' ')).not.toContain(words);
  });
});
