import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { parseYamlSubset, replaceDataFence } from '../doc/structuredData.js';
import type { MarkdownCodeBlock } from '../markdown/types.js';

function toDoc(md: string) {
  return markdownToDoc(parseMarkdown(md));
}

describe('parseYamlSubset', () => {
  it('parses scalars with type coercion', () => {
    expect(parseYamlSubset('title: Hello world\ncount: 3\nlive: true\nnothing: null')).toEqual({
      title: 'Hello world',
      count: 3,
      live: true,
      nothing: null,
    });
  });

  it('parses inline arrays', () => {
    expect(parseYamlSubset('headers: [Name, Age]')).toEqual({ headers: ['Name', 'Age'] });
  });

  it('parses block sequences of scalars and inline arrays', () => {
    expect(
      parseYamlSubset('rows:\n  - [Alice, 30]\n  - [Bob, 25]\nmarkers:\n  - "47.6,-122.3"'),
    ).toEqual({
      rows: [
        ['Alice', 30],
        ['Bob', 25],
      ],
      markers: ['47.6,-122.3'],
    });
  });

  it('preserves quoted strings (commas, numbers stay strings)', () => {
    expect(parseYamlSubset('label: "1,234"')).toEqual({ label: '1,234' });
  });

  it('skips comments and blank lines', () => {
    expect(parseYamlSubset('# comment\n\nkey: value')).toEqual({ key: 'value' });
  });

  it('parses one level of nested mapping', () => {
    expect(parseYamlSubset('center:\n  lat: 47.6\n  lng: -122.3\nzoom: 12')).toEqual({
      center: { lat: 47.6, lng: -122.3 },
      zoom: 12,
    });
  });

  it('rejects nesting deeper than one level with a line-anchored error', () => {
    expect(() => parseYamlSubset('a:\n  b:\n    c: 1')).toThrow(/line 2/);
    expect(() => parseYamlSubset('a:\n  b: 1\n    c: 2')).toThrow(/line 3/);
  });

  it('rejects mixing list items and mapping keys under one key', () => {
    expect(() => parseYamlSubset('a:\n  - x\n  b: 1')).toThrow(/mix/);
    expect(() => parseYamlSubset('a:\n  b: 1\n  - x')).toThrow(/mix/);
  });
});

describe('data fences → block.templateData', () => {
  it('parses a ```json data fence into templateData', () => {
    const md = [
      '## Numbers {[dataTable]}',
      '',
      '```json data',
      '{ "headers": ["Q", "Revenue"], "rows": [["Q1", "1.2M"]] }',
      '```',
    ].join('\n');
    const doc = toDoc(md);
    expect(doc.blocks[0].templateData).toEqual({
      headers: ['Q', 'Revenue'],
      rows: [['Q1', '1.2M']],
    });
    expect(doc.diagnostics).toBeUndefined();
  });

  it('parses a ```yaml data fence into templateData', () => {
    const md = [
      '## Map {[map]}',
      '',
      '```yaml data',
      'zoom: 12',
      'markers:',
      '  - "47.6,-122.3"',
      '```',
    ].join('\n');
    const doc = toDoc(md);
    expect(doc.blocks[0].templateData).toEqual({ zoom: 12, markers: ['47.6,-122.3'] });
  });

  it('ignores plain ```json fences without the data marker', () => {
    const md = '## Code {[sectionHeader]}\n\n```json\n{ "just": "a sample" }\n```';
    const doc = toDoc(md);
    expect(doc.blocks[0].templateData).toBeUndefined();
  });

  it('records a diagnostic for unparseable fences and degrades gracefully', () => {
    const md = '## Bad {[dataTable]}\n\n```json data\n{ not valid json\n```';
    const doc = toDoc(md);
    expect(doc.blocks[0].templateData).toBeUndefined();
    expect(doc.diagnostics).toHaveLength(1);
    expect(doc.diagnostics![0]).toMatchObject({ severity: 'error', code: 'data-fence-parse' });
    expect(doc.diagnostics![0].line).toBe(3);
  });
});

