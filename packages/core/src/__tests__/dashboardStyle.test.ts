import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '../doc/index';
import { parseMarkdown } from '../markdown/index';
import type { Doc, Layer } from '../schemas/index';
import { DEFAULT_THEME, THEMES } from '../schemas/themeLibrary';
import {
  composeDashboardLayers,
  materializeDashboard,
} from '../doc/dashboard/materializeDashboard';
import {
  DASHBOARD_STYLES,
  DASHBOARD_STYLE_IDS,
  buildDashboardCellChrome,
  dashboardCanvasFill,
  dashboardCellAccent,
  resolveDashboardStyleId,
  stripBlockBackdropLayer,
  type DashboardStyleId,
} from '../doc/dashboard/dashboardStyle';

function docFrom(markdown: string): Doc {
  return markdownToDoc(parseMarkdown(markdown), {
    articleId: 'dashboard-style-test',
    generateCoverBlock: false,
  });
}

const FOUR_BLOCKS = `---
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
`;

const CELL = { x: 100, y: 50, width: 600, height: 400 };

describe('dashboard style vocabulary', () => {
  it('publishes one summary per style id, basic first', () => {
    expect(DASHBOARD_STYLES.map((style) => style.id)).toEqual([...DASHBOARD_STYLE_IDS]);
    expect(DASHBOARD_STYLES[0].id).toBe('basic');
    for (const style of DASHBOARD_STYLES) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(0);
    }
  });

  it('normalizes authored spellings and rejects junk', () => {
    expect(resolveDashboardStyleId('Card')).toBe('card');
    expect(resolveDashboardStyleId(' cards ')).toBe('card');
    expect(resolveDashboardStyleId('outline')).toBe('panel');
    expect(resolveDashboardStyleId('accent-cards')).toBe('accent');
    expect(resolveDashboardStyleId('none')).toBe('basic');
    expect(resolveDashboardStyleId('wat')).toBeUndefined();
    expect(resolveDashboardStyleId(42)).toBeUndefined();
  });
});

