import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FRONTMATTER_KEYS,
  DEFAULT_DASHBOARD_SETTINGS,
  resolveDashboardSettings,
} from '../doc/dashboard/dashboardSettings';
import {
  FRONTMATTER_DASHBOARD_LAYOUTS_KEY,
  readDashboardLayoutsFromFrontmatter,
  writeDashboardLayoutsToFrontmatter,
} from '../doc/dashboard/dashboardLayoutsFrontmatter';
import type { DashboardLayoutDefinition } from '../doc/dashboard/DashboardLayout';

describe('resolveDashboardSettings', () => {
  it('defaults to auto layout with the title band on and auto zoom', () => {
    expect(resolveDashboardSettings(undefined)).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(DEFAULT_DASHBOARD_SETTINGS).toEqual({
      layout: 'auto',
      showTitle: true,
      zoom: 'auto',
      style: 'basic',
    });
  });

  it('reads canonical keys with legacy fallbacks (canonical wins)', () => {
    expect(
      resolveDashboardSettings({
        'squisq-dashboard-layout': 'Grid-3x2',
        'squisq-dashboard-title': 'hidden',
      }),
    ).toEqual({ layout: 'grid-3x2', showTitle: false, zoom: 'auto', style: 'basic' });
    expect(resolveDashboardSettings({ 'dashboard-layout': 'mosaic-5' }).layout).toBe('mosaic-5');
    expect(
      resolveDashboardSettings({
        'squisq-dashboard-layout': 'grid-2x2',
        'dashboard-layout': 'grid-4x4',
      }).layout,
    ).toBe('grid-2x2');
  });

  it('normalizes auto spellings and tolerates junk', () => {
    expect(resolveDashboardSettings({ 'squisq-dashboard-layout': ' AUTO ' }).layout).toBe('auto');
    expect(resolveDashboardSettings({ 'squisq-dashboard-layout': 'default' }).layout).toBe('auto');
    expect(resolveDashboardSettings({ 'squisq-dashboard-layout': 42 }).layout).toBe('auto');
    expect(resolveDashboardSettings({ 'squisq-dashboard-title': 'maybe' }).showTitle).toBe(true);
  });

  it('applies caller overrides over frontmatter', () => {
    const settings = resolveDashboardSettings(
      { 'squisq-dashboard-layout': 'grid-2x2', 'squisq-dashboard-title': true },
      { layout: 'mosaic-5', showTitle: false },
    );
    expect(settings).toEqual({
      layout: 'mosaic-5',
      showTitle: false,
      zoom: 'auto',
      style: 'basic',
    });
  });

  it('publishes the canonical key registry', () => {
    expect(DASHBOARD_FRONTMATTER_KEYS.layout.canonical).toBe('squisq-dashboard-layout');
    expect(DASHBOARD_FRONTMATTER_KEYS.showTitle.canonical).toBe('squisq-dashboard-title');
    expect(DASHBOARD_FRONTMATTER_KEYS.zoom.canonical).toBe('squisq-dashboard-zoom');
    expect(DASHBOARD_FRONTMATTER_KEYS.style.canonical).toBe('squisq-dashboard-style');
  });

  it('resolves the zoom mode with a tolerant vocabulary (default auto)', () => {
    expect(resolveDashboardSettings(undefined).zoom).toBe('auto');
    expect(resolveDashboardSettings({ 'squisq-dashboard-zoom': 'off' }).zoom).toBe('off');
    expect(resolveDashboardSettings({ 'squisq-dashboard-zoom': false }).zoom).toBe('off');
    expect(resolveDashboardSettings({ 'squisq-dashboard-zoom': 'none' }).zoom).toBe('off');
    expect(resolveDashboardSettings({ 'squisq-dashboard-zoom': 'auto' }).zoom).toBe('auto');
    expect(resolveDashboardSettings({ 'squisq-dashboard-zoom': 'wat' }).zoom).toBe('auto');
    expect(resolveDashboardSettings({}, { zoom: 'off' }).zoom).toBe('off');
  });

  it('resolves the cell style with a tolerant vocabulary (default basic)', () => {
    expect(resolveDashboardSettings(undefined).style).toBe('basic');
    expect(resolveDashboardSettings({ 'squisq-dashboard-style': 'Card' }).style).toBe('card');
    expect(resolveDashboardSettings({ 'squisq-dashboard-style': 'cards' }).style).toBe('card');
    expect(resolveDashboardSettings({ 'squisq-dashboard-style': 'outline' }).style).toBe('panel');
    expect(resolveDashboardSettings({ 'squisq-dashboard-style': 'accent' }).style).toBe('accent');
    expect(resolveDashboardSettings({ 'dashboard-style': 'panel' }).style).toBe('panel');
    expect(resolveDashboardSettings({ 'squisq-dashboard-style': 'wat' }).style).toBe('basic');
    expect(
      resolveDashboardSettings({ 'squisq-dashboard-style': 'card' }, { style: 'panel' }).style,
    ).toBe('panel');
    // An unrecognized override falls back to the document's own setting.
    expect(
      resolveDashboardSettings({ 'squisq-dashboard-style': 'card' }, { style: 'nope' }).style,
    ).toBe('card');
  });
});

