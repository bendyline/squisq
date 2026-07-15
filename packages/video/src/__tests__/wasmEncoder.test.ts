import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffmpegState = vi.hoisted(() => ({
  exitCode: 0,
  terminate: vi.fn(),
  loadConfig: undefined as unknown,
}));

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    on(): void {}
    async load(config?: unknown): Promise<boolean> {
      ffmpegState.loadConfig = config;
      return true;
    }
    async writeFile(): Promise<void> {}
    async exec(): Promise<number> {
      return ffmpegState.exitCode;
    }
    async readFile(): Promise<Uint8Array> {
      return new Uint8Array([1]);
    }
    async deleteFile(): Promise<void> {}
    terminate(): void {
      ffmpegState.terminate();
    }
  },
}));

vi.mock('@ffmpeg/util', () => ({ fetchFile: vi.fn() }));

import { framesToMp4Wasm } from '../wasmEncoder.js';

describe('framesToMp4Wasm failures', () => {
  beforeEach(() => {
    ffmpegState.exitCode = 0;
    ffmpegState.terminate.mockClear();
    ffmpegState.loadConfig = undefined;
  });

  /** Self-hosted core assets are now mandatory — see the CDN regression below. */
  const CORE = { coreURL: '/vendor/core.js', wasmURL: '/vendor/core.wasm' };

  it('throws on a nonzero ffmpeg exit and still terminates the runtime', async () => {
    ffmpegState.exitCode = 9;

    await expect(
      framesToMp4Wasm([new Uint8Array([1])], null, { ffmpegWasm: CORE }),
    ).rejects.toThrow('ffmpeg.wasm failed with exit code 9');
    expect(ffmpegState.terminate).toHaveBeenCalledOnce();
  });

  /**
   * Regression: with no `ffmpegWasm`, `ffmpeg.load(undefined)` inherited
   * @ffmpeg/ffmpeg's built-in unpkg CORE_URL and fetched remote code.
   */
  it('refuses to load an unconfigured core rather than fetching the unpkg CDN', async () => {
    await expect(framesToMp4Wasm([new Uint8Array([1])], null)).rejects.toThrow(
      /needs an ffmpeg\.wasm core URL/,
    );
  });

  it('fails before allocating a runtime when the core is unconfigured', async () => {
    await expect(framesToMp4Wasm([new Uint8Array([1])], null)).rejects.toThrow();
    // Nothing was constructed, so nothing needed tearing down.
    expect(ffmpegState.terminate).not.toHaveBeenCalled();
    expect(ffmpegState.loadConfig).toBeUndefined();
  });

  it('threads self-hosted ffmpeg asset URLs into the runtime', async () => {
    await framesToMp4Wasm([new Uint8Array([1])], null, {
      ffmpegWasm: {
        coreURL: '/vendor/core.js',
        wasmURL: '/vendor/core.wasm',
      },
    });

    expect(ffmpegState.loadConfig).toEqual({
      coreURL: '/vendor/core.js',
      wasmURL: '/vendor/core.wasm',
    });
  });
});
