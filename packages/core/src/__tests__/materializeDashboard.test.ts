import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '../doc/index';
import { parseMarkdown } from '../markdown/index';
import type { Doc } from '../schemas/index';
import {
  composeDashboardLayers,
  materializeDashboard,
} from '../doc/dashboard/materializeDashboard';
import { buildPreviewDoc } from '../doc/buildPreviewDoc';

function docFrom(markdown: string): Doc {
  return markdownToDoc(parseMarkdown(markdown), {
    articleId: 'dashboard-test',
    generateCoverBlock: false,
  });
}

const SIX_BLOCKS = `---
title: Fleet Report
---

# Fleet Report

## Alpha

Alpha body prose.

## Beta

Beta body prose.

## Gamma

Gamma body prose.

## Delta

Delta body prose.

## Epsilon

Epsilon body prose.
`;

describe('materializeDashboard', () => {
  it('auto-picks a layout and fills cells in document order', () => {
    const result = materializeDashboard(docFrom(SIX_BLOCKS));
    // 6 candidates (title block kept: it carries body-less heading? The doc
    // title matches the first heading, so the leading block dedupes into the
    // title band), leaving 5 → mosaic-5.
    expect(result.layout.name).toBe('mosaic-5');
    expect(result.layoutSource).toBe('auto');
    expect(result.cells).toHaveLength(5);
    expect(result.cells.map((cell) => cell.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.diagnostics).toEqual([]);
  });

  it('cells tile the content rect without overlap and carry cell-sized viewports', () => {
    const result = materializeDashboard(docFrom(SIX_BLOCKS));
    for (const cell of result.cells) {
      expect(cell.viewport.width).toBe(Math.max(1, Math.round(cell.rect.width)));
      expect(cell.viewport.height).toBe(Math.max(1, Math.round(cell.rect.height)));
      expect(cell.layers.length).toBeGreaterThan(0);
      expect(cell.source).toBe('template');
      // Inside the canvas.
      expect(cell.rect.x).toBeGreaterThanOrEqual(0);
      expect(cell.rect.y).toBeGreaterThanOrEqual(0);
      expect(cell.rect.x + cell.rect.width).toBeLessThanOrEqual(1920.001);
      expect(cell.rect.y + cell.rect.height).toBeLessThanOrEqual(1080.001);
    }
    // Pairwise non-overlap (small epsilon for float math).
    for (const a of result.cells) {
      for (const b of result.cells) {
        if (a.index === b.index) continue;
        const overlapX =
          Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);
        const overlapY =
          Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) -
          Math.max(a.rect.y, b.rect.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it('renders the title band by default and dedupes the leading title block', () => {
    const result = materializeDashboard(docFrom(SIX_BLOCKS));
    expect(result.title).not.toBeNull();
    expect(result.title!.text).toBe('Fleet Report');
    // The band shrinks the content area: no cell starts at y=0.
    expect(Math.min(...result.cells.map((cell) => cell.rect.y))).toBeGreaterThan(0);
    // No cell repeats the doc title (the leading heading-only block deduped).
    expect(result.cells.some((cell) => cell.block.title === 'Fleet Report')).toBe(false);
    // Band layers include the styled text.
    const text = result.title!.layers.find((layer) => layer.type === 'text');
    expect(text && 'content' in text && (text.content as { text: string }).text).toBe(
      'Fleet Report',
    );
  });

  it('reclaims the band when the title is disabled', () => {
    const withBand = materializeDashboard(docFrom(SIX_BLOCKS));
    const result = materializeDashboard(docFrom(SIX_BLOCKS), { showTitle: false });
    expect(result.title).toBeNull();
    // Six candidates now (no dedupe without a band) → grid-3x2 at full height.
    expect(result.layout.name).toBe('grid-3x2');
    // Only the canvas margin remains above the first row — the band's height
    // and its gap are given back to the cells.
    const top = Math.min(...result.cells.map((cell) => cell.rect.y));
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(Math.min(...withBand.cells.map((cell) => cell.rect.y)));
  });

  it('insets the cell area from every canvas edge', () => {
    // With no band the margin is symmetric on all four edges; with one, the
    // band + its gap replace the top margin.
    const bare = materializeDashboard(docFrom(SIX_BLOCKS), { showTitle: false });
    const left = Math.min(...bare.cells.map((cell) => cell.rect.x));
    const top = Math.min(...bare.cells.map((cell) => cell.rect.y));
    const right = 1920 - Math.max(...bare.cells.map((cell) => cell.rect.x + cell.rect.width));
    const bottom = 1080 - Math.max(...bare.cells.map((cell) => cell.rect.y + cell.rect.height));
    // Equal physical margin on both axes (a fraction of the shorter axis).
    for (const gap of [left, top, right, bottom]) {
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeCloseTo(left, 3);
    }

    const titled = materializeDashboard(docFrom(SIX_BLOCKS));
    expect(Math.min(...titled.cells.map((cell) => cell.rect.x))).toBeCloseTo(left, 3);
    expect(
      1080 - Math.max(...titled.cells.map((cell) => cell.rect.y + cell.rect.height)),
    ).toBeCloseTo(bottom, 3);
    // The band itself stays full-bleed, but its type starts on the same
    // left edge as the first column.
    expect(titled.title!.rect.x).toBe(0);
    expect(titled.title!.rect.width).toBe(1920);
    const accent = titled.title!.layers.find((layer) => layer.id === 'dashboard-title-accent');
    expect(accent!.position.x).toBeCloseTo(left, 3);
  });

  it('keeps a title-matching lead block that carries its own body prose', () => {
    const doc = docFrom(`---
title: Solo
---

# Solo

This lead block has real prose, so its cell shows content.

## Second

Body.
`);
    const result = materializeDashboard(doc);
    expect(result.title?.text).toBe('Solo');
    expect(result.cells.some((cell) => cell.block.title === 'Solo')).toBe(true);
  });

  it('reports overflow with the hidden block ids', () => {
    const many = ['---', 'title: Big', '---', ''];
    for (let i = 1; i <= 20; i++) many.push(`## Block ${i}`, '', `Body ${i}.`, '');
    const result = materializeDashboard(docFrom(many.join('\n')));
    expect(result.layout.name).toBe('grid-4x4');
    expect(result.cells).toHaveLength(16);
    const overflow = result.diagnostics.find((diagnostic) => diagnostic.type === 'overflow');
    expect(overflow).toBeDefined();
    expect(overflow!.hiddenBlockIds).toHaveLength(4);
  });

  it('honors an explicit layout id from frontmatter and reports unknown ids', () => {
    const doc = docFrom(
      SIX_BLOCKS.replace('---\n\n', 'squisq-dashboard-layout: grid-2x2\n---\n\n'),
    );
    const picked = materializeDashboard(doc);
    expect(picked.layout.name).toBe('grid-2x2');
    expect(picked.layoutSource).toBe('frontmatter');
    // 5 candidates into 4 cells → overflow diagnostic.
    expect(picked.diagnostics.some((diagnostic) => diagnostic.type === 'overflow')).toBe(true);

    const unknown = materializeDashboard(docFrom(SIX_BLOCKS), { layout: 'not-a-layout' });
    expect(unknown.layoutSource).toBe('auto');
    expect(
      unknown.diagnostics.find((diagnostic) => diagnostic.type === 'unknown-layout')
        ?.requestedLayout,
    ).toBe('not-a-layout');
  });

  it('supports explicit block assignment, duplicates, and out-of-range cells', () => {
    const result = materializeDashboard(docFrom(SIX_BLOCKS), {
      showTitle: false,
      layout: {
        name: 'pinned',
        label: 'Pinned',
        cells: {
          landscape: [
            { x: '0%', y: '0%', width: '32%', height: '100%', block: 3 },
            { x: '34%', y: '0%', width: '32%', height: '100%', block: 3 },
            { x: '68%', y: '0%', width: '32%', height: '100%', block: 64 },
          ],
        },
      },
    });
    expect(result.layoutSource).toBe('option');
    // Two cells render candidate #3 (duplicate allowed); the out-of-range
    // cell is omitted with a diagnostic.
    expect(result.cells).toHaveLength(2);
    expect(result.cells.map((cell) => cell.blockIndex)).toEqual([2, 2]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.type === 'invalid-cell-assignment'),
    ).toBe(true);
    // Unrendered candidates surface as overflow.
    const overflow = result.diagnostics.find((diagnostic) => diagnostic.type === 'overflow');
    expect(overflow?.hiddenBlockIds).toHaveLength(5);
  });

  it('uses custom layouts from frontmatter', () => {
    const doc = docFrom(
      SIX_BLOCKS.replace(
        '---\n\n',
        `squisq-dashboard-layout: banner\nsquisq-dashboard-layouts: {"banner":{"lb":"Banner","ce":{"ls":[{"x":"0%","y":"0%","wd":"100%","hg":"100%"}]}}}\n---\n\n`,
      ),
    );
    const result = materializeDashboard(doc);
    expect(result.layout.name).toBe('banner');
    expect(result.cells).toHaveLength(1);
  });

  it('keeps theme persistent layers out of cells and in the backdrop', () => {
    const result = materializeDashboard(docFrom(SIX_BLOCKS));
    expect(result.backdrop.bottomLayers.length).toBeGreaterThan(0);
    expect(result.backdrop.bottomLayers[0].id).toBe('dashboard-backdrop');
    // Cell layers were materialized with persistentLayers: false — no cell
    // layer id collides with the canvas backdrop id.
    for (const cell of result.cells) {
      expect(cell.layers.some((layer) => layer.id === 'dashboard-backdrop')).toBe(false);
    }
  });

  it('never renders interleaved-image filler cells', () => {
    const doc = docFrom(`---
title: Pics
---

# Pics

## One

Body one.

![a](a.png)
![b](b.png)
![c](c.png)

## Two

Body two.
`);
    const result = materializeDashboard(doc);
    for (const cell of result.cells) {
      expect(String(cell.block.id).startsWith('img-interleave-')).toBe(false);
    }
    // …while the default slideshow projection still interleaves.
    const slides = buildPreviewDoc(doc).blocks.map((block) => String(block.id));
    expect(slides.some((id) => id.startsWith('img-interleave-'))).toBe(true);
  });

  it('reports an empty document', () => {
    const result = materializeDashboard(docFrom(''));
    expect(result.cells).toHaveLength(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.type === 'empty-doc')).toBe(true);
  });
});

describe('dashboard cell zoom', () => {
  const LONG_BODY = Array.from(
    { length: 8 },
    () => 'This paragraph keeps going with plenty of prose so the block reads dense.',
  ).join(' ');
  const MIXED_DOC = `---
title: Zoom Demo
---

# Zoom Demo

## Sparse

Tiny note.

## Dense

${LONG_BODY}

## Chart {[lineChart]}

| Week | Value |
| ---- | ----- |
| 1    | 10    |
| 2    | 20    |
`;

  function cellFor(result: ReturnType<typeof materializeDashboard>, title: string) {
    const cell = result.cells.find((candidate) => candidate.block.title === title);
    expect(cell, title).toBeDefined();
    return cell!;
  }

  function maxTextFontSize(cell: ReturnType<typeof materializeDashboard>['cells'][number]) {
    let max = 0;
    for (const layer of cell.layers) {
      if (layer.type !== 'text') continue;
      max = Math.max(max, (layer.content as { style: { fontSize: number } }).style.fontSize);
    }
    return max;
  }

  it('auto-boosts sparse text cells, leaves dense and chart cells at 1×', () => {
    const result = materializeDashboard(docFrom(MIXED_DOC));
    expect(cellFor(result, 'Sparse').zoom).toBe(2);
    expect(cellFor(result, 'Dense').zoom).toBe(1);
    expect(cellFor(result, 'Chart').zoom).toBe(1);
    // Never more than base 1× plus one boost level.
    expect(
      new Set(result.cells.map((cell) => cell.zoom).filter((zoom) => zoom !== 1)).size,
    ).toBeLessThanOrEqual(1);
  });

  it('bakes the zoom into the rendered type (≈2× the un-zoomed size)', () => {
    const zoomed = materializeDashboard(docFrom(MIXED_DOC));
    const flat = materializeDashboard(docFrom(MIXED_DOC), { zoom: 'off' });
    const ratio =
      maxTextFontSize(cellFor(zoomed, 'Sparse')) / maxTextFontSize(cellFor(flat, 'Sparse'));
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
    // The dense cell renders identically in both modes.
    expect(maxTextFontSize(cellFor(zoomed, 'Dense'))).toBe(maxTextFontSize(cellFor(flat, 'Dense')));
  });

  it('frontmatter squisq-dashboard-zoom: off pins every cell to 1×', () => {
    const doc = docFrom(MIXED_DOC.replace('---\n\n', 'squisq-dashboard-zoom: off\n---\n\n'));
    const result = materializeDashboard(doc);
    expect(result.cells.every((cell) => cell.zoom === 1)).toBe(true);
  });

  it('honors an explicit cell zoom and rallies auto boosts to it', () => {
    const result = materializeDashboard(docFrom(MIXED_DOC), {
      showTitle: false,
      layout: {
        name: 'pinned-zoom',
        label: 'Pinned Zoom',
        cells: {
          landscape: [
            { x: '0%', y: '0%', width: '32%', height: '100%', zoom: 150 },
            { x: '34%', y: '0%', width: '32%', height: '100%' },
            { x: '68%', y: '0%', width: '32%', height: '100%' },
          ],
        },
      },
    });
    // Cell 0 (Sparse) pinned to 1.5×; without the pin the auto pick would be
    // 2× — but the pin outweighs, so no cell renders above 1.5×.
    expect(result.cells[0].zoom).toBe(1.5);
    expect(result.cells.every((cell) => cell.zoom === 1 || cell.zoom === 1.5)).toBe(true);
  });
});

describe('composeDashboardLayers', () => {
  it('flattens to a single canvas with unique, prefixed layer ids', () => {
    const materialization = materializeDashboard(docFrom(SIX_BLOCKS));
    const layers = composeDashboardLayers(materialization);
    expect(layers.length).toBeGreaterThan(materialization.cells.length);
    const ids = layers.map((layer) => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Cell layers carry their cell prefix; the title band carries its own.
    expect(ids.some((id) => id.startsWith('cell-0-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('dashboard-title-'))).toBe(true);
  });

  it('translates cell layers into their canvas rects', () => {
    const materialization = materializeDashboard(docFrom(SIX_BLOCKS), { showTitle: false });
    const secondCell = materialization.cells[1];
    const layers = composeDashboardLayers(materialization);
    const placed = layers.filter((layer) => layer.id.startsWith(`cell-${secondCell.index}-`));
    expect(placed.length).toBeGreaterThan(0);
    for (const layer of placed) {
      const x = typeof layer.position.x === 'number' ? layer.position.x : NaN;
      expect(x).toBeGreaterThanOrEqual(secondCell.rect.x - 0.5);
    }
  });
});