describe('dashboard layouts frontmatter codec', () => {
  const layout: DashboardLayoutDefinition = {
    name: 'kpi-wall',
    label: 'KPI Wall',
    description: 'Repeats the lead metric',
    cells: {
      landscape: [
        { x: '0%', y: '0%', width: '49%', height: '100%', block: 1, zoom: 2 },
        { x: '51%', y: '0%', width: '49%', height: '100%' },
      ],
      portrait: [
        { x: '0%', y: '0%', width: '100%', height: '49%', block: 1, zoom: 2 },
        { x: '0%', y: '51%', width: '100%', height: '49%' },
      ],
    },
    titleSlot: { placement: 'bottom', height: '12%' },
    auto: false,
  };

  it('round-trips a definition through the compact codec', () => {
    const written = writeDashboardLayoutsToFrontmatter([layout]);
    expect(written).toBeTruthy();
    // Compact form: single line, name-keyed, short property codes.
    expect(written).not.toContain('\n');
    expect(written).toContain('"kpi-wall"');
    expect(written).toContain('"lb"');
    expect(written).not.toContain('"label"');
    const read = readDashboardLayoutsFromFrontmatter({
      [FRONTMATTER_DASHBOARD_LAYOUTS_KEY]: written,
    });
    expect(read).toEqual([layout]);
  });

  it('accepts an already-structured object payload', () => {
    const written = writeDashboardLayoutsToFrontmatter([layout])!;
    const parsed = JSON.parse(written) as Record<string, unknown>;
    const read = readDashboardLayoutsFromFrontmatter({
      [FRONTMATTER_DASHBOARD_LAYOUTS_KEY]: parsed,
    });
    expect(read).toEqual([layout]);
  });

  it('drops malformed entries and returns undefined for empty results', () => {
    expect(readDashboardLayoutsFromFrontmatter(undefined)).toBeUndefined();
    expect(readDashboardLayoutsFromFrontmatter({})).toBeUndefined();
    expect(
      readDashboardLayoutsFromFrontmatter({ [FRONTMATTER_DASHBOARD_LAYOUTS_KEY]: 'not json' }),
    ).toBeUndefined();
    // One bad entry does not poison a good sibling.
    const mixed = JSON.stringify({
      broken: { lb: 'Broken', ce: { ls: [] } },
      good: { lb: 'Good', ce: { ls: [{ x: '0%', y: '0%', wd: '100%', hg: '100%' }] } },
    });
    const read = readDashboardLayoutsFromFrontmatter({
      [FRONTMATTER_DASHBOARD_LAYOUTS_KEY]: mixed,
    });
    expect(read?.map((def) => def.name)).toEqual(['good']);
  });

  it('writes undefined for an empty list so the key stays off the doc', () => {
    expect(writeDashboardLayoutsToFrontmatter(undefined)).toBeUndefined();
    expect(writeDashboardLayoutsToFrontmatter([])).toBeUndefined();
  });

  it('pretty mode emits a multi-line block that still round-trips', () => {
    const pretty = writeDashboardLayoutsToFrontmatter([layout], { pretty: true })!;
    expect(pretty).toContain('\n');
    const read = readDashboardLayoutsFromFrontmatter({
      [FRONTMATTER_DASHBOARD_LAYOUTS_KEY]: pretty,
    });
    expect(read).toEqual([layout]);
  });
});
