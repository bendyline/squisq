import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_AUTHORING_METADATA,
  TEMPLATE_METADATA,
  templateRegistry,
} from '../doc/templates/index.js';

describe('TEMPLATE_AUTHORING_METADATA', () => {
  it('stays exactly 1:1 with the built-in registry and catalog', () => {
    const expected = Object.keys(templateRegistry).sort();
    expect(Object.keys(TEMPLATE_AUTHORING_METADATA).sort()).toEqual(expected);
    expect(Object.keys(TEMPLATE_METADATA).sort()).toEqual(expected);
  });

  it('declares content as the sole loss-averse complete-body default', () => {
    const safe = Object.entries(TEMPLATE_AUTHORING_METADATA)
      .filter(([, metadata]) => metadata.safeForContentFirst)
      .map(([id]) => id);
    expect(safe).toEqual(['content']);
    expect(TEMPLATE_AUTHORING_METADATA.content.bodyPolicy).toBe('complete');
  });
});
