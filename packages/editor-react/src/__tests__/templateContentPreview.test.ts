import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  resolveTemplateContentPreview,
  resolveTemplateContentPreviewResult,
  type TemplatePreviewSource,
} from '../templateContentPreviewResolver';

function previewSource(markdown: string): TemplatePreviewSource {
  const doc = markdownToDoc(parseMarkdown(markdown), { autoTemplates: false });
  const block = doc.blocks[0];
  if (!block) throw new Error('expected markdown to produce a block');
  return {
    block,
    theme: DEFAULT_THEME,
    viewport: VIEWPORT_PRESETS.landscape,
    basePath: '/',
  };
}

describe('template content previews', () => {
  it('renders a candidate preview from the active block content', () => {
    const visual = resolveTemplateContentPreview(
      'list',
      previewSource(`## Launch Steps

- Draft the outline
- Review the visuals
- Publish the page
`),
    );

    expect(visual).toBeTruthy();
    expect(JSON.stringify(visual?.layers)).toContain('Draft the outline');
  });

  it('previews alternative treatments of mixed prose and lists without a blanket warning', () => {
    const source = previewSource(`### What's in a model name

Take: Qwen 3.6 35B-A3B-Q4

- Family
- Series

Dense vs Mixture of Experts (MoE)

- All parameters
- A subset`);
    const content = resolveTemplateContentPreviewResult('content', source);
    const body = content.visual?.layers?.find((layer) => layer.id === 'body');

    expect(body && body.type === 'text' ? body.content.html : '').toContain(
      '</ul><p>Dense vs Mixture of Experts (MoE)</p><ul>',
    );
    for (const templateName of ['list', 'statHighlight', 'twoColumn', 'title']) {
      const result = resolveTemplateContentPreviewResult(templateName, source);
      expect(result.visual, templateName).not.toBeNull();
      expect(result.warning, templateName).toBeUndefined();
    }
    const list = resolveTemplateContentPreviewResult('list', source);
    expect(JSON.stringify(list.visual?.layers)).toContain('Family');
    expect(JSON.stringify(list.visual?.layers)).toContain('All parameters');
  });

  it('falls back for content-specific templates when the block is too sparse', () => {
    const visual = resolveTemplateContentPreview('list', previewSource('## About Squisq'));

    expect(visual).toBeNull();
  });

  it('reports why stat and date previews cannot be derived', () => {
    expect(
      resolveTemplateContentPreviewResult('statHighlight', previewSource('## About Squisq')),
    ).toMatchObject({
      visual: null,
      warning: 'No stat found in this block',
    });

    expect(
      resolveTemplateContentPreviewResult('dateEvent', previewSource('## About Squisq')),
    ).toMatchObject({
      visual: null,
      warning: 'No date found in this block',
    });
  });

  it('reports why image previews cannot be derived', () => {
    expect(
      resolveTemplateContentPreviewResult('imageWithCaption', previewSource('## About Squisq')),
    ).toMatchObject({
      visual: null,
      warning: 'No image found in this block',
    });
  });

  it('reports why video previews cannot be derived without media', () => {
    expect(
      resolveTemplateContentPreviewResult('videoWithCaption', previewSource('## About Squisq')),
    ).toMatchObject({
      visual: null,
      warning: 'No video found in this block',
    });

    expect(
      resolveTemplateContentPreviewResult('videoPullQuote', previewSource('## About Squisq')),
    ).toMatchObject({
      visual: null,
      warning: 'No video found in this block',
    });
  });

  it('renders an embedded video and does not mistake audio for video', () => {
    const source = previewSource('## Demo\n\n<video src="media/demo.mp4" controls></video>');
    for (const templateName of ['videoWithCaption', 'videoPullQuote']) {
      const preview = resolveTemplateContentPreviewResult(templateName, source);
      expect(preview.warning).toBeUndefined();
      expect(
        preview.visual?.layers?.some(
          (layer) => layer.type === 'video' && layer.content.src === 'media/demo.mp4',
        ),
      ).toBe(true);
    }

    expect(
      resolveTemplateContentPreviewResult(
        'videoPullQuote',
        previewSource('## Narration\n\n<audio src="audio/narration.webm" controls></audio>'),
      ),
    ).toMatchObject({ visual: null, warning: 'No video found in this block' });
  });

  it('keeps feature previews for images alongside prose and lists', () => {
    const source = previewSource(`## Model Notebook

Supporting context.

- Search the notes
- Ground the response

![Architecture](media/architecture.png)`);
    for (const templateName of ['leftFeature', 'rightFeature', 'imageWithCaption', 'pullQuote']) {
      const result = resolveTemplateContentPreviewResult(templateName, source);
      expect(result.warning, templateName).toBeUndefined();
      expect(
        result.visual?.layers?.some(
          (layer) => layer.type === 'image' && layer.content.src === 'media/architecture.png',
        ),
        templateName,
      ).toBe(true);
    }
  });

  it('previews Mermaid diagrams in the primary left and right feature cells', () => {
    const source = previewSource(
      '## RAG: Giving the Model a Notebook {[rightFeature]}\n\n```mermaid\nstateDiagram-v2\n[*] --> Chunk\nChunk --> Store\n```',
    );
    for (const templateName of ['rightFeature', 'leftFeature']) {
      const result = resolveTemplateContentPreviewResult(templateName, source);
      expect(result.warning, templateName).toBeUndefined();
      const diagram = result.visual?.layers?.find((layer) => layer.type === 'mermaid');
      expect(diagram?.position).toEqual({
        x: templateName === 'leftFeature' ? 0 : 960,
        y: 0,
        width: 960,
        height: 1080,
      });
    }
  });

  it('recognizes authored image params when previewing the current or another feature template', () => {
    const source = previewSource('## Architecture {[rightFeature imageSrc="media/authored.png"]}');
    const original = JSON.stringify(source.block);
    for (const templateName of ['rightFeature', 'leftFeature', 'imageWithCaption']) {
      const result = resolveTemplateContentPreviewResult(templateName, source);
      expect(result.warning, templateName).toBeUndefined();
      expect(
        result.visual?.layers?.some(
          (layer) => layer.type === 'image' && layer.content.src === 'media/authored.png',
        ),
        templateName,
      ).toBe(true);
    }
    expect(JSON.stringify(source.block)).toBe(original);
  });

  it('recognizes authored stats, dates and comparisons instead of requiring body matches', () => {
    for (const [templateName, markdown, expectedText] of [
      ['statHighlight', '## Adoption {[statHighlight stat="89%"]}', '89%'],
      ['dateEvent', '## Launch {[dateEvent date="Tomorrow"]}', 'Tomorrow'],
      [
        'comparisonBar',
        '## Comparison {[comparisonBar leftLabel="Before" leftValue="0" rightLabel="After" rightValue="12"]}',
        'After',
      ],
    ]) {
      const result = resolveTemplateContentPreviewResult(templateName, previewSource(markdown));
      expect(result.visual, templateName).not.toBeNull();
      expect(result.warning, templateName).toBeUndefined();
      expect(JSON.stringify(result.visual?.layers), templateName).toContain(expectedText);
    }
  });

  it('respects a heading already authored as a stat, date or quote', () => {
    for (const [templateName, markdown, expectedText] of [
      ['statHighlight', '## Sold Out {[statHighlight]}', 'Sold Out'],
      ['dateEvent', '## Tomorrow {[dateEvent]}', 'Tomorrow'],
      ['quote', '## Stay curious {[quote]}', 'Stay curious'],
    ]) {
      const result = resolveTemplateContentPreviewResult(templateName, previewSource(markdown));
      expect(result.warning, templateName).toBeUndefined();
      expect(JSON.stringify(result.visual?.layers), templateName).toContain(expectedText);
    }
  });

  it('does not treat decorative params as missing content being supplied', () => {
    expect(
      resolveTemplateContentPreviewResult(
        'imageWithCaption',
        previewSource('## About {[imageWithCaption colorScheme="blue"]}'),
      ),
    ).toMatchObject({ visual: null, warning: 'No image found in this block' });
    expect(
      resolveTemplateContentPreviewResult(
        'list',
        previewSource('## About {[list colorScheme="blue"]}'),
      ),
    ).toMatchObject({ visual: null, warning: 'No list found in this block' });
    expect(
      resolveTemplateContentPreviewResult('map', previewSource('## About {[map mapStyle="road"]}')),
    ).toMatchObject({ visual: null, warning: 'No map location found in this block' });
  });

  it('recognizes structured template data and raw typed inputs', () => {
    const imageSource = previewSource('## Architecture');
    imageSource.block.template = 'rightFeature';
    imageSource.block.templateData = { imageSrc: 'media/structured.png' };
    for (const templateName of ['rightFeature', 'leftFeature']) {
      const imagePreview = resolveTemplateContentPreviewResult(templateName, imageSource);
      expect(imagePreview.warning).toBeUndefined();
      expect(JSON.stringify(imagePreview.visual?.layers)).toContain('media/structured.png');
    }

    const tableSource = previewSource('## Totals');
    Object.assign(tableSource.block, { headers: ['Category', 'Total'], rows: [['Revenue', '42']] });
    const tablePreview = resolveTemplateContentPreviewResult('dataTable', tableSource);
    expect(tablePreview.warning).toBeUndefined();
    expect(JSON.stringify(tablePreview.visual?.layers)).toContain('Revenue');
  });

  it('uses authored data fences across template choices', () => {
    const source = previewSource(
      '## Adoption\n\n```json data\n{"stat":"89%","description":"Teams using Squisq"}\n```',
    );
    const result = resolveTemplateContentPreviewResult('statHighlight', source);
    expect(result.warning).toBeUndefined();
    expect(JSON.stringify(result.visual?.layers)).toContain('89%');
    expect(JSON.stringify(result.visual?.layers)).toContain('Teams using Squisq');
  });

  it('distinguishes scheduled video from the inline video a template needs', () => {
    const source = previewSource(
      '## Recording\n\n{[video src=media/recording.mp4 placement=picture-in-picture]}',
    );
    expect(source.block.media?.[0].kind).toBe('video');
    expect(resolveTemplateContentPreviewResult('videoWithCaption', source)).toMatchObject({
      visual: null,
      warning: "This template needs an inline video; this block's video plays separately",
    });
  });

  it('distinguishes a single image from no images for the photo grid', () => {
    expect(
      resolveTemplateContentPreviewResult(
        'photoGrid',
        previewSource('## Gallery\n\n![One](media/one.png)'),
      ),
    ).toMatchObject({ visual: null, warning: 'Photo Grid needs at least two images' });
  });

  it('previews diagrams authored in a body fence', () => {
    const result = resolveTemplateContentPreviewResult(
      'diagram',
      previewSource(`## Flow

\`\`\`diagram
┌────────┐       ┌────────┐
│ Input  │──────▶│ Output │
└────────┘       └────────┘
\`\`\``),
    );
    expect(result.visual).not.toBeNull();
    expect(result.warning).toBeUndefined();
    expect(JSON.stringify(result.visual?.layers)).toContain('Output');
  });
});
