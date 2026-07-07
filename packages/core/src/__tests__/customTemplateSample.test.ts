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
import {
  writeCustomTemplatesToFrontmatter,
  readCustomTemplatesFromFrontmatter,
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
} from '../doc/customTemplatesFrontmatter';
import type { CustomTemplateDefinition, LayerRepeat } from '../schemas/CustomTemplates.js';
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

  it('resolves {attr:key} against a block heading annotation through the pipeline', () => {
    const attrDef: CustomTemplateDefinition = {
      name: 'badge',
      label: 'Badge',
      viewport: { width: 1920, height: 1080 },
      layers: [
        {
          id: 'badge-role',
          type: 'text',
          position: { x: '6%', y: '20%', width: '88%' },
          content: { text: 'Role: {attr:role|none}', style: { fontSize: 48, color: '#000' } },
        },
      ],
    };
    const payload = writeCustomTemplatesToFrontmatter([attrDef]);
    const md = `---
squisq-custom-templates: "${payload}"
---

# Team {[badge role=lead]}

Body.
`;
    const doc = markdownToDoc(parseMarkdown(md));
    const blocks = expandDocBlocks(doc.blocks, { customTemplates: doc.customTemplates });
    const layers = blocks[0].layers ?? [];
    expect((layers[0] as TextLayer).content.text).toBe('Role: lead');
  });
});

describe('Custom template codec — repeat round-trip', () => {
  it('preserves a layer.repeat directive through write → read (passes through unmapped)', () => {
    const repeat: LayerRepeat = { source: 'images', direction: 'row', gap: 12, max: 4 };
    const def: CustomTemplateDefinition = {
      name: 'gallery',
      label: 'Gallery',
      viewport: { width: 1920, height: 1080 },
      layers: [
        {
          id: 'thumb',
          type: 'image',
          position: { x: '0%', y: '0%', width: '25%', height: '25%' },
          content: { src: '{item:src}', alt: '{item:label}' },
          repeat,
        },
      ],
    };
    const payload = writeCustomTemplatesToFrontmatter([def]);
    expect(payload).toBeDefined();
    const round = readCustomTemplatesFromFrontmatter({
      [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: JSON.parse(payload as string),
    });
    expect(round).toBeDefined();
    const layer = round?.[0].layers[0] as (typeof def.layers)[number];
    expect(layer.repeat).toEqual(repeat);
  });
});