describe('buildDashboardCellChrome', () => {
  it('paints nothing for basic', () => {
    expect(buildDashboardCellChrome('basic', { theme: DEFAULT_THEME, rect: CELL, index: 0 })).toBe(
      null,
    );
  });

  it('nests the card inside the layout cell, with the block filling the card', () => {
    for (const style of ['card', 'panel', 'accent'] as DashboardStyleId[]) {
      const chrome = buildDashboardCellChrome(style, {
        theme: DEFAULT_THEME,
        rect: CELL,
        index: 0,
      });
      expect(chrome).not.toBe(null);
      if (!chrome) continue;
      const { cardRect, contentRect } = chrome;
      // card ⊂ cell — the ring is the gutter plus room for the elevation.
      expect(cardRect.x).toBeGreaterThan(CELL.x);
      expect(cardRect.y).toBeGreaterThan(CELL.y);
      expect(cardRect.x + cardRect.width).toBeLessThan(CELL.x + CELL.width);
      expect(cardRect.y + cardRect.height).toBeLessThan(CELL.y + CELL.height);
      // The block IS the card face — no padded well inside it.
      expect(contentRect).toEqual(cardRect);
      expect(contentRect.width / CELL.width).toBeGreaterThan(0.9);
      expect(contentRect.height / CELL.height).toBeGreaterThan(0.85);
    }
  });

  it('puts borders and accents on top, where an opaque template cannot bury them', () => {
    for (const style of ['card', 'panel', 'accent'] as DashboardStyleId[]) {
      const chrome = buildDashboardCellChrome(style, {
        theme: DEFAULT_THEME,
        rect: CELL,
        index: 0,
      });
      if (!chrome) continue;
      const behind = chrome.layers.map((layer) => layer.id);
      const above = chrome.overlayLayers.map((layer) => layer.id);
      expect(behind).toContain('cell-surface');
      expect(above).toContain('cell-border');
      expect(behind).not.toContain('cell-border');
      if (style !== 'card') expect(above).toContain('cell-accent-bar');
    }
  });

  it('keeps every chrome layer inside the cell box', () => {
    for (const style of ['card', 'panel', 'accent'] as DashboardStyleId[]) {
      const chrome = buildDashboardCellChrome(style, {
        theme: DEFAULT_THEME,
        rect: CELL,
        index: 1,
      });
      if (!chrome) continue;
      for (const layer of chrome.layers) {
        const { x, y, width, height } = layer.position;
        expect(typeof x).toBe('number');
        expect(typeof y).toBe('number');
        expect(x as number).toBeGreaterThanOrEqual(0);
        expect(y as number).toBeGreaterThanOrEqual(0);
        expect((x as number) + (width as number)).toBeLessThanOrEqual(CELL.width + 0.001);
        expect((y as number) + (height as number)).toBeLessThanOrEqual(CELL.height + 0.001);
      }
    }
  });

  it('keeps overlay layers inside the card box', () => {
    const chrome = buildDashboardCellChrome('panel', {
      theme: DEFAULT_THEME,
      rect: CELL,
      index: 0,
    });
    if (!chrome) throw new Error('expected chrome');
    for (const layer of chrome.overlayLayers) {
      const { x, y, width, height } = layer.position;
      expect(x as number).toBeGreaterThanOrEqual(0);
      expect(y as number).toBeGreaterThanOrEqual(0);
      if (typeof width === 'number') {
        expect((x as number) + width).toBeLessThanOrEqual(chrome.cardRect.width + 0.001);
      }
      if (typeof height === 'number') {
        expect((y as number) + height).toBeLessThanOrEqual(chrome.cardRect.height + 0.001);
      }
    }
  });

  it('elevates cards and outlines panels', () => {
    const card = buildDashboardCellChrome('card', {
      theme: DEFAULT_THEME,
      rect: CELL,
      index: 0,
    });
    const panel = buildDashboardCellChrome('panel', {
      theme: DEFAULT_THEME,
      rect: CELL,
      index: 0,
    });
    expect(card?.layers.some((layer) => layer.id.startsWith('cell-shadow'))).toBe(true);
    expect(panel?.layers.some((layer) => layer.id.startsWith('cell-shadow'))).toBe(false);
    expect(panel?.overlayLayers.some((layer) => layer.id === 'cell-accent-bar')).toBe(true);
  });

  it('takes every color from the theme, rotating accents across cells', () => {
    const theme = THEMES.gezellig ?? DEFAULT_THEME;
    const accents = [0, 1, 2, 3].map((index) => dashboardCellAccent(theme, index));
    const schemeCount = Object.keys(theme.colorSchemes ?? {}).length;
    if (schemeCount > 1) expect(new Set(accents).size).toBeGreaterThan(1);
    for (const accent of accents) {
      expect(typeof accent).toBe('string');
      expect(accent.length).toBeGreaterThan(0);
    }
    const surface = buildDashboardCellChrome('card', { theme, rect: CELL, index: 0 })?.layers.find(
      (layer) => layer.id === 'cell-surface',
    );
    expect(surface?.type).toBe('shape');
    if (surface?.type === 'shape') {
      expect(surface.content.fill).toBe(theme.colors.background);
    }
  });

  it('tints the canvas only for elevated styles', () => {
    expect(dashboardCanvasFill('basic', DEFAULT_THEME)).toBe(DEFAULT_THEME.colors.background);
    expect(dashboardCanvasFill('panel', DEFAULT_THEME)).toBe(DEFAULT_THEME.colors.background);
    expect(dashboardCanvasFill('card', DEFAULT_THEME)).not.toBe(DEFAULT_THEME.colors.background);
    // Dark themes move the other way, but always away from the card surface.
    const dark = THEMES['tech-dark'] ?? DEFAULT_THEME;
    expect(dashboardCanvasFill('accent', dark)).not.toBe(dark.colors.background);
  });
});

