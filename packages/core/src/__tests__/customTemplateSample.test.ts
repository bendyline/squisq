/**
 * End-to-end sanity check: the kind of doc a user might compose by
 * hand (or via the upcoming TemplateDesigner) renders through the
 * markdown → Doc → expanded layers pipeline with tokens substituted.
 *
 * Build-the-payload-here so the test doesn't depend on the site
 * package — it's verifying the pure pipeline.
 */

import { describe, it, expect } from 'vitest';
import { markdownToDoc } from '../doc/markdownToDoc';
import { expandDocBlocks } from '../doc/templates/index';
import { parseMarkdown } from '../markdown/parse';
import { writeCustomTemplatesToFrontmatter } from '../doc/customTemplatesFrontmatter';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import type { TextLayer } from '../schemas/Doc.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';

const heroDef: CustomTemplateDefinition = {
  name: 'hero',
  label: 'Hero Section',
  viewport: { width: 1920, height: 1080 },
  layers: [
    {
      id: 'hero-title',
      type: 'text',
      position: { x: '6%', y: '20%', width: '88%' },
      content: {
        text: '{title}',
        style: { fontSize: 96, color: '#0f172a' },
      },
    },
    {
      id: 'hero-body',
      type: 'text',
      position: { x: '6%', y: '52%', width: '88%' },
      content: {
        text: '{content}',
        style: { fontSize: 36, color: '#475569' },
      },
    },
  ],
};

function buildSampleMarkdown(): string {
  const payload = writeCustomTemplatesToFrontmatter([heroDef]);
  return `---
squisq-custom-templates: "${payload}"
---

# Welcome to Squisq {[hero]}

A small editor for big ideas.
`;
}

describe('Custom template pipeline (markdown → expanded layers)', () => {
  it('substitutes {title} and {content} when a doc uses a frontmatter-defined template', () => {
    const doc = markdownToDoc(parseMarkdown(buildSampleMarkdown()));
    const blocks = expandDocBlocks(doc.blocks, {
      customTemplates: doc.customTemplates,
    });
    expect(blocks).toHaveLength(1);
    const layers = blocks[0].layers ?? [];
    expect(layers).toHaveLength(2);

    expect((layers[0] as TextLayer).content.text).toBe('Welcome to Squisq');
    expect((layers[1] as TextLayer).content.text).toBe('A small editor for big ideas.');
  });

  it('renders the same template against a portrait viewport without re-authoring', () => {
    const doc = markdownToDoc(parseMarkdown(buildSampleMarkdown()));
    const blocks = expandDocBlocks(doc.blocks, {
      customTemplates: doc.customTemplates,
      viewport: VIEWPORT_PRESETS.portrait,
    });
    const layers = blocks[0].layers ?? [];
    // %-based positions survive the viewport switch — the SSR
    // renderer resolves them against the actual viewport at draw time.
    expect(layers[0].position.x).toBe('6%');
    expect(layers[0].position.width).toBe('88%');
  });
});
