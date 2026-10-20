// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { expect, it, vi } from 'vitest';
import type { Rnnoise } from '@shiguredo/rnnoise-wasm';
import { rnnoiseWasmPlugin } from '../packages/site/build/rnnoiseWasmPlugin';

it.each(['/', '/nested/', './'])(
  'loads the extracted RNNoise WASM on demand with base %s',
  async (base) => {
    const outDir = await mkdtemp(join(tmpdir(), 'squisq-rnnoise-'));
    try {
      await build({
        configFile: false,
        logLevel: 'silent',
        base,
        plugins: [rnnoiseWasmPlugin()],
        build: {
          outDir,
          emptyOutDir: false,
          minify: true,
          lib: {
            entry: resolve('node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js'),
            formats: ['es'],
            fileName: () => 'rnnoise.mjs',
          },
        },
      });
      const wasmFile = (await readdir(outDir)).find((file) => file.endsWith('.wasm'));
      expect(wasmFile).toBeDefined();
      const wasm = await readFile(join(outDir, wasmFile!));
      expect(WebAssembly.validate(wasm)).toBe(true);
      const entry = join(outDir, 'rnnoise.mjs');
      expect((await readFile(entry)).byteLength).toBeLessThan(100_000);

      // Execute the built upstream runtime with its browser environment and a
      // local fetch stand-in. This checks the rewrite against the real pinned
      // dependency, including the emitted URL and actual WASM initialization.
      vi.stubGlobal('window', {});
      const fetchAsset = vi.fn(async (url: string) => {
        expect(url).toBe(
          base === './' ? pathToFileURL(join(outDir, wasmFile!)).href : `${base}${wasmFile}`,
        );
        return new Response(new Uint8Array(wasm), {
          headers: { 'Content-Type': 'application/wasm' },
        });
      });
      vi.stubGlobal('fetch', fetchAsset);
      const runtime = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as {
        Rnnoise: typeof Rnnoise;
      };
      expect(fetchAsset).not.toHaveBeenCalled();
      // A failed asset request rejects cleanly before Emscripten starts, and
      // a later attempt can recover instead of retaining a rejected promise.
      const monitor = vi.spyOn(globalThis, 'setInterval');
      fetchAsset.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
      await expect(runtime.Rnnoise.load()).rejects.toThrow('RNNoise WASM load failed: 503');
      expect(monitor).not.toHaveBeenCalled();
      const denoiser = await runtime.Rnnoise.load();
      expect(fetchAsset).toHaveBeenCalledTimes(2);
      expect(denoiser.frameSize).toBe(480);
      const state = denoiser.createDenoiseState();
      try {
        const frame = new Float32Array(denoiser.frameSize);
        expect(Number.isFinite(state.processFrame(frame))).toBe(true);
        expect(frame.every(Number.isFinite)).toBe(true);
      } finally {
        state.destroy();
      }
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      await rm(outDir, { recursive: true, force: true });
    }
  },
);
