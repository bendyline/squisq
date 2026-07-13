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

  it('throws on a nonzero ffmpeg exit and still terminates the runtime', async () => {
    ffmpegState.exitCode = 9;

    await expect(framesToMp4Wasm([new Uint8Array([1])], null)).rejects.toThrow(
      'ffmpeg.wasm failed with exit code 9',
    );
    expect(ffmpegState.terminate).toHaveBeenCalledOnce();
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
