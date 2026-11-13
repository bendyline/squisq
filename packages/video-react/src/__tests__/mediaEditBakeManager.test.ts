import { describe, expect, it, vi } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { mediaBakeKey, mediaClipRenderKey } from '@bendyline/squisq/mediaEdit';
import type { Doc, MediaClip, MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { createMediaEditRenderManager } from '../mediaEdit/mediaEditRenderManager.js';
import type { MediaEditRenderer } from '../mediaEdit/mediaEditRenderer.js';

const TAKE = 'audio/take.webm';

function memoryProvider(initial: Record<string, Uint8Array> = {}) {
  const files = new Map<string, { data: Uint8Array; mimeType: string }>();
  for (const [name, data] of Object.entries(initial)) files.set(name, { data, mimeType: 'x/y' });
  const provider: MediaProvider = {
    resolveUrl: async (path) => `mem:${path}`,
    listMedia: async (): Promise<MediaEntry[]> =>
      [...files].map(([name, f]) => ({ name, mimeType: f.mimeType, size: f.data.byteLength })),
    addMedia: vi.fn(async (name, data, mimeType) => {
      const bytes =
        data instanceof Uint8Array
          ? data
          : new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
      files.set(name, { data: bytes, mimeType });
      return name;
    }),
    removeMedia: vi.fn(async (path) => {
      files.delete(path);
    }),
    dispose: () => {},
  };
  const fetchImpl = (async (url: string) => {
    const file = files.get(String(url).replace(/^mem:/, ''));
    if (!file) return { ok: false, status: 404 } as Response;
    return {
      ok: true,
      status: 200,
      text: async () => new TextDecoder().decode(file.data),
      blob: async () => new Blob([file.data.slice()]),
    } as Response;
  }) as typeof fetch;
  return { provider, files, fetchImpl };
}

function fakeRenderer(options: { bake?: 'ok' | 'fail'; render?: 'ok' | 'fail' } = {}) {
  const render = vi.fn(async () => {
    if (options.render === 'fail') throw new Error('decode failed');
    return {
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
      mimeType: 'audio/webm' as const,
      extension: 'webm' as const,
      analysis: { integratedLufs: -30, loudnessGainDb: 14, breaths: [] },
      ignoredOps: [],
      sourceDuration: 12.5,
      engine: 'squisq-media-edit/1',
    };
  });
  const bake = vi.fn(
    async (
      _request: Record<string, unknown>,
      jobOptions?: { onProgress?: (f: number) => void },
    ) => {
      jobOptions?.onProgress?.(0.5);
      if (options.bake === 'fail') throw new Error('cannot encode');
      jobOptions?.onProgress?.(1);
      return {
        bytes: new Uint8Array([9, 9, 9, 9, 9, 9]).buffer,
        mimeType: 'audio/mp4',
        extension: 'm4a' as const,
        durationSec: 7,
        engine: 'squisq-media-bake/1',
      };
    },
  );
  const renderer = { render, bake, dispose: vi.fn() } as unknown as MediaEditRenderer;
  return { renderer, render, bake };
}

function docWith(params: string): Doc {
  return markdownToDoc(
    parseMarkdown(`{[audio src=${TAKE} anchor=document ${params}]}\n\n# One\n\nBody.\n`),
  );
}
const clipOf = (doc: Doc): MediaClip => doc.documentMedia![0];

function setup(
  files: Record<string, Uint8Array> = { [TAKE]: new Uint8Array(100) },
  rendererOptions?: Parameters<typeof fakeRenderer>[0],
) {
  const memory = memoryProvider(files);
  const fake = fakeRenderer(rendererOptions);
  const manager = createMediaEditRenderManager({
    mediaProvider: memory.provider,
    renderer: fake.renderer,
    fetch: memory.fetchImpl,
    now: () => new Date('2026-11-12T00:00:00Z'),
  });
  return { manager, ...memory, ...fake };
}

describe('media-edit render manager — baked clips', () => {
  it('bakes a clip on request, writes file + manifest, and reuses it', async () => {
    const { manager, files, bake } = setup();
    const clip = clipOf(docWith('clipStart=1 cuts="2-3 6-8" gain=-3 fadeOut=0.5'));
    const key = mediaBakeKey(clip);
    expect(manager.bakedMedia(clip)).toBeUndefined();

    const progress: number[] = [];
    const path = await manager.bake(clip, { onProgress: (f) => progress.push(f) });
    expect(path).toBe(`.mediaEdits/take.${key}.baked.m4a`);
    expect(bake).toHaveBeenCalledTimes(1);
    const request = bake.mock.calls[0][0];
    expect(request).toMatchObject({
      kind: 'audio',
      clipStart: 1,
      cuts: [
        { start: 2, end: 3 },
        { start: 6, end: 8 },
      ],
      gain: -3,
      fadeOut: 0.5,
    });
    // No signal chain in the recipe: the source's own sound is baked.
    expect(request).not.toHaveProperty('audio');
    expect(progress).toEqual([0.5, 1]);

    const manifest = JSON.parse(
      new TextDecoder().decode(files.get(`.mediaEdits/take.${key}.baked.json`)!.data),
    );
    expect(manifest).toMatchObject({
      src: TAKE,
      key,
      file: path,
      mimeType: 'audio/mp4',
      sourceSize: 100,
      duration: 7,
      createdAt: '2026-11-12T00:00:00.000Z',
    });
    expect(manifest.spec).toContain('cuts=2-3 6-8');

    expect(manager.bakedMedia(clip)).toBe(path);
    expect(await manager.bake(clip)).toBe(path);
    expect(bake).toHaveBeenCalledTimes(1);
  });

  it('never bakes on its own: sync and whenReady leave baking to the caller', async () => {
    const { manager, bake, files } = setup();
    const doc = docWith('cuts=2-3');
    await manager.whenReady(doc);
    expect(bake).not.toHaveBeenCalled();
    expect([...files.keys()]).toEqual([TAKE]);
  });

  it('renders the processed audio first and bakes from it', async () => {
    const { manager, render, bake, files } = setup();
    const clip = clipOf(docWith('fx="loudness:-16" cuts=2-3'));
    const renderKey = mediaClipRenderKey(clip)!;
    const progress: number[] = [];
    const path = await manager.bake(clip, { onProgress: (f) => progress.push(f) });
    expect(render).toHaveBeenCalledTimes(1);
    expect(files.has(`.mediaEdits/take.${renderKey}.webm`)).toBe(true);
    // The baked sound is the render (4 bytes here), not the 100-byte source.
    const request = bake.mock.calls[0][0] as { source: Blob; audio: Blob };
    expect(request.source.size).toBe(100);
    expect(request.audio.size).toBe(4);
    expect(path).toBe(`.mediaEdits/take.${mediaBakeKey(clip)}.baked.m4a`);
    // The wait for the render takes the first part of the bar; the bake the rest.
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((f, i) => i === 0 || f >= progress[i - 1])).toBe(true);
    expect(progress.some((f) => f > 0.6 && f < 1)).toBe(true);
  });

  it('reports a failed render or a failed bake to the caller', async () => {
    const failedRender = setup(undefined, { render: 'fail' });
    await expect(
      failedRender.manager.bake(clipOf(docWith('fx="loudness:-16" cuts=2-3'))),
    ).rejects.toThrow('Audio cleanup failed: decode failed');
    expect(failedRender.bake).not.toHaveBeenCalled();

    const failedBake = setup(undefined, { bake: 'fail' });
    const clip = clipOf(docWith('cuts=2-3'));
    await expect(failedBake.manager.bake(clip)).rejects.toThrow('cannot encode');
    expect(failedBake.manager.bakedMedia(clip)).toBeUndefined();
    // A later request tries again rather than replaying the failure.
    await expect(failedBake.manager.bake(clip)).rejects.toThrow('cannot encode');
    expect(failedBake.bake).toHaveBeenCalledTimes(2);
  });

  it('shares one job between two requests for the same clip', async () => {
    const { manager, bake } = setup();
    const clip = clipOf(docWith('cuts=2-3'));
    const [a, b] = await Promise.all([manager.bake(clip), manager.bake(clip)]);
    expect(a).toBe(b);
    expect(bake).toHaveBeenCalledTimes(1);
  });

  it('rejects at once when already cancelled', async () => {
    const { manager, bake } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      manager.bake(clipOf(docWith('cuts=2-3')), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(bake).not.toHaveBeenCalled();
  });

  it('replaces the baked copy when the recipe changes', async () => {
    const { manager, files } = setup();
    const before = docWith('cuts=2-3');
    manager.sync(before);
    const first = await manager.bake(clipOf(before));

    const after = docWith('cuts="2-3 6-8"');
    manager.sync(after);
    expect(manager.bakedMedia(clipOf(after))).toBeUndefined();
    const second = await manager.bake(clipOf(after));
    expect(second).not.toBe(first);
    const baked = [...files.keys()].filter((name) => name.includes('.baked.'));
    expect(baked.sort()).toEqual([second, second.replace(/\.m4a$/, '.json')].sort());
  });

  it('re-bakes when the source file was replaced', async () => {
    const { manager, bake, files, provider } = setup();
    const clip = clipOf(docWith('cuts=2-3'));
    const path = await manager.bake(clip);
    // A new take under the same name, then a fresh manager (a reopened document).
    await provider.addMedia(TAKE, new Uint8Array(250), 'audio/webm');
    const reopened = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer: fakeRenderer().renderer,
      fetch: (async (url: string) => {
        const file = files.get(String(url).replace(/^mem:/, ''));
        return file
          ? ({
              ok: true,
              status: 200,
              text: async () => new TextDecoder().decode(file.data),
              blob: async () => new Blob([file.data.slice()]),
            } as Response)
          : ({ ok: false, status: 404 } as Response);
      }) as typeof fetch,
    });
    await reopened.whenReady(docWith('cuts=2-3'));
    expect(reopened.bakedMedia(clip)).toBeUndefined();
    expect(await reopened.bake(clip)).toBe(path);
    expect(bake).toHaveBeenCalledTimes(1);
  });

  it('garbage-collects baked copies no current recipe asks for, at once', async () => {
    const { manager, files } = setup();
    const edited = docWith('cuts=2-3');
    manager.sync(edited);
    const path = await manager.bake(clipOf(edited));

    // Still asked for: collecting leaves it.
    expect(await manager.collectGarbage(edited)).toEqual([]);
    expect(files.has(path)).toBe(true);

    // The cuts are removed from the document: the copy goes with them.
    const plain = docWith('');
    manager.sync(plain);
    await manager.whenReady(plain);
    const removed = await manager.collectGarbage(plain);
    expect(removed.sort()).toEqual([path, path.replace(/\.m4a$/, '.json')].sort());
    expect(manager.bakedMedia(clipOf(edited))).toBeUndefined();
  });
});
