import { describe, expect, it, vi } from 'vitest';

import { resolveUpngEncoder } from '../pdf/upng';

describe('resolveUpngEncoder', () => {
  it('unwraps the CommonJS default exposed by native Node ESM', () => {
    const encode = vi.fn(() => new ArrayBuffer(1));

    expect(resolveUpngEncoder({ default: { encode } })?.encode).toBe(encode);
  });
});
