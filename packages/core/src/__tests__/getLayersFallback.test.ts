import { describe, it, expect, afterEach } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { getLayers } from '../doc/getLayers.js';
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

describe('getLayers — graceful degradation', () => {
  it('renders an unknown template as a plain card with title, body, and notice', () => {
    const block = firstBlock('## My Section {[photGrid]}\n\nSome body prose here.');
    const layers = getLayers(block);
    expect(layers.length).toBeGreaterThan(0);
    const text = textOf(layers);
    expect(text).toContain('My Section');
    expect(text).toContain('Some body prose here.');
    expect(text).toContain('Unknown template "photGrid"');
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
      const layers = getLayers(block);
      expect(layers.length).toBeGreaterThan(0);
      expect(textOf(layers)).toContain('Template "__boom" failed');
      expect(textOf(layers)).toContain('Exploding block');
    } finally {
      delete (templateRegistry as Record<string, unknown>)['__boom'];
    }
  });

  it('blocks with no template at all still return empty layers', () => {
    const block: Block = { id: 'raw', startTime: 0, duration: 5, audioSegment: 0 };
    expect(getLayers(block)).toEqual([]);
  });
});

describe('getLayers — structured data feeds templates', () => {
  afterEach(() => {
    delete (templateRegistry as Record<string, unknown>)['__capture'];
  });

  it('merges templateData and templateOverrides into the template input', () => {
    let received: Record<string, unknown> | null = null;
    (templateRegistry as Record<string, unknown>)['__capture'] = (input: Record<string, unknown>) => {
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
    getLayers(block);
    expect(received).not.toBeNull();
    expect(received!['rows']).toEqual([['a', 'b']]);
    // String overrides from {[…]} params win last.
    expect(received!['zoom']).toBe('14');
  });

  it('renders a dataTable from a GFM table in the markdown body', () => {
    const md = ['## People {[dataTable]}', '', '| Name | Age |', '| --- | --- |', '| Alice | 30 |'].join(
      '\n',
    );
    const block = firstBlock(md);
    const layers = getLayers(block);
    expect(layers.length).toBeGreaterThan(0);
    const tableLayer = layers.find((l) => l.type === 'table');
    expect(tableLayer).toBeDefined();
    const content = tableLayer!.content as { headers?: string[]; rows?: string[][] };
    expect(content.headers).toEqual(['Name', 'Age']);
    expect(content.rows).toEqual([['Alice', '30']]);
  });
});
