import { describe, it, expect } from 'vitest';
import { templateRegistry } from '../doc/templates/registry';
import { TEMPLATE_TOKEN_NAMES, isReservedAnnotationToken } from '../doc/templates/templateNames';

describe('TEMPLATE_TOKEN_NAMES', () => {
  it('stays 1:1 with the template registry (drift guard)', () => {
    // The reserved-token set is hard-coded in the dependency-free
    // `templateNames.ts` leaf so the markdown parser can import it without an
    // import cycle. This test keeps it honest against the real registry.
    expect([...TEMPLATE_TOKEN_NAMES].sort()).toEqual(Object.keys(templateRegistry).sort());
  });

  it('reserves canonical ids and legacy aliases, but not qualified icon tokens', () => {
    expect(isReservedAnnotationToken('list')).toBe(true);
    expect(isReservedAnnotationToken('map')).toBe(true);
    expect(isReservedAnnotationToken('titleBlock')).toBe(true); // alias → title
    expect(isReservedAnnotationToken('fa-solid:list')).toBe(false); // qualified icon
    expect(isReservedAnnotationToken('github')).toBe(false); // not a template
  });
});