describe('replaceDataFence', () => {
  it('replaces the first data fence content, keeping lang and meta', () => {
    const doc = toDoc(
      '## Numbers {[dataTable]}\n\nIntro.\n\n```json data\n{ "headers": ["Q"] }\n```',
    );
    const contents = doc.blocks[0].contents!;

    const next = replaceDataFence(contents, { headers: ['Q', 'Revenue'] });

    const fence = next.find((n): n is MarkdownCodeBlock => n.type === 'code')!;
    expect(fence.lang).toBe('json');
    expect(fence.meta).toBe('data');
    expect(JSON.parse(fence.value)).toEqual({ headers: ['Q', 'Revenue'] });
    // Pretty-printed, not single-line.
    expect(fence.value).toContain('\n');
    // Same length, other nodes untouched.
    expect(next).toHaveLength(contents.length);
    expect(next[0]).toBe(contents[0]);
  });

  it('does not mutate the input array or the original fence node', () => {
    const doc = toDoc('## Numbers {[dataTable]}\n\n```json data\n{ "a": 1 }\n```');
    const contents = doc.blocks[0].contents!;
    const originalFence = contents.find((n): n is MarkdownCodeBlock => n.type === 'code')!;

    replaceDataFence(contents, { a: 2 });

    expect(originalFence.value).toBe('{ "a": 1 }');
  });

  it('appends a new ```json data fence when none exists', () => {
    const doc = toDoc('## Numbers {[dataTable]}\n\nJust text.');
    const contents = doc.blocks[0].contents!;

    const next = replaceDataFence(contents, { rows: [['Q1', '1.2M']] });

    expect(next).toHaveLength(contents.length + 1);
    const fence = next[next.length - 1] as MarkdownCodeBlock;
    expect(fence).toMatchObject({ type: 'code', lang: 'json', meta: 'data' });
    expect(JSON.parse(fence.value)).toEqual({ rows: [['Q1', '1.2M']] });
  });

  it('treats plain code fences (no data marker) as non-fences and appends', () => {
    const doc = toDoc('## Code {[sectionHeader]}\n\n```json\n{ "just": "a sample" }\n```');
    const contents = doc.blocks[0].contents!;

    const next = replaceDataFence(contents, { a: 1 });

    // The sample fence is untouched; a data fence is appended after it.
    const sample = next.find((n): n is MarkdownCodeBlock => n.type === 'code' && !n.meta)!;
    expect(sample.value).toBe('{ "just": "a sample" }');
    expect(next).toHaveLength(contents.length + 1);
    expect((next[next.length - 1] as MarkdownCodeBlock).meta).toBe('data');
  });
});

describe('dataTable eats GFM tables', () => {
  const table = ['| Name | Age |', '| --- | ---: |', '| Alice | 30 |', '| Bob | 25 |'].join('\n');

  it('supplies headers/rows/align from the first table in the body', () => {
    const doc = toDoc(`## People {[dataTable]}\n\n${table}`);
    expect(doc.blocks[0].templateData).toEqual({
      headers: ['Name', 'Age'],
      rows: [
        ['Alice', '30'],
        ['Bob', '25'],
      ],
      align: [null, 'right'],
    });
  });

  it('does not extract tables for non-dataTable templates', () => {
    const doc = toDoc(`## People {[sectionHeader]}\n\n${table}`);
    expect(doc.blocks[0].templateData).toBeUndefined();
  });

  it('explicit fence data wins over the body table', () => {
    const md = [
      '## People {[dataTable]}',
      '',
      '```json data',
      '{ "headers": ["X"], "rows": [["1"]] }',
      '```',
      '',
      table,
    ].join('\n');
    const doc = toDoc(md);
    expect(doc.blocks[0].templateData).toEqual({ headers: ['X'], rows: [['1']] });
  });
});

describe('deterministic conversion', () => {
  const md = '# Title\n\nSome body text.\n\n## Section {[quote]}\n\nA quote here.';

  it('produces identical Docs for identical input', () => {
    expect(toDoc(md)).toEqual(toDoc(md));
  });

  it('omits captions.generatedAt unless a timestamp is supplied', () => {
    const doc = toDoc(md);
    expect(doc.captions).toBeDefined();
    expect(doc.captions!.generatedAt).toBeUndefined();

    const stamped = markdownToDoc(parseMarkdown(md), {
      captionsGeneratedAt: '2026-06-10T00:00:00.000Z',
    });
    expect(stamped.captions!.generatedAt).toBe('2026-06-10T00:00:00.000Z');
  });
});

describe('conversion diagnostics', () => {
  it('flags duplicate pinned ids', () => {
    const doc = toDoc('## A {#dup}\n\n## B {#dup}');
    expect(doc.diagnostics).toBeDefined();
    expect(doc.diagnostics![0]).toMatchObject({ severity: 'error', code: 'duplicate-id' });
  });

  it('a pinned id reserves the slug so a later heading does not collide', () => {
    const doc = toDoc('## Other name {#intro}\n\n## Intro');
    const ids = doc.blocks.map((b) => b.id);
    expect(ids[0]).toBe('intro');
    expect(ids[1]).not.toBe('intro');
    expect(doc.diagnostics).toBeUndefined();
  });

  it('flags connectsTo targets that do not resolve', () => {
    const doc = toDoc('## A {#a connectsTo=ghost}\n\n## B {#b}');
    expect(doc.diagnostics).toBeDefined();
    expect(doc.diagnostics![0]).toMatchObject({
      severity: 'warning',
      code: 'unresolved-connection',
      blockId: 'a',
    });
  });

  it('resolved connections produce no diagnostics', () => {
    const doc = toDoc('## A {#a connectsTo=b}\n\n## B {#b}');
    expect(doc.diagnostics).toBeUndefined();
  });
});
