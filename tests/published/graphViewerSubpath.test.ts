/**
 * The graph viewer lives behind `@bendyline/squisq-react/graph` and nowhere
 * else: the root entry and the standalone players must not carry it, and the
 * layout engine stays an external dependency rather than a bundled copy.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';

const VIEWER_MARKER = 'squisq-graph-view';

describe('@bendyline/squisq-react/graph subpath', () => {
  const pkg = loadPublicPackages().find(
    (candidate) => candidate.name === '@bendyline/squisq-react',
  )!;
  const entry = resolve(pkg.dist, 'graph', 'index.js');

  it('is exported and declares the layout engine it imports', () => {
    const exportsMap = pkg.pkg.exports as Record<string, { import?: string; types?: string }>;
    expect(exportsMap['./graph']).toEqual({
      types: './dist/graph/index.d.ts',
      import: './dist/graph/index.js',
    });
    expect(existsSync(entry)).toBe(true);
    expect(pkg.pkg.dependencies?.['@bendyline/squisq-graph']).toBeDefined();
  });

  it('imports the engine instead of bundling a copy of it', () => {
    const source = readFileSync(entry, 'utf8');
    expect(source).toMatch(/from "@bendyline\/squisq-graph"/);
    expect(source).not.toMatch(/function layoutGraph\(/);
    expect(source).not.toMatch(/function feedbackRanks\(/);
  });

  it('stays out of the root entry and the standalone players', () => {
    const outside = readdirSync(pkg.dist, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js'))
      .map((e) => resolve(pkg.dist, e.name));
    expect(outside.length).toBeGreaterThan(0);
    for (const file of outside) {
      expect(readFileSync(file, 'utf8').includes(VIEWER_MARKER), file).toBe(false);
    }
  });

  it('loads and exposes the viewer surface', async () => {
    const mod = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
    for (const name of ['DiagramViewer', 'useGraphLayout', 'graphNodeSize', 'estimateTextWidth']) {
      expect(mod[name], name).toBeDefined();
    }
  });
});
