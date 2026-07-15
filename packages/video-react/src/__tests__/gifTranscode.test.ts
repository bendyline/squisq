import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffmpegState = vi.hoisted(() => ({
  exitCode: 0,
  loadConfig: undefined as unknown,
  writes: [] as Array<[string, Uint8Array]>,
  execArgs: [] as string[],
  readPath: '',
  execPromise: null as Promise<number> | null,
  terminate: vi.fn(),
}));

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    async load(config?: unknown): Promise<boolean> {
      ffmpegState.loadConfig = config;
      return true;
    }
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      ffmpegState.writes.push([path, data]);
    }
    async exec(args: string[]): Promise<number> {
      ffmpegState.execArgs = args;
      return ffmpegState.execPromise ?? ffmpegState.exitCode;
    }
    async readFile(path: string): Promise<Uint8Array> {
      ffmpegState.readPath = path;
      return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    }
    terminate(): void {
      ffmpegState.terminate();
    }
  },
}));

import { buildGifFfmpegArgs, transcodeMp4ToGifWithFfmpegWasm } from '../gifTranscode.js';

describe('GIF ffmpeg.wasm transcode', () => {
  /** Self-hosted core assets are mandatory — see the CDN regression test below. */
  const CORE = { coreURL: '/vendor/core.js', wasmURL: '/vendor/core.wasm' };

  beforeEach(() => {
    ffmpegState.exitCode = 0;
    ffmpegState.loadConfig = undefined;
    ffmpegState.writes = [];
    ffmpegState.execArgs = [];
    ffmpegState.readPath = '';
    ffmpegState.execPromise = null;
    ffmpegState.terminate.mockClear();
  });

  it('builds a looping palette-based GIF command from the shared argument builder', () => {
    const args = buildGifFfmpegArgs({ width: 960, height: 540, loop: 0 });
    expect(args.slice(0, 3)).toEqual(['-y', '-i', 'video.mp4']);
    expect(args).toContain('-filter_complex');
    expect(args.join(' ')).toContain('palettegen=stats_mode=diff');
    expect(args.join(' ')).toContain('paletteuse=dither=sierra2_4a:diff_mode=rectangle');
    expect(args.slice(-3)).toEqual(['-loop', '0', 'out.gif']);
  });

  it('writes the MP4 intermediate, reads GIF89a bytes, and threads runtime URLs', async () => {
    const input = new Uint8Array([1, 2, 3]);
    const output = await transcodeMp4ToGifWithFfmpegWasm(
      input,
      { width: 960, height: 540 },
      {
        coreURL: '/vendor/core.js',
        wasmURL: '/vendor/core.wasm',
        classWorkerURL: '/vendor/class-worker.js',
      },
    );

    expect(ffmpegState.loadConfig).toEqual({
      coreURL: '/vendor/core.js',
      wasmURL: '/vendor/core.wasm',
      classWorkerURL: '/vendor/class-worker.js',
    });
    expect(ffmpegState.writes).toEqual([['video.mp4', input]]);
    expect(ffmpegState.execArgs.at(-1)).toBe('out.gif');
    expect(ffmpegState.readPath).toBe('out.gif');
    expect(new TextDecoder().decode(output)).toBe('GIF89a');
    expect(ffmpegState.terminate).toHaveBeenCalledOnce();
  });

  it('reports ffmpeg failures and still terminates the runtime', async () => {
    ffmpegState.exitCode = 7;
    await expect(
      transcodeMp4ToGifWithFfmpegWasm(new Uint8Array([1]), { width: 960, height: 540 }, CORE),
    ).rejects.toThrow('GIF transcode failed with exit code 7');
    expect(ffmpegState.terminate).toHaveBeenCalledOnce();
  });

  it('rejects an empty MP4 before allocating the runtime', async () => {
    await expect(
      transcodeMp4ToGifWithFfmpegWasm(new Uint8Array(), { width: 960, height: 540 }, CORE),
    ).rejects.toThrow('empty MP4');
    expect(ffmpegState.terminate).not.toHaveBeenCalled();
  });

  /**
   * Regression: omitting `loadConfig` made `ffmpeg.load()` fall back to
   * @ffmpeg/ffmpeg's built-in `https://unpkg.com/@ffmpeg/core@…` URL, silently
   * fetching remote code mid-export.
   */
  it('refuses an unconfigured core rather than fetching the unpkg CDN', async () => {
    await expect(
      transcodeMp4ToGifWithFfmpegWasm(new Uint8Array([1]), { width: 960, height: 540 }),
    ).rejects.toThrow(/needs an ffmpeg\.wasm core URL/);
    // Failed before constructing the runtime at all.
    expect(ffmpegState.terminate).not.toHaveBeenCalled();
    expect(ffmpegState.loadConfig).toBeUndefined();
  });

  it('terminates an in-progress palette transcode when aborted', async () => {
    let finishExec!: (exitCode: number) => void;
    ffmpegState.execPromise = new Promise<number>((resolve) => {
      finishExec = resolve;
    });
    const controller = new AbortController();
    const pending = transcodeMp4ToGifWithFfmpegWasm(
      new Uint8Array([1]),
      { width: 960, height: 540 },
      CORE,
      controller.signal,
    );

    await vi.waitFor(() => expect(ffmpegState.execArgs).not.toEqual([]));
    controller.abort();
    expect(ffmpegState.terminate).toHaveBeenCalledOnce();
    finishExec(0);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(ffmpegState.terminate).toHaveBeenCalledOnce();
  });
});
