import { describe, it, expect, afterEach } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { materializeLayers } from './materializeTestUtils.js';
import { templateRegistry } from '../doc/templates/index.js';
import type { Block, Layer } from '../schemas/Doc.js';

function textOf(layers: Layer[]): string {
  return layers
    .map((l) => (l.type === 'text' ? ((l.content as { text?: string }).text ?? '') : ''))
    .join('\n');
}

function firstBlock(md: string): Block {
  return markdownToDoc(parseMarkdown(md)).blocks[0];
}

describe('materializeBlockLayers — graceful degradation', () => {
  it('renders an unknown template as a plain card with title, body, and notice', () => {
    const block = firstBlock('## My Section {[photGrid]}\n\nSome body prose here.');
    const layers = materializeLayers(block);
    expect(layers.length).toBeGreaterThan(0);
    const text = textOf(layers);
    expect(text).toContain('My Section');
    expect(text).toContain('Some body prose here.');
    expect(text).toContain('Unknown template "photGrid"');
  });

  // The notice color was built by string concat (`${colors.text}99`). Theme
  // scheme colors may be 3-digit `#rgb` (the validator accepts them), and
  // `#abc99` is not valid CSS — the notice silently lost its color, on the
  // one layer whose whole job is explaining why the block degraded.
  it('renders the notice in a valid translucent CSS color', () => {
    const block = firstBlock('## My Section {[photGrid]}\n\nBody.');
    const notice = materializeLayers(block).find((l) => l.id === 'fallback-notice');

    expect(notice).toBeDefined();
    const color = (notice as { content: { style: { color: string } } }).content.style.color;
    expect(color).toMatch(/^rgba\(/);
    expect(color).toContain('0.6');
  });

  it('renders a fallback card when a template function throws', () => {
    (templateRegistry as Record<string, unknown>)['__boom'] = () => {
      throw new Error('kaboom');
    };
    try {
      const block: Block = {
        id: 'b1',
        startTime: 0,
        duration: 5,
        audioSegment: 0,
        template: '__boom',
        title: 'Exploding block',
      };
      const layers = materializeLayers(block);
      expect(layers.length).toBeGreaterThan(0);
      expect(textOf(layers)).toContain('Template "__boom" failed');
      expect(textOf(layers)).toContain('Exploding block');
    } finally {
      delete (templateRegistry as Record<string, unknown>)['__boom'];
    }
  });

  it('blocks with no template at all still return empty layers', () => {
    const block: Block = { id: 'raw', startTime: 0, duration: 5, audioSegment: 0 };
    expect(materializeLayers(block)).toEqual([]);
  });
});

describe('materializeBlockLayers — structured data feeds templates', () => {
  afterEach(() => {
    delete (templateRegistry as Record<string, unknown>)['__capture'];
  });

  it('merges templateData and templateOverrides into the template input', () => {
    let received: Record<string, unknown> | null = null;
    (templateRegistry as Record<string, unknown>)['__capture'] = (
      input: Record<string, unknown>,
    ) => {
      received = input;
      return [];
    };
    const block: Block = {
      id: 'b1',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      template: '__capture',
      templateData: { rows: [['a', 'b']], zoom: 12 },
      templateOverrides: { zoom: '14' },
    };
    materializeLayers(block);
    expect(received).not.toBeNull();
    expect(received!['rows']).toEqual([['a', 'b']]);
    // String overrides from {[…]} params win last.
    expect(received!['zoom']).toBe('14');
  });

  it('renders a dataTable from a GFM table in the markdown body', () => {
    const md = [
      '## People {[dataTable]}',
      '',
      '| Name | Age |',
      '| --- | --- |',
      '| Alice | 30 |',
    ].join('\n');
    const block = firstBlock(md);
    const layers = materializeLayers(block);
    expect(layers.length).toBeGreaterThan(0);
    const tableLayer = layers.find((l) => l.type === 'table');
    expect(tableLayer).toBeDefined();
    const content = tableLayer!.content as { headers?: string[]; rows?: string[][] };
    expect(content.headers).toEqual(['Name', 'Age']);
    expect(content.rows).toEqual([['Alice', '30']]);
  });
});
