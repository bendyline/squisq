import { describe, it, expect } from 'vitest';
import { templateRegistry, TEMPLATE_METADATA } from '../doc/templates/index';

describe('TEMPLATE_METADATA', () => {
  it('stays exactly 1:1 with templateRegistry (same ids)', () => {
    const registryIds = Object.keys(templateRegistry).sort();
    const metadataIds = Object.keys(TEMPLATE_METADATA).sort();
    // If this fails, a template was added to the registry without metadata
    // (or vice versa). Add the missing entry — the editor's TemplatePicker
    // renders its gallery from TEMPLATE_METADATA, so a registry-only template
    // would never appear in the picker.
    expect(metadataIds).toEqual(registryIds);
  });

  it('every entry has a non-empty label and description', () => {
    for (const [id, meta] of Object.entries(TEMPLATE_METADATA)) {
      expect(meta.label, `label for "${id}"`).toBeTruthy();
      expect(meta.description, `description for "${id}"`).toBeTruthy();
    }
  });
});
