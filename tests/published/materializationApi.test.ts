import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const docEntry = pathToFileURL(resolve('packages/core/dist/doc/index.js')).href;
const rootEntry = pathToFileURL(resolve('packages/core/dist/index.js')).href;

describe('published layer materialization API', () => {
  it('exposes the canonical contract from both public entry points', async () => {
    const [doc, root] = await Promise.all([import(docEntry), import(rootEntry)]);
    expect(doc.materializeBlockLayers).toBeTypeOf('function');
    expect(root.materializeBlockLayers).toBeTypeOf('function');
  });

  it('exposes only the canonical layer materialization entry point', async () => {
    const [doc, root] = await Promise.all([import(docEntry), import(rootEntry)]);
    const block = {
      id: 'raw',
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      layers: [
        {
          id: 'shape',
          type: 'shape',
          content: { shape: 'rect', fill: '#123456' },
          position: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
    };

    const canonical = doc.materializeBlockLayers(block, { persistentLayers: false });
    expect(canonical.source).toBe('authored');
    expect(canonical.layers).toHaveLength(1);
    for (const entry of [doc, root]) {
      expect(entry.getLayers).toBeUndefined();
      expect(entry.expandTemplateBlock).toBeUndefined();
      expect(entry.materializeTemplateLayers).toBeUndefined();
      expect(entry.TEMPLATE_ALIASES).toBeUndefined();
      expect(entry.encodeLayersForFrontmatter).toBeUndefined();
      expect(entry.decodeLayersFromFrontmatter).toBeUndefined();
    }
    expect(doc.resolveTemplateName('titleBlock')).toBe('title');
  });

  it('does not leak removed adapter types into the declaration surface', async () => {
    const declarations = await readFile(resolve('packages/core/dist/doc/index.d.ts'), 'utf8');
    expect(declarations).toContain('declare function materializeBlockLayers');
    expect(declarations).not.toMatch(/\bRenderContext\b/);
    expect(declarations).not.toMatch(/\bmaterializeTemplateLayers\b/);
  });
});
