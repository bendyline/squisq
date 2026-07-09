import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  resolveTemplateContentPreview,
  resolveTemplateContentPreviewResult,
} from '../TemplateContentPreview';
import type { TemplatePreviewSource } from '../TemplateContentPreview';

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
      warning: 'No audio/video found in this block',
    });

    expect(
      resolveTemplateContentPreviewResult('videoPullQuote', previewSource('## About Squisq')),
    ).toMatchObject({
      visual: null,
      warning: 'No audio/video found in this block',
    });
  });

  it('does not warn about missing media when an audio or video tag is present', () => {
    expect(
      resolveTemplateContentPreviewResult(
        'videoWithCaption',
        previewSource('## Demo\n\n<video src="media/demo.mp4" controls></video>'),
      ).warning,
    ).toBeUndefined();

    expect(
      resolveTemplateContentPreviewResult(
        'videoPullQuote',
        previewSource('## Narration\n\n<audio src="audio/narration.webm" controls></audio>'),
      ).warning,
    ).toBeUndefined();
  });
});
