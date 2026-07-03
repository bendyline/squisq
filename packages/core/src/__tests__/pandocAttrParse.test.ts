import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index.js';

function getHeading(md: string) {
  const doc = parseMarkdown(md);
  const heading = doc.children[0];
  if (heading.type !== 'heading') throw new Error('expected heading');
  return heading;
}

describe('Pandoc heading attribute parse', () => {
  it('extracts an id-only block', () => {
    const h = getHeading('## Section title {#intro}');
    expect(h.attributes).toEqual({ id: 'intro' });
    expect(h.templateAnnotation).toBeUndefined();
  });

  it('extracts classes', () => {
    const h = getHeading('## X {.alpha .beta}');
    expect(h.attributes?.classes).toEqual(['alpha', 'beta']);
  });

  it('extracts id + classes + params', () => {
    const h = getHeading('## X {#abc .v1 .v2 x=400 y=200}');
    expect(h.attributes?.id).toBe('abc');
    expect(h.attributes?.classes).toEqual(['v1', 'v2']);
    expect(h.attributes?.params).toEqual({ x: '400', y: '200' });
    expect(h.attributes?.blockMeta).toEqual({ x: 400, y: 200 });
  });

  it('coerces connectsTo to a typed list', () => {
    const h = getHeading('## X {connectsTo=foo:veryImportant,bar:requires,baz:requires}');
    expect(h.attributes?.blockMeta?.connectsTo).toEqual([
      { target: 'foo', type: 'veryImportant' },
      { target: 'bar', type: 'requires' },
      { target: 'baz', type: 'requires' },
    ]);
  });

  it('coerces startTime/duration to seconds', () => {
    const h = getHeading('## X {startTime=01:30 duration=00:45}');
    expect(h.attributes?.blockMeta?.startTime).toBe(90);
    expect(h.attributes?.blockMeta?.duration).toBe(45);
  });

  it('routes unknown keys to metadata', () => {
    const h = getHeading('## X {#a priority=high level=info}');
    expect(h.attributes?.metadata).toEqual({ priority: 'high', level: 'info' });
    expect(h.attributes?.blockMeta).toBeUndefined();
  });

  it('handles quoted values with spaces', () => {
    const h = getHeading('## X {caption="hello world"}');
    expect(h.attributes?.params).toEqual({ caption: 'hello world' });
    expect(h.attributes?.metadata).toEqual({ caption: 'hello world' });
  });

  it('preserves commas inside quoted values', () => {
    const h = getHeading('## X {caption="hello, friend"}');
    expect(h.attributes?.metadata).toEqual({ caption: 'hello, friend' });
  });

  it('escaped quotes inside quoted values', () => {
    const h = getHeading('## X {label="he said \\"hi\\""}');
    expect(h.attributes?.metadata?.label).toBe('he said "hi"');
  });

  it('handles single-quoted values with spaces', () => {
    const h = getHeading("## X {caption='hello world'}");
    expect(h.attributes?.params).toEqual({ caption: 'hello world' });
  });

  it('allows } inside a quoted value', () => {
    const h = getHeading('## X {caption="a } b"}');
    expect(h.attributes?.params).toEqual({ caption: 'a } b' });
  });

  it('treats an apostrophe inside an unquoted value as literal', () => {
    const h = getHeading("## X {name=O'Brien x=4}");
    expect(h.attributes?.metadata).toEqual({ name: "O'Brien" });
    expect(h.attributes?.blockMeta?.x).toBe(4);
  });

  it('duplicate id: last wins', () => {
    const h = getHeading('## X {#a #b}');
    expect(h.attributes?.id).toBe('b');
  });

  it('duplicate key: last wins', () => {
    const h = getHeading('## X {x=1 x=2}');
    expect(h.attributes?.blockMeta?.x).toBe(2);
  });

  it('does NOT match a non-trailing brace block', () => {
    const h = getHeading('## The {#wrong} section');
    expect(h.attributes).toBeUndefined();
  });

  it('does NOT collide with {[…]} template annotation', () => {
    const h = getHeading('## X {[chart]}');
    expect(h.templateAnnotation).toEqual({ template: 'chart' });
    expect(h.attributes).toBeUndefined();
  });
});

describe('Coexistence of {#…} and {[…]}', () => {
  it('Pandoc first, then template', () => {
    const h = getHeading('## X {#abc} {[chart]}');
    expect(h.attributes?.id).toBe('abc');
    expect(h.templateAnnotation?.template).toBe('chart');
  });

  it('Template first, then Pandoc (order-agnostic)', () => {
    const h = getHeading('## X {[chart]} {#abc}');
    expect(h.attributes?.id).toBe('abc');
    expect(h.templateAnnotation?.template).toBe('chart');
  });

  it('both with params on each side', () => {
    const h = getHeading('## X {#a x=400 y=200} {[chart colorScheme=blue]}');
    expect(h.attributes?.id).toBe('a');
    expect(h.attributes?.blockMeta?.x).toBe(400);
    expect(h.attributes?.blockMeta?.y).toBe(200);
    expect(h.templateAnnotation?.template).toBe('chart');
    expect(h.templateAnnotation?.params).toEqual({ colorScheme: 'blue' });
  });

  it('Pandoc block-meta does not leak into templateOverrides', () => {
    const h = getHeading('## X {#a x=400} {[chart colorScheme=blue]}');
    expect(h.templateAnnotation?.params).toEqual({ colorScheme: 'blue' });
    expect(h.attributes?.params).toEqual({ x: '400' });
  });
});

describe('Markdown round-trip with attributes', () => {
  it('Pandoc-only id round-trips', () => {
    const src = '## Section title {#intro}\n';
    const md = parseMarkdown(src);
    expect(stringifyMarkdown(md).trim()).toBe(src.trim());
  });

  it('canonicalizes order: Pandoc first, then template', () => {
    const input = '## X {[chart]} {#abc}\n';
    const md = parseMarkdown(input);
    const out = stringifyMarkdown(md).trim();
    expect(out).toBe('## X {#abc} {[chart]}');
  });

  it('full attribute set round-trips', () => {
    const src =
      '## Architecture {#arch x=600 y=300 connectsTo=foo:veryImportant,bar:requires,baz:requires} {[diagramNode]}\n';
    const md = parseMarkdown(src);
    const out = stringifyMarkdown(md).trim();
    expect(out).toBe(src.trim());
  });

  it('quoted value round-trips with quoting preserved', () => {
    const src = '## X {caption="hello world"}\n';
    const md = parseMarkdown(src);
    const out = stringifyMarkdown(md).trim();
    expect(out).toBe(src.trim());
  });

  it('existing {[…]}-only docs are unchanged', () => {
    const src = '## Getting Started {[chart colorScheme=blue]}\n';
    const md = parseMarkdown(src);
    const out = stringifyMarkdown(md).trim();
    expect(out).toBe(src.trim());
  });

  it('single-quoted values canonicalize to double quotes', () => {
    const md = parseMarkdown("## X {caption='hello world'}");
    expect(stringifyMarkdown(md).trim()).toBe('## X {caption="hello world"}');
  });

  it('a value containing a double quote round-trips via single quotes', () => {
    const src = '## X {label=\'say "hi"\'}';
    const md = parseMarkdown(src);
    expect(stringifyMarkdown(md).trim()).toBe(src);
  });

  it('a quoted } round-trips', () => {
    const src = '## X {caption="a } b"}';
    const md = parseMarkdown(src);
    expect(stringifyMarkdown(md).trim()).toBe(src);
  });
});
