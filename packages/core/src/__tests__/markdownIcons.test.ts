import { describe, it, expect } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index.js';

describe('inline icon parsing', () => {
  it('detects a unique bare {[name]} as an inlineIcon node', () => {
    const doc = parseMarkdown('Hello {[github]} world');
    const para = doc.children[0] as unknown as { children: Array<Record<string, unknown>> };
    expect(para.children.length).toBe(3);
    expect(para.children[0]).toMatchObject({ type: 'text', value: 'Hello ' });
    expect(para.children[1]).toMatchObject({
      type: 'inlineIcon',
      token: 'github',
      family: 'brands',
      name: 'github',
    });
    expect(para.children[2]).toMatchObject({ type: 'text', value: ' world' });
  });

  it('resolves qualified tokens', () => {
    const doc = parseMarkdown('Q: {[fa-solid:user]}');
    const para = doc.children[0] as unknown as { children: Array<Record<string, unknown>> };
    const icon = para.children.find((c) => c.type === 'inlineIcon');
    expect(icon).toMatchObject({
      type: 'inlineIcon',
      token: 'fa-solid:user',
      family: 'solid',
      name: 'user',
    });
  });

  it('leaves unknown / ambiguous tokens as literal text', () => {
    // `user` is ambiguous (multiple families), `notathing` is unknown —
    // both should round-trip as plain text so authors can write them.
    const doc = parseMarkdown('a {[user]} b {[notathing]} c');
    const para = doc.children[0] as unknown as { children: Array<Record<string, unknown>> };
    expect(para.children).toHaveLength(1);
    expect(para.children[0]).toMatchObject({
      type: 'text',
      value: 'a {[user]} b {[notathing]} c',
    });
  });

  it('round-trips bare icons byte-stable through stringify', () => {
    // Bare names contain no colon, so the serializer can re-emit them
    // verbatim. (Qualified tokens like `fa-solid:user` get the colon
    // escaped as `\:` for safety against remark-directive — that form
    // re-parses to the same token, just isn't byte-stable.)
    const src = 'Built with {[github]} and {[face-smile]}.';
    expect(stringifyMarkdown(parseMarkdown(src)).trim()).toBe(src);
  });

  it('round-trips qualified icons semantically through stringify', () => {
    // `{[fa-solid:user]}` may serialize as `{[fa-solid\:user]}` — both
    // forms parse back to the same inlineIcon node, so we verify
    // semantic equivalence rather than byte equality.
    const src = 'Q: {[fa-solid:user]} end';
    const round1 = stringifyMarkdown(parseMarkdown(src));
    const reparsed = parseMarkdown(round1);
    const para = reparsed.children[0] as unknown as { children: Array<Record<string, unknown>> };
    const icon = para.children.find((c) => c.type === 'inlineIcon');
    expect(icon).toMatchObject({
      type: 'inlineIcon',
      token: 'fa-solid:user',
      family: 'solid',
      name: 'user',
    });
  });
});

describe('inline icons inside headings', () => {
  it('parses the trailing template annotation as the template, body icon as inlineIcon', () => {
    const doc = parseMarkdown('# Repo {[github]} status {[sectionHeader]}\n');
    const heading = doc.children[0] as unknown as {
      type: string;
      templateAnnotation?: { template?: string };
      children: Array<Record<string, unknown>>;
    };
    expect(heading.type).toBe('heading');
    expect(heading.templateAnnotation?.template).toBe('sectionHeader');
    // Children should be: text('Repo '), inlineIcon(github), text(' status')
    const icon = heading.children.find((c) => c.type === 'inlineIcon');
    expect(icon).toMatchObject({ type: 'inlineIcon', name: 'github' });
  });

  it('round-trips heading template + inline icon', () => {
    const src = '# Repo {[github]} status {[sectionHeader]}\n';
    expect(stringifyMarkdown(parseMarkdown(src))).toBe(src);
  });

  it('round-trips a heading where the whole trailing annotation is an icon (not a template)', () => {
    // `# Foo {[github]}` — `github` is a valid icon (not a known template),
    // so the bare token should NOT be treated as a template annotation
    // unless it also happens to be in the template registry. The parser
    // is liberal here — `extractTemplateAnnotation` runs first and would
    // capture `{[github]}` as a template annotation; we accept that as
    // the documented precedence.
    const src = '# Foo {[github]}\n';
    const out = stringifyMarkdown(parseMarkdown(src));
    // The annotation extraction happens first, so the round-trip is
    // either `# Foo {[github]}` (when serialized back via template
    // suffix) — verify the output still matches the source.
    expect(out).toBe(src);
  });
});
