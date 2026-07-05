import { describe, it, expect } from 'vitest';
import {
  BASE_INPUT_DESCRIPTORS,
  TEMPLATE_INPUT_DESCRIPTORS,
  coerceTemplateParams,
  lintTemplateParams,
} from '../doc/templates/inputDescriptors';
import { templateRegistry } from '../doc/templates/index';

describe('coerceTemplateParams', () => {
  it('coerces number keys, leaving the raw string on failure', () => {
    expect(coerceTemplateParams('map', { zoom: '9' }).input).toEqual({ zoom: 9 });

    const bad = coerceTemplateParams('map', { zoom: 'abc' });
    expect(bad.input).toEqual({ zoom: 'abc' });
    expect(bad.warnings).toHaveLength(1);
    expect(bad.warnings[0]).toContain('zoom');
  });

  it('coerces boolean keys (true/empty → true, false → false)', () => {
    const { input } = coerceTemplateParams('imageWithCaption', { isTitle: 'true' });
    expect(input.isTitle).toBe(true);
    // A bare flag `{[… isTitle]}` parses to an empty value → true.
    expect(coerceTemplateParams('imageWithCaption', { isTitle: '' }).input.isTitle).toBe(true);
    expect(coerceTemplateParams('imageWithCaption', { isTitle: 'false' }).input.isTitle).toBe(
      false,
    );

    const bad = coerceTemplateParams('imageWithCaption', { isTitle: 'maybe' });
    expect(bad.input.isTitle).toBe('maybe');
    expect(bad.warnings).toHaveLength(1);
  });

  it('coerces latLng into { lat, lng }, warning on malformed input', () => {
    expect(coerceTemplateParams('map', { center: '47.6,-122.3' }).input).toEqual({
      center: { lat: 47.6, lng: -122.3 },
    });

    const bad = coerceTemplateParams('map', { center: 'nope' });
    expect(bad.input).toEqual({ center: 'nope' });
    expect(bad.warnings[0]).toContain('center');
  });

  it('coerces labeledPair into { label, sublabel? }', () => {
    expect(coerceTemplateParams('twoColumn', { left: 'Espresso|Bold' }).input).toEqual({
      left: { label: 'Espresso', sublabel: 'Bold' },
    });
    // No separator → label only, no sublabel key.
    expect(coerceTemplateParams('twoColumn', { right: 'Filter' }).input).toEqual({
      right: { label: 'Filter' },
    });
  });

  it('coerces stringList by splitting on commas and trimming', () => {
    expect(coerceTemplateParams('photoGrid', { images: 'a.jpg, b.jpg ,c.jpg' }).input).toEqual({
      images: ['a.jpg', 'b.jpg', 'c.jpg'],
    });
  });

  it('passes unknown keys through unchanged as strings (never lossy)', () => {
    const { input, warnings } = coerceTemplateParams('map', { wobble: 'yes', center: '1,2' });
    expect(input.wobble).toBe('yes');
    expect(input.center).toEqual({ lat: 1, lng: 2 });
    expect(warnings).toEqual([]);
  });

  it('passes everything through for a template with no descriptors', () => {
    expect(coerceTemplateParams('sectionHeader', { anything: '5' }).input).toEqual({
      anything: '5',
    });
  });

  it('resolves legacy template aliases before coercing', () => {
    expect(coerceTemplateParams('mapBlock', { zoom: '7' }).input).toEqual({ zoom: 7 });
  });

  it('coerces shared base inputs (useTopLayer boolean)', () => {
    expect(coerceTemplateParams('title', { useTopLayer: 'false' }).input.useTopLayer).toBe(false);
  });
});

describe('lintTemplateParams', () => {
  it('returns [] for a template without descriptors', () => {
    expect(lintTemplateParams('sectionHeader', { foo: 'bar' })).toEqual([]);
  });

  it('flags an unknown input with a did-you-mean suggestion', () => {
    const findings = lintTemplateParams('map', { centre: '1,2' });
    const unknown = findings.find((f) => f.kind === 'unknown-input');
    expect(unknown).toBeDefined();
    expect(unknown!.key).toBe('centre');
    expect(unknown!.suggestion).toBe('center');
    expect(unknown!.message).toContain('Did you mean "center"?');
  });

  it('does not flag block-meta keys carried on the same annotation', () => {
    const findings = lintTemplateParams('title', { duration: '8', transition: 'fade' });
    expect(findings.filter((f) => f.kind === 'unknown-input')).toEqual([]);
  });

  it('flags a value outside a closed enum', () => {
    const findings = lintTemplateParams('map', { center: '1,2', mapStyle: 'nope' });
    const invalid = findings.find((f) => f.kind === 'invalid-input-value');
    expect(invalid).toBeDefined();
    expect(invalid!.key).toBe('mapStyle');
    expect(invalid!.message).toContain('terrain');
  });

  it('flags a value that fails coercion (bad latLng)', () => {
    const findings = lintTemplateParams('map', { center: 'garbage' });
    expect(findings.some((f) => f.kind === 'invalid-input-value' && f.key === 'center')).toBe(true);
  });

  it('flags missing required inputs', () => {
    const findings = lintTemplateParams('twoColumn', {});
    const missing = findings
      .filter((f) => f.kind === 'missing-input')
      .map((f) => f.key)
      .sort();
    expect(missing).toEqual(['left', 'right']);
  });

  it('does not flag a required input that is present', () => {
    const findings = lintTemplateParams('map', { center: '1,2' });
    expect(findings.filter((f) => f.kind === 'missing-input')).toEqual([]);
  });

  it('accepts a valid enum value', () => {
    const findings = lintTemplateParams('map', { center: '1,2', mapStyle: 'satellite' });
    expect(findings).toEqual([]);
  });
});

describe('descriptor registry shape', () => {
  it('base descriptors are declared with unique keys', () => {
    const keys = BASE_INPUT_DESCRIPTORS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no orphan descriptors — every keyed template exists in the registry', () => {
    for (const template of Object.keys(TEMPLATE_INPUT_DESCRIPTORS)) {
      expect(templateRegistry, `orphan descriptor for "${template}"`).toHaveProperty(template);
    }
  });

  it('every template descriptor has unique keys and a description', () => {
    for (const [template, descriptors] of Object.entries(TEMPLATE_INPUT_DESCRIPTORS)) {
      const keys = descriptors.map((d) => d.key);
      expect(new Set(keys).size, `duplicate key in ${template}`).toBe(keys.length);
      for (const d of descriptors) {
        expect(d.description.length, `empty description for ${template}.${d.key}`).toBeGreaterThan(
          0,
        );
        // values / valueHint are mutually exclusive.
        expect(
          !(d.values && d.valueHint),
          `${template}.${d.key} has both values and valueHint`,
        ).toBe(true);
      }
    }
  });
});
