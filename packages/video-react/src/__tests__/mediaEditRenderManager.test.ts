import { describe, expect, it, vi } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  MEDIA_RENDER_MANIFEST_VERSION,
  mediaRenderKeyFor,
  parseMediaFx,
  serializeMediaRenderManifest,
} from '@bendyline/squisq/mediaEdit';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { createMediaEditRenderManager } from '../mediaEdit/mediaEditRenderManager.js';
import type { MediaEditRenderer } from '../mediaEdit/mediaEditRenderer.js';

const TAKE = 'audio/take.webm';
const FX = 'denoise:0.8 loudness:-16';

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

function fakeRenderer(behavior: 'ok' | 'fail' = 'ok') {
  const render = vi.fn(async (_req: unknown, options?: { onProgress?: (f: number) => void }) => {
    options?.onProgress?.(0.5);
    if (behavior === 'fail') throw new Error('decode failed');
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
  const renderer: MediaEditRenderer = {
    render: render as unknown as MediaEditRenderer['render'],
    analyze: vi.fn(),
    preview: vi.fn(),
    dispose: vi.fn(),
  } as unknown as MediaEditRenderer;
  return { renderer, render };
}

function docWith(fx: string | null) {
  const annotation = fx
    ? `{[audio src=${TAKE} anchor=document fx="${fx}"]}`
    : `{[audio src=${TAKE} anchor=document]}`;
  return markdownToDoc(parseMarkdown(`${annotation}\n\n# One\n\nBody.\n`));
}

const key = mediaRenderKeyFor(TAKE, FX)!;
const clipOf = (doc: ReturnType<typeof docWith>) => doc.documentMedia![0];

describe('createMediaEditRenderManager', () => {
  it('renders a missing recipe, writes render + manifest, and serves it', async () => {
    const { provider, files, fetchImpl } = memoryProvider({ [TAKE]: new Uint8Array(100) });
    const { renderer, render } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
      now: () => new Date('2026-09-24T00:00:00Z'),
    });
    const doc = docWith(FX);
    expect(manager.processedAudio(clipOf(doc))).toBeUndefined();
    await manager.whenReady(doc);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toMatchObject({ fx: 'denoise:0.8 loudness:-16' });
    const renderPath = `.mediaEdits/take.${key}.webm`;
    expect(manager.processedAudio(clipOf(doc))).toBe(renderPath);
    expect(manager.status(clipOf(doc))).toEqual({ key, state: 'ready' });
    const manifest = JSON.parse(
      new TextDecoder().decode(files.get(`.mediaEdits/take.${key}.json`)!.data),
    );
    expect(manifest).toMatchObject({ src: TAKE, key, sourceSize: 100, file: renderPath });
  });

  it('reuses a current render without re-rendering', async () => {
    const manifest = serializeMediaRenderManifest({
      version: MEDIA_RENDER_MANIFEST_VERSION,
      src: TAKE,
      key,
      fx: FX,
      ignoredOps: [],
      file: `.mediaEdits/take.${key}.webm`,
      mimeType: 'audio/webm',
      sourceSize: 100,
      sourceDuration: 12.5,
      engine: 'squisq-media-edit/1',
      createdAt: '2026-09-20T00:00:00Z',
    });
    const { provider, fetchImpl } = memoryProvider({
      [TAKE]: new Uint8Array(100),
      [`.mediaEdits/take.${key}.webm`]: new Uint8Array(4),
      [`.mediaEdits/take.${key}.json`]: new TextEncoder().encode(manifest),
    });
    const { renderer, render } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
    });
    await manager.whenReady(docWith(FX));
    expect(render).not.toHaveBeenCalled();
    expect(manager.processedAudio(clipOf(docWith(FX)))).toBe(`.mediaEdits/take.${key}.webm`);
  });

  it('replaces a render whose source changed size', async () => {
    const manifest = serializeMediaRenderManifest({
      version: MEDIA_RENDER_MANIFEST_VERSION,
      src: TAKE,
      key,
      fx: FX,
      ignoredOps: [],
      file: `.mediaEdits/take.${key}.webm`,
      mimeType: 'audio/webm',
      sourceSize: 50,
      sourceDuration: 12.5,
      engine: 'squisq-media-edit/1',
      createdAt: '2026-09-20T00:00:00Z',
    });
    const { provider, fetchImpl } = memoryProvider({
      [TAKE]: new Uint8Array(100),
      [`.mediaEdits/take.${key}.webm`]: new Uint8Array(4),
      [`.mediaEdits/take.${key}.json`]: new TextEncoder().encode(manifest),
    });
    const { renderer, render } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
    });
    const doc = docWith(FX);
    manager.sync(doc);
    await vi.waitFor(() => expect(manager.processedAudio(clipOf(doc))).toBeUndefined());
    await manager.whenReady(doc);
    expect(render).toHaveBeenCalledTimes(1);
    expect(manager.processedAudio(clipOf(doc))).toBe(`.mediaEdits/take.${key}.webm`);
  });

  it('reports failures, settles whenReady, and retries on request', async () => {
    const { provider, fetchImpl } = memoryProvider({ [TAKE]: new Uint8Array(100) });
    const failing = fakeRenderer('fail');
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer: failing.renderer,
      fetch: fetchImpl,
    });
    const doc = docWith(FX);
    await manager.whenReady(doc);
    expect(manager.status(clipOf(doc))).toMatchObject({ state: 'failed', error: 'decode failed' });
    expect(manager.processedAudio(clipOf(doc))).toBeUndefined();
    // A failed recipe is not retried by sync alone…
    manager.sync(doc);
    await manager.whenReady(doc);
    expect(failing.render).toHaveBeenCalledTimes(1);
    // …only by an explicit retry.
    manager.retry(clipOf(doc));
    await manager.whenReady(doc);
    expect(failing.render).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers as work progresses', async () => {
    const { provider, fetchImpl } = memoryProvider({ [TAKE]: new Uint8Array(100) });
    const { renderer } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
    });
    const seen: string[] = [];
    const doc = docWith(FX);
    manager.subscribe(() => {
      const s = manager.status(clipOf(doc));
      if (s) seen.push(`${s.state}${s.progress != null ? `:${s.progress}` : ''}`);
    });
    await manager.whenReady(doc);
    expect(seen).toContain('rendering:0.5');
    expect(seen[seen.length - 1]).toBe('ready');
  });

  it('collects unreferenced renders older than the GC age', async () => {
    const oldKey = mediaRenderKeyFor(TAKE, 'loudness:-20')!;
    const oldManifest = serializeMediaRenderManifest({
      version: MEDIA_RENDER_MANIFEST_VERSION,
      src: TAKE,
      key: oldKey,
      fx: 'loudness:-20',
      ignoredOps: [],
      file: `.mediaEdits/take.${oldKey}.webm`,
      mimeType: 'audio/webm',
      sourceSize: 100,
      sourceDuration: 12.5,
      engine: 'squisq-media-edit/1',
      createdAt: '2026-08-01T00:00:00Z',
    });
    const { provider, files, fetchImpl } = memoryProvider({
      [TAKE]: new Uint8Array(100),
      [`.mediaEdits/take.${oldKey}.webm`]: new Uint8Array(4),
      [`.mediaEdits/take.${oldKey}.json`]: new TextEncoder().encode(oldManifest),
    });
    const { renderer } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
    });
    const doc = docWith(FX);
    await manager.whenReady(doc);
    const removed = await manager.collectGarbage(doc, new Date('2026-09-24T00:00:00Z'));
    expect(removed.sort()).toEqual(
      [`.mediaEdits/take.${oldKey}.webm`, `.mediaEdits/take.${oldKey}.json`].sort(),
    );
    expect(files.has(`.mediaEdits/take.${key}.webm`)).toBe(true);
    expect(files.has(`.mediaEdits/take.${oldKey}.webm`)).toBe(false);
  });

  it('never collects renders of sources the document does not use', async () => {
    const otherKey = mediaRenderKeyFor('audio/other.webm', 'loudness:-20')!;
    const otherManifest = serializeMediaRenderManifest({
      version: MEDIA_RENDER_MANIFEST_VERSION,
      src: 'audio/other.webm',
      key: otherKey,
      fx: 'loudness:-20',
      ignoredOps: [],
      file: `.mediaEdits/other.${otherKey}.webm`,
      mimeType: 'audio/webm',
      sourceSize: 100,
      sourceDuration: 3,
      engine: 'squisq-media-edit/1',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const { provider, files, fetchImpl } = memoryProvider({
      [TAKE]: new Uint8Array(100),
      [`.mediaEdits/other.${otherKey}.webm`]: new Uint8Array(4),
      [`.mediaEdits/other.${otherKey}.json`]: new TextEncoder().encode(otherManifest),
    });
    const { renderer } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
    });
    const doc = docWith(null);
    expect(await manager.collectGarbage(doc, new Date('2026-09-24T00:00:00Z'))).toEqual([]);
    expect(files.has(`.mediaEdits/other.${otherKey}.webm`)).toBe(true);
  });

  it('renders extra clips an editor supplies, and keeps them across whenReady', async () => {
    const { provider, fetchImpl } = memoryProvider({ [TAKE]: new Uint8Array(100) });
    const { renderer, render } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
    });
    const doc = docWith(null);
    const embedded = {
      id: 'embedded:b:0',
      src: TAKE,
      kind: 'audio' as const,
      startAt: 0,
      anchor: 'block' as const,
      edits: { fx: parseMediaFx(FX)! },
    };
    manager.sync(doc, [embedded]);
    await manager.whenReady(doc);
    expect(render).toHaveBeenCalledTimes(1);
    expect(manager.processedAudio(embedded)).toBe(`.mediaEdits/take.${key}.webm`);
  });

  it('does nothing for a document without recipes', async () => {
    const { provider, fetchImpl } = memoryProvider({ [TAKE]: new Uint8Array(100) });
    const { renderer, render } = fakeRenderer();
    const manager = createMediaEditRenderManager({
      mediaProvider: provider,
      renderer,
      fetch: fetchImpl,
    });
    const doc = docWith(null);
    await manager.whenReady(doc);
    expect(render).not.toHaveBeenCalled();
    expect(manager.status(clipOf(doc))).toBeNull();
  });
});
