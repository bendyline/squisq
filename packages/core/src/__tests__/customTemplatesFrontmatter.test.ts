/**
 * Custom templates round-trip through frontmatter.
 *
 * Verifies that a CustomTemplateDefinition stored in markdown
 * frontmatter is faithfully reconstructed by `markdownToDoc` and
 * serialized back by `docToMarkdown` without loss.
 */

import { describe, it, expect, vi } from 'vitest';
import { markdownToDoc } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';
import {
  encodeLayersForFrontmatter,
  decodeLayersFromFrontmatter,
  readCustomTemplatesFromFrontmatter,
  writeCustomTemplatesToFrontmatter,
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
} from '../doc/customTemplatesFrontmatter';
import { parseMarkdown } from '../markdown/parse';
import type { Layer } from '../schemas/Doc.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';

const sampleLayers: Layer[] = [
  {
    id: 'title',
    type: 'text',
    position: { x: '5%', y: '10%', width: '90%' },
    content: { text: '{title}', style: { fontSize: 72, color: '#000' } },
  },
  {
    id: 'body',
    type: 'text',
    position: { x: '5%', y: '40%', width: '90%' },
    content: { text: '{content}', style: { fontSize: 32, color: '#333' } },
  },
];

const heroDef: CustomTemplateDefinition = {
  name: 'hero',
  label: 'Hero',
  description: 'Large title with body below.',
  viewport: { width: 1920, height: 1080 },
  layers: sampleLayers,
};

describe('encodeLayersForFrontmatter ↔ decodeLayersFromFrontmatter', () => {
  it('round-trips a single Layer array verbatim', () => {
    const encoded = encodeLayersForFrontmatter(sampleLayers);
    const decoded = decodeLayersFromFrontmatter(encoded);
    expect(decoded).toEqual(sampleLayers);
  });

  it("returns [] when the base64 isn't valid JSON", () => {
    const garbage = encodeLayersForFrontmatter(sampleLayers).slice(0, 4);
    expect(decodeLayersFromFrontmatter(garbage)).toEqual([]);
  });
});

describe('writeCustomTemplatesToFrontmatter → readCustomTemplatesFromFrontmatter', () => {
  it('round-trips a single definition through the base64-JSON wire format', () => {
    const payload = writeCustomTemplatesToFrontmatter([heroDef]);
    expect(typeof payload).toBe('string');
    const fm = { [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload };
    const out = readCustomTemplatesFromFrontmatter(fm);
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(heroDef);
  });

  it('round-trips multiple definitions in declaration order', () => {
    const second: CustomTemplateDefinition = { ...heroDef, name: 'second', label: 'Second' };
    const payload = writeCustomTemplatesToFrontmatter([heroDef, second]);
    const out = readCustomTemplatesFromFrontmatter({
      [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload,
    });
    expect(out!.map((d) => d.name)).toEqual(['hero', 'second']);
  });

  it('also accepts an already-decoded array shape (forward-compatible)', () => {
    const out = readCustomTemplatesFromFrontmatter({
      [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: [
        {
          name: 'hero',
          label: 'Hero',
          viewport: { width: 1920, height: 1080 },
          layers: sampleLayers,
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out![0].name).toBe('hero');
  });

  it('returns undefined when the key is absent', () => {
    expect(readCustomTemplatesFromFrontmatter({})).toBeUndefined();
    expect(readCustomTemplatesFromFrontmatter(undefined)).toBeUndefined();
  });

  it("returns undefined when the encoded string isn't a valid array", () => {
    const fm = { [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: 'not-base64-of-an-array' };
    expect(readCustomTemplatesFromFrontmatter(fm)).toBeUndefined();
  });
});

describe('Doc.customTemplates round-trip via markdownToDoc + docToMarkdown', () => {
  it('survives a markdownToDoc → docToMarkdown cycle', () => {
    const encoded = writeCustomTemplatesToFrontmatter([heroDef])!;
    const sourceMd = `---
title: My Doc
squisq-custom-templates: "${encoded}"
---

# Welcome {[hero]}

A small editor for big ideas.
`;
    const doc = markdownToDoc(parseMarkdown(sourceMd));
    expect(doc.customTemplates).toBeDefined();
    expect(doc.customTemplates).toHaveLength(1);
    expect(doc.customTemplates![0].name).toBe('hero');
    expect(doc.customTemplates![0].layers).toEqual(sampleLayers);

    // Round-trip back — docToMarkdown must restore the frontmatter
    // entry with an equivalent encoded payload.
    const mdOut = docToMarkdown(doc);
    expect(mdOut.frontmatter).toBeDefined();
    const payload = mdOut.frontmatter![FRONTMATTER_CUSTOM_TEMPLATES_KEY];
    expect(typeof payload).toBe('string');
    const reread = readCustomTemplatesFromFrontmatter({
      [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload,
    });
    expect(reread).toEqual(doc.customTemplates);
  });

  it('drops the frontmatter key when the doc has no custom templates anymore', () => {
    void vi; // imported for parity; not used here
    const doc = {
      articleId: 'd',
      duration: 0,
      blocks: [],
      audio: { segments: [] },
      // Stale frontmatter from an earlier save when the doc DID have
      // custom templates — but doc.customTemplates is now empty.
      frontmatter: {
        title: 'Doc',
        [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: 'stale-base64-blob',
      },
    };
    const md = docToMarkdown(doc);
    expect(md.frontmatter).toBeDefined();
    expect(md.frontmatter).not.toHaveProperty(FRONTMATTER_CUSTOM_TEMPLATES_KEY);
    expect(md.frontmatter!.title).toBe('Doc');
  });
});
