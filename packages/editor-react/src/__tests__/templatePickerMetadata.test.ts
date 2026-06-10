import { describe, it, expect } from 'vitest';
import { TEMPLATE_METADATA } from '@bendyline/squisq/doc';
import { TEMPLATE_ENTRIES } from '../TemplatePicker';

/**
 * The TemplatePicker gallery must stay 1:1 with core's TEMPLATE_METADATA so a
 * template added to the core registry can never silently fail to appear in the
 * editor. Core owns the canonical id list + labels + descriptions; the picker
 * adds only the per-id preview icon.
 */
describe('TemplatePicker ↔ core TEMPLATE_METADATA', () => {
  it('lists the same ids in the same order as TEMPLATE_METADATA', () => {
    const pickerNames = TEMPLATE_ENTRIES.map((e) => e.name);
    const metadataNames = Object.keys(TEMPLATE_METADATA);
    expect(pickerNames).toEqual(metadataNames);
  });

  it('uses the canonical label and description for every entry', () => {
    for (const entry of TEMPLATE_ENTRIES) {
      const meta = TEMPLATE_METADATA[entry.name];
      expect(meta, `missing core metadata for picker entry "${entry.name}"`).toBeTruthy();
      expect(entry.label, `label drift for "${entry.name}"`).toBe(meta.label);
      expect(entry.description, `description drift for "${entry.name}"`).toBe(meta.description);
    }
  });

  it('provides a preview icon for every entry', () => {
    for (const entry of TEMPLATE_ENTRIES) {
      expect(entry.icon, `missing icon for "${entry.name}"`).toBeTruthy();
    }
  });
});
