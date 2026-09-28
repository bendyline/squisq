import { describe, expect, it } from 'vitest';
import { defsIdFor } from '../utils/defsId';

describe('defsIdFor', () => {
  it('keeps plain ids readable and strips React id colons', () => {
    expect(defsIdFor(':r1:', 'edge-a-b')).toBe('dr1_-edge-a-b');
    expect(defsIdFor(':r1:', 'edge-a-b')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('sanitises spaces and punctuation so url(#…) references resolve', () => {
    const id = defsIdFor(':r2:', 'edge-nobles->parliament:a third of seats');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id).not.toContain(' ');
  });

  it('keeps ids distinct when only stripped characters differ', () => {
    expect(defsIdFor(':r3:', 'a b')).not.toBe(defsIdFor(':r3:', 'a-b'));
    expect(defsIdFor(':r3:', 'a b')).not.toBe(defsIdFor(':r3:', 'a>b'));
  });
});
