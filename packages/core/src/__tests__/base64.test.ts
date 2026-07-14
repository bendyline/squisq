import { describe, expect, it } from 'vitest';
import { base64ToBytes, base64ToUtf8, bytesToBase64 } from '../base64';

describe('runtime-neutral base64 helpers', () => {
  it('round-trips arbitrary bytes without atob, btoa, or Buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('decodes UTF-8 legacy frontmatter payloads', () => {
    const text = 'Squisq — こんにちは';
    expect(base64ToUtf8(bytesToBase64(new TextEncoder().encode(text)))).toBe(text);
  });

  it('rejects malformed base64', () => {
    expect(() => base64ToBytes('not-base64!')).toThrow('Invalid base64');
  });
});
