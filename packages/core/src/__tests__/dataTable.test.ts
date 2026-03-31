import { describe, it, expect } from 'vitest';
import { getLayers, RenderContext } from '../doc/getLayers.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import type { TemplateBlock } from '../schemas/BlockTemplates.js';
import type { TableLayer } from '../schemas/Doc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataTableBlock(overrides: Record<string, unknown> = {}): TemplateBlock {
  return {
    template: 'dataTable',
    id: 'dt-1',
    duration: 5,
    audioSegment: 0,
    headers: ['Name', 'Value'],
    rows: [
      ['Alpha', '100'],
      ['Beta', '200'],
    ],
    ...overrides,
  } as TemplateBlock;
}

const defaultContext: RenderContext = {
  theme: DEFAULT_THEME,
  viewport: VIEWPORT_PRESETS.landscape,
  blockIndex: 0,
  totalBlocks: 5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dataTable template', () => {
  it('produces layers including a table layer', () => {
    const layers = getLayers(makeDataTableBlock(), defaultContext);
    expect(layers.length).toBeGreaterThan(0);

    const tableLayer = layers.find((l) => l.type === 'table');
    expect(tableLayer).toBeDefined();
  });

  it('table layer contains the correct headers', () => {
    const layers = getLayers(makeDataTableBlock(), defaultContext);
    const tableLayer = layers.find((l) => l.type === 'table') as TableLayer;

    expect(tableLayer.content.headers).toEqual(['Name', 'Value']);
  });

  it('table layer contains the correct rows', () => {
    const layers = getLayers(makeDataTableBlock(), defaultContext);
    const tableLayer = layers.find((l) => l.type === 'table') as TableLayer;

    expect(tableLayer.content.rows).toEqual([
      ['Alpha', '100'],
      ['Beta', '200'],
    ]);
  });

  it('includes a title text layer when title is provided', () => {
    const layers = getLayers(makeDataTableBlock({ title: 'My Table' }), defaultContext);
    const textLayers = layers.filter((l) => l.type === 'text');

    expect(textLayers.length).toBeGreaterThanOrEqual(1);
    const titleLayer = textLayers.find((l) => l.type === 'text' && l.content.text === 'My Table');
    expect(titleLayer).toBeDefined();
  });

  it('omits title layer when no title is given', () => {
    const layers = getLayers(makeDataTableBlock({ title: undefined }), defaultContext);
    const textLayers = layers.filter((l) => l.type === 'text');

    // Should have no text layers (only bg + table)
    expect(textLayers.length).toBe(0);
  });

  it('includes a background layer', () => {
    const layers = getLayers(makeDataTableBlock(), defaultContext);
    // Background is the first layer (shape with gradient fill)
    expect(['shape', 'image']).toContain(layers[0].type);
  });

  it('passes column alignment to the table layer', () => {
    const layers = getLayers(makeDataTableBlock({ align: ['left', 'right'] }), defaultContext);
    const tableLayer = layers.find((l) => l.type === 'table') as TableLayer;

    expect(tableLayer.content.align).toEqual(['left', 'right']);
  });

  it('applies theme colors to table styling', () => {
    const layers = getLayers(makeDataTableBlock(), defaultContext);
    const tableLayer = layers.find((l) => l.type === 'table') as TableLayer;
    const style = tableLayer.content.style;

    // Style fields should be populated strings/numbers
    expect(style.headerBackground).toBeTruthy();
    expect(style.headerColor).toBeTruthy();
    expect(style.cellColor).toBeTruthy();
    expect(style.borderColor).toBeTruthy();
    expect(typeof style.fontSize).toBe('number');
    expect(style.fontSize).toBeGreaterThan(0);
  });

  it('adjusts table position when title is present vs absent', () => {
    const withTitle = getLayers(makeDataTableBlock({ title: 'Title' }), defaultContext);
    const withoutTitle = getLayers(makeDataTableBlock({ title: undefined }), defaultContext);

    const tableWithTitle = withTitle.find((l) => l.type === 'table') as TableLayer;
    const tableWithoutTitle = withoutTitle.find((l) => l.type === 'table') as TableLayer;

    // Table should be positioned lower when a title is present
    expect(tableWithTitle.position.y).not.toBe(tableWithoutTitle.position.y);
  });

  it('works with portrait viewport', () => {
    const portraitContext: RenderContext = {
      ...defaultContext,
      viewport: VIEWPORT_PRESETS.portrait,
    };
    const layers = getLayers(makeDataTableBlock(), portraitContext);
    expect(layers.length).toBeGreaterThan(0);
    const tableLayer = layers.find((l) => l.type === 'table');
    expect(tableLayer).toBeDefined();
  });

  it('handles empty rows gracefully', () => {
    const layers = getLayers(makeDataTableBlock({ headers: ['A', 'B'], rows: [] }), defaultContext);
    const tableLayer = layers.find((l) => l.type === 'table') as TableLayer;
    expect(tableLayer.content.rows).toEqual([]);
  });
});