describe('stripBlockBackdropLayer', () => {
  const backdrop = (fill: string): Layer => ({
    type: 'shape',
    id: 'bg',
    content: { shape: 'rect', fill },
    position: { x: 0, y: 0, width: '100%', height: '100%' },
  });

  it('drops a full-bleed layer that is exactly the theme background', () => {
    const layers = [backdrop(DEFAULT_THEME.colors.background), backdrop('#ff0000')];
    expect(stripBlockBackdropLayer(layers, DEFAULT_THEME)).toHaveLength(1);
  });

  it('keeps an authored backdrop that is not the theme background', () => {
    const layers = [backdrop('#123456')];
    expect(stripBlockBackdropLayer(layers, DEFAULT_THEME)).toHaveLength(1);
  });

  it('keeps gradient and non-full-bleed backdrops', () => {
    const gradient: Layer = {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: DEFAULT_THEME.colors.background,
        gradient: { from: '#000', to: '#fff' },
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    expect(stripBlockBackdropLayer([gradient], DEFAULT_THEME)).toHaveLength(1);
    const partial: Layer = {
      type: 'shape',
      id: 'bg',
      content: { shape: 'rect', fill: DEFAULT_THEME.colors.background },
      position: { x: 0, y: 0, width: '50%', height: '100%' },
    };
    expect(stripBlockBackdropLayer([partial], DEFAULT_THEME)).toHaveLength(1);
  });
});

describe('materializeDashboard with styles', () => {
  it('defaults to basic — cells fill their layout rects and carry no frame', () => {
    const result = materializeDashboard(docFrom(FOUR_BLOCKS));
    expect(result.style).toBe('basic');
    expect(result.backdrop.fill).toBe(DEFAULT_THEME.colors.background);
    for (const cell of result.cells) {
      expect(cell.frame).toBeUndefined();
    }
  });

  it('insets the block and materializes it against the padded box', () => {
    const basic = materializeDashboard(docFrom(FOUR_BLOCKS));
    const card = materializeDashboard(docFrom(FOUR_BLOCKS), { style: 'card' });
    expect(card.style).toBe('card');
    expect(card.cells).toHaveLength(basic.cells.length);
    card.cells.forEach((cell, index) => {
      const plain = basic.cells[index];
      expect(cell.frame).toBeDefined();
      // The frame keeps the layout's own rect; the block shrinks inside it.
      expect(cell.frame?.rect).toEqual(plain.rect);
      expect(cell.rect.width).toBeLessThan(plain.rect.width);
      expect(cell.rect.height).toBeLessThan(plain.rect.height);
      // The block is rendered at its real content size, not scaled down after.
      expect(cell.viewport.width).toBe(Math.max(1, Math.round(cell.rect.width)));
      expect(cell.viewport.height).toBe(Math.max(1, Math.round(cell.rect.height)));
      expect(cell.frame?.viewport.width).toBe(Math.max(1, Math.round(plain.rect.width)));
      expect(cell.frame?.contentRadiusPct).toMatch(/^[\d.]+% \/ [\d.]+%$/);
    });
  });

  it('reads the style from frontmatter, and the option overrides it', () => {
    const doc = docFrom(
      `---\ntitle: Fleet\nsquisq-dashboard-style: panel\n---\n\n## Alpha\n\nBody.\n`,
    );
    expect(materializeDashboard(doc).style).toBe('panel');
    expect(materializeDashboard(doc, { style: 'accent' }).style).toBe('accent');
    expect(materializeDashboard(doc, { style: 'bogus' }).style).toBe('panel');
  });

  it('drops the block backdrop under card styles so the surface shows through', () => {
    const basic = materializeDashboard(docFrom(FOUR_BLOCKS));
    const card = materializeDashboard(docFrom(FOUR_BLOCKS), { style: 'card' });
    const isThemeBackdrop = (layer?: Layer) =>
      layer?.type === 'shape' && layer.content.fill === DEFAULT_THEME.colors.background;
    expect(isThemeBackdrop(basic.cells[0].layers[0])).toBe(true);
    expect(isThemeBackdrop(card.cells[0].layers[0])).toBe(false);
    expect(card.cells[0].layers.length).toBe(basic.cells[0].layers.length - 1);
  });

  it('composes frame chrome beneath each cell in the flat layer list', () => {
    const materialization = materializeDashboard(docFrom(FOUR_BLOCKS), { style: 'accent' });
    const layers = composeDashboardLayers(materialization);
    const ids = layers.map((layer) => layer.id);
    const surface = ids.indexOf('cell-0-frame-cell-surface');
    expect(surface).toBeGreaterThan(-1);
    const firstCellLayer = ids.findIndex((id) => id.startsWith('cell-0-') && !id.includes('frame'));
    expect(firstCellLayer).toBeGreaterThan(surface);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
