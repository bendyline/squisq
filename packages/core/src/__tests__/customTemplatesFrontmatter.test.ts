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
  readCustomTemplatesFromFrontmatter,
  writeCustomTemplatesToFrontmatter,
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
} from '../doc/customTemplatesFrontmatter';
import { parseMarkdown } from '../markdown/parse';
import type { Layer } from '../schemas/Doc.js';
import {
  validateCustomTemplateDefinition,
  type CustomTemplateDefinition,
} from '../schemas/CustomTemplates.js';

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

describe('writeCustomTemplatesToFrontmatter → readCustomTemplatesFromFrontmatter', () => {
  it('round-trips a single definition through the compact JSON wire format', () => {
    const payload = writeCustomTemplatesToFrontmatter([heroDef]);
    expect(typeof payload).toBe('string');
    // Compact form: a readable JSON object keyed by name, short keys, no
    // base64, and the default 1920×1080 viewport omitted.
    expect(payload!.startsWith('{"hero":')).toBe(true);
    expect(payload).toContain('"lb":"Hero"');
    expect(payload).not.toContain('"viewport"');
    const fm = { [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload };
    const out = readCustomTemplatesFromFrontmatter(fm);
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(heroDef);
  });

  it('default output is compact (single line) and byte-unchanged', () => {
    const payload = writeCustomTemplatesToFrontmatter([heroDef])!;
    expect(payload).not.toContain('\n');
    // Explicit pretty:false must match the historical default exactly.
    expect(writeCustomTemplatesToFrontmatter([heroDef], { pretty: false })).toBe(payload);
  });

  it('pretty:true emits multi-line JSON that still reads back', () => {
    const payload = writeCustomTemplatesToFrontmatter([heroDef], { pretty: true })!;
    expect(payload).toContain('\n');
    // Same compact key codec, just pretty-printed.
    expect(payload).toContain('"lb": "Hero"');
    const fm = { [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload };
    const out = readCustomTemplatesFromFrontmatter(fm);
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(heroDef);
  });

  it('a hand-written block-scalar frontmatter parses back into the definition', () => {
    const payload = writeCustomTemplatesToFrontmatter([heroDef], { pretty: true })!;
    const body = payload
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');
    const md = `---\n${FRONTMATTER_CUSTOM_TEMPLATES_KEY}: |-\n${body}\n---\n\n# Hi\n`;
    const parsed = parseMarkdown(md);
    const out = readCustomTemplatesFromFrontmatter(parsed.frontmatter);
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(heroDef);
  });

  it('is markedly smaller than the legacy base64 form', () => {
    const compact = writeCustomTemplatesToFrontmatter([heroDef])!;
    const legacyBase64 = btoa(unescape(encodeURIComponent(JSON.stringify([{ ...heroDef }]))));
    expect(compact.length).toBeLessThan(legacyBase64.length);
  });

  it('still reads the legacy base64-JSON payload (back-compat)', () => {
    // What older documents have on disk: base64 of the full-keyed array.
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify([heroDef]))));
    const out = readCustomTemplatesFromFrontmatter({
      [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: legacy,
    });
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(heroDef);
  });

  it('round-trips layers carrying the full styling field set without loss', () => {
    const rich: CustomTemplateDefinition = {
      name: 'rich',
      label: 'Rich',
      viewport: { width: 1080, height: 1080 },
      layers: [
        {
          id: 'p',
          type: 'path',
          position: { x: '1%', y: '2%', width: '3%', height: '4%', anchor: 'center' },
          content: {
            d: 'M0 0',
            shapeKind: 'star',
            fill: '#fff',
            fillOpacity: 0.5,
            gradient: { from: '#000', to: '#fff', angle: 90 },
            stroke: '#111',
            strokeWidth: 3,
            borderStyle: 'dashed',
            dasharray: '4 2',
          },
        } as Layer,
      ],
    };
    const payload = writeCustomTemplatesToFrontmatter([rich])!;
    const out = readCustomTemplatesFromFrontmatter({ [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload });
    expect(out![0]).toEqual(rich);
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

  it('rejects a malformed layer before it can reach template expansion', () => {
    const payload = JSON.stringify({
      broken: {
        lb: 'Broken',
        ly: [{ ty: 'text', id: 'missing-content', po: { x: 0, y: 0 } }],
      },
    });
    expect(
      readCustomTemplatesFromFrontmatter({ [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload }),
    ).toBeUndefined();
  });

  it('keeps valid definitions when a decoded list also contains malformed entries', () => {
    const malformed = {
      name: 'broken',
      label: 'Broken',
      viewport: { width: 1920, height: 1080 },
      layers: [{ id: 'missing-content', type: 'text', position: { x: 0, y: 0 } }],
    };
    const out = readCustomTemplatesFromFrontmatter({
      [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: [malformed, heroDef],
    });
    expect(out).toEqual([heroDef]);
  });

  it('reports the nested path for an invalid custom-template layer', () => {
    const result = validateCustomTemplateDefinition({
      name: 'broken',
      label: 'Broken',
      viewport: { width: 1920, height: 1080 },
      layers: [{ id: 'missing-content', type: 'text', position: { x: 0, y: 0 } }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: '$.layers[0].content',
      message: 'expected object',
    });
  });
});

describe('Doc.customTemplates round-trip via markdownToDoc + docToMarkdown', () => {
  it('survives a markdownToDoc → docToMarkdown cycle', () => {
    const encoded = writeCustomTemplatesToFrontmatter([heroDef])!;
    // Compact JSON is stored unquoted — it round-trips verbatim through
    // the line-based frontmatter parser.
    const sourceMd = `---
title: My Doc
squisq-custom-templates: ${encoded}
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
