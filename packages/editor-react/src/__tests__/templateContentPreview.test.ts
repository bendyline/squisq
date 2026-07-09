import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { resolveTemplateContentPreview } from '../TemplateContentPreview';
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
});
