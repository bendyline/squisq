import { describe, it, expect } from 'vitest';
import { validateMarkdownSource } from '../doc/validate.js';

function codes(md: string, options?: Parameters<typeof validateMarkdownSource>[1]): string[] {
  return validateMarkdownSource(md, options).diagnostics.map((d) => d.code);
}

describe('validateMarkdownSource — templates', () => {
  it('passes a clean document', () => {
    const result = validateMarkdownSource(
      '# Title\n\nBody.\n\n## Section {[quote]}\n\nA quote.\n',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('flags unknown templates with a did-you-mean suggestion', () => {
    const result = validateMarkdownSource('## Gallery {[photGrid columns=3]}');
    expect(result.warningCount).toBe(1);
    const d = result.diagnostics[0];
    expect(d.code).toBe('unknown-template');
    expect(d.message).toContain('photGrid');
    expect(d.message).toContain('Did you mean "photoGrid"?');
    expect(d.line).toBe(1);
  });

  it('accepts legacy template aliases', () => {
    expect(codes('## X {[titleBlock]}')).toEqual([]);
  });

  it('accepts extra templates supplied by the host app', () => {
    expect(codes('## X {[hero]}', { extraTemplates: ['hero'] })).toEqual([]);
    expect(codes('## X {[hero]}')).toEqual(['unknown-template']);
  });
});

describe('validateMarkdownSource — unparsed annotations', () => {
  it('flags {[…]} text in body content (annotations are heading-only)', () => {
    const result = validateMarkdownSource('## X\n\n- {[imageWithCaption src=photo.jpg]}\n');
    const d = result.diagnostics.find((x) => x.code === 'unparsed-annotation');
    expect(d).toBeDefined();
    expect(d!.message).toContain('headings');
    expect(d!.line).toBe(3);
  });

  it('flags non-trailing {[…]} text left in a heading', () => {
    const result = validateMarkdownSource('## The {[chart]} section\n');
    expect(result.diagnostics.map((d) => d.code)).toContain('unparsed-annotation');
  });

  it('does not flag resolved inline icons or code blocks', () => {
    const md = '## X\n\nUse {[github]} for code.\n\n```\nliteral {[notathing]}\n```\n';
    expect(codes(md)).toEqual([]);
  });
});

describe('validateMarkdownSource — attributes and structure', () => {
  it('surfaces malformed heading-attribute values', () => {
    const result = validateMarkdownSource('## X {#a x=abc}');
    const d = result.diagnostics.find((x) => x.code === 'invalid-attribute');
    expect(d).toBeDefined();
    expect(d!.message).toContain('x');
  });

  it('includes conversion diagnostics (duplicate ids, bad fences)', () => {
    const md = '## A {#dup}\n\n## B {#dup}\n\n```json data\nnot json\n```\n';
    const result = validateMarkdownSource(md);
    const found = result.diagnostics.map((d) => d.code);
    expect(found).toContain('duplicate-id');
    expect(found).toContain('data-fence-parse');
    expect(result.errorCount).toBe(2);
  });
});

describe('validateMarkdownSource — assets', () => {
  it('flags relative image references missing from the asset set', () => {
    const result = validateMarkdownSource('## X\n\n![hero](images/hero.jpg)\n', {
      assets: new Set<string>(),
    });
    const d = result.diagnostics.find((x) => x.code === 'missing-asset');
    expect(d).toBeDefined();
    expect(d!.message).toContain('images/hero.jpg');
  });

  it('passes when the asset exists, and skips absolute/external URLs', () => {
    const md =
      '## X\n\n![a](images/hero.jpg)\n\n![b](https://example.com/x.jpg)\n\n![c](data:image/png;base64,AA==)\n';
    expect(codes(md, { assets: new Set(['images/hero.jpg']) })).toEqual([]);
  });

  it('checks media params from {[…]} annotations', () => {
    const result = validateMarkdownSource('## X {[imageWithCaption src=missing.png]}', {
      assets: new Set<string>(),
    });
    expect(result.diagnostics.map((d) => d.code)).toContain('missing-asset');
  });

  it('skips asset checks entirely when no asset set is provided', () => {
    expect(codes('## X\n\n![hero](images/hero.jpg)\n')).toEqual([]);
  });
});
