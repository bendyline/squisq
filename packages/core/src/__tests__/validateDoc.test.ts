import { describe, it, expect } from 'vitest';
import { validateMarkdownSource } from '../doc/validate.js';
import { writeCustomTemplatesToFrontmatter } from '../doc/customTemplatesFrontmatter';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';

function codes(md: string, options?: Parameters<typeof validateMarkdownSource>[1]): string[] {
  return validateMarkdownSource(md, options).diagnostics.map((d) => d.code);
}

describe('validateMarkdownSource — templates', () => {
  it('passes a clean document', () => {
    const result = validateMarkdownSource('# Title\n\nBody.\n\n## Section {[quote]}\n\nA quote.\n');
    expect(result.diagnostics).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.infoCount).toBe(0);
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

describe('validateMarkdownSource — conflicting annotation keys', () => {
  it('flags a block-meta key set differently in both {[…]} and {…}', () => {
    const result = validateMarkdownSource('## X {[sectionHeader duration=8]} {#x duration=10}\n');
    const d = result.diagnostics.find((x) => x.code === 'conflicting-annotation-key');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('info');
    expect(d!.message).toBe(
      '"duration" is set in both {[…]} (8) and {…} (10) — the {…} value wins.',
    );
    expect(d!.blockId).toBe('x');
    expect(d!.line).toBe(1);
    expect(result.infoCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    // Precedence itself is unchanged: the Pandoc value is in effect.
    expect(result.doc.blocks[0].duration).toBe(10);
  });

  it('stays silent when both forms agree', () => {
    expect(codes('## X {[sectionHeader duration=8]} {#x duration=8}\n')).toEqual([]);
  });

  it('ignores non-block-meta keys (they land in different channels)', () => {
    // `style` goes to templateOverrides ({[…]}) and metadata ({…}) — no conflict.
    expect(codes('## X {[factCard style=minimal]} {#x style=bold}\n')).toEqual([]);
  });

  it('reports each conflicting key separately', () => {
    const result = validateMarkdownSource(
      '## X {[sectionHeader duration=8 startTime=1]} {#x duration=10 startTime=2}\n',
    );
    const found = result.diagnostics.filter((d) => d.code === 'conflicting-annotation-key');
    expect(found).toHaveLength(2);
    expect(result.infoCount).toBe(2);
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

describe('validateMarkdownSource — template inputs', () => {
  it('flags an unknown input with a did-you-mean suggestion', () => {
    const result = validateMarkdownSource('## Where {[map centre="47.6,-122.3"]}');
    const d = result.diagnostics.find((x) => x.code === 'unknown-input');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.message).toContain('centre');
    expect(d!.message).toContain('Did you mean "center"?');
    expect(d!.line).toBe(1);
  });

  it('flags a value outside a closed enum', () => {
    const result = validateMarkdownSource('## Where {[map center="1,2" mapStyle="nope"]}');
    const d = result.diagnostics.find((x) => x.code === 'invalid-input-value');
    expect(d).toBeDefined();
    expect(d!.message).toContain('mapStyle');
    expect(d!.message).toContain('terrain');
  });

  it('flags a missing required input', () => {
    const codesFor = codes('## Compare {[twoColumn]}');
    expect(codesFor.filter((c) => c === 'missing-input')).toEqual([
      'missing-input',
      'missing-input',
    ]);
  });

  it('does not fire missing-input when the value is derivable from the body', () => {
    const md = '## Caption {[imageWithCaption]}\n\n![a beach](beach.jpg)\n';
    // imageSrc is required, but derivable from the body image → no warning.
    expect(codes(md)).not.toContain('missing-input');
  });

  it('does fire missing-input when the value is not derivable and absent', () => {
    // No body image → imageSrc is neither present nor derivable.
    expect(codes('## Caption {[imageWithCaption]}')).toContain('missing-input');
  });

  it('does not lint blocks that resolve to a doc-declared custom template', () => {
    // A custom template that shadows the built-in "map" name carries its own
    // arbitrary inputs — the built-in descriptors must not be applied to it.
    const custom: CustomTemplateDefinition = {
      name: 'map',
      label: 'My Map',
      description: 'custom',
      viewport: { width: 1920, height: 1080 },
      layers: [
        {
          id: 't',
          type: 'text',
          position: { x: '5%', y: '10%' },
          content: { text: '{title}', style: { fontSize: 40, color: '#000' } },
        },
      ],
    };
    const encoded = writeCustomTemplatesToFrontmatter([custom])!;
    const md = `---\nsquisq-custom-templates: ${encoded}\n---\n\n## Hi {[map foo="bar"]}\n`;
    const codesFor = validateMarkdownSource(md).diagnostics.map((d) => d.code);
    expect(codesFor).not.toContain('unknown-input');
    expect(codesFor).not.toContain('missing-input');
  });

  it('does not lint templates without descriptors', () => {
    // sectionHeader has no input descriptors → arbitrary keys are not flagged.
    expect(codes('## Break {[sectionHeader whatever=5]}')).toEqual([]);
  });

  it('leaves a clean, fully-specified block with no findings', () => {
    const md = '## Where {[map center="47.6,-122.3" zoom=9 mapStyle="terrain"]}';
    expect(codes(md)).toEqual([]);
  });
});

describe('validateMarkdownSource — standalone annotations (S2)', () => {
  it('does not flag a valid standalone template annotation as unparsed', () => {
    const result = validateMarkdownSource('# H\n\n{[quote]}\n\nquoted\n');
    expect(result.diagnostics.find((d) => d.code === 'unparsed-annotation')).toBeUndefined();
    expect(result.diagnostics.find((d) => d.code === 'unknown-template')).toBeUndefined();
  });

  it('reports unknown-template for a standalone annotation with a bad name', () => {
    const result = validateMarkdownSource('# H\n\n{[quotte]}\n\nquoted\n');
    const d = result.diagnostics.find((x) => x.code === 'unknown-template');
    expect(d).toBeDefined();
    expect(d!.message).toContain('quotte');
    // Not double-reported as an unparsed annotation.
    expect(result.diagnostics.find((x) => x.code === 'unparsed-annotation')).toBeUndefined();
  });

  it('still flags {[…]} nested inside a list (not a standalone block)', () => {
    const result = validateMarkdownSource('## X\n\n- {[imageWithCaption src=x.jpg]}\n');
    const d = result.diagnostics.find((x) => x.code === 'unparsed-annotation');
    expect(d).toBeDefined();
    expect(d!.message).toContain('standalone paragraphs');
  });
});

describe('validateMarkdownSource — possible-data-fence (S3)', () => {
  const info = (md: string) =>
    validateMarkdownSource(md).diagnostics.filter((d) => d.code === 'possible-data-fence');

  it('nudges an unmarked json fence inside a template-annotated block', () => {
    const md = '## Numbers {[dataTable]}\n\n```json\n{ "headers": ["A"], "rows": [] }\n```\n';
    const d = info(md);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('info');
    expect(d[0].message).toContain('```json data');
  });

  it('does not fire for a code sample in a non-templated prose section', () => {
    const md = '## Notes\n\n```json\n{ "a": 1 }\n```\n';
    expect(info(md)).toHaveLength(0);
  });

  it('does not fire when the fence already has the data marker', () => {
    const md = '## Numbers {[dataTable]}\n\n```json data\n{ "headers": ["A"], "rows": [] }\n```\n';
    expect(info(md)).toHaveLength(0);
  });
});
