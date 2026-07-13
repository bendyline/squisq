import { describe, expect, it } from 'vitest';
import { resolvePersistedTransformStyleId } from '../transformStyleId';

describe('resolvePersistedTransformStyleId', () => {
  it('accepts canonical ids and canonicalizes the legacy wire value', () => {
    expect(resolvePersistedTransformStyleId('data-driven')).toBe('data-driven');
    expect(resolvePersistedTransformStyleId('dataDriven')).toBe('data-driven');
  });

  it('does not turn an unknown id into the default transform', () => {
    expect(resolvePersistedTransformStyleId('not-a-style')).toBeNull();
  });
});
