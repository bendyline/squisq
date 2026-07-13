// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { framesToMp4Wasm } from '../wasmEncoder.js';

describe('framesToMp4Wasm runtime contract', () => {
  it('fails clearly in Node instead of entering ffmpeg.wasm browser internals', async () => {
    await expect(framesToMp4Wasm([new Uint8Array([1])], null)).rejects.toThrow(
      'framesToMp4Wasm is browser-only',
    );
  });
});
