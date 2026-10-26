// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInThisContext } from 'node:vm';
import { build } from 'vite';
import { expect, it, vi } from 'vitest';
import type { Rnnoise } from '@shiguredo/rnnoise-wasm';
import { rnnoiseWasmPlugin } from '../packages/video-react/src/vite/rnnoiseWasmPlugin';

/** Where an IIFE worker build "runs" in the test: no `document`, only `self.location`. */
const WORKER_URL = 'https://squisq.test/assets/mediaEdit.worker.js';
const IIFE_NAME = 'SquisqRnnoiseProbe';

it.each([
  ['es', '/'],
  ['es', '/nested/'],
  ['es', './'],
  // Vite's default worker format: no `import.meta`, so the URL must not use it.
  ['iife', '/'],
  ['iife', '/nested/'],
  ['iife', './'],
] as const)(
  'loads the extracted RNNoise WASM on demand (%s output, base %s)',
  async (format, base) => {
    // Exercise the tilde in Windows runner short paths (RUNNER~1) on every OS.
    const outDir = await mkdtemp(join(tmpdir(), 'squisq-rnnoise-~'));
    const fileName = format === 'es' ? 'rnnoise.mjs' : 'rnnoise.js';
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
            formats: [format],
            name: IIFE_NAME,
            fileName: () => fileName,
          },
        },
      });
      const wasmFile = (await readdir(outDir)).find((file) => file.endsWith('.wasm'));
      expect(wasmFile).toBeDefined();
      const wasm = await readFile(join(outDir, wasmFile!));
      expect(WebAssembly.validate(wasm)).toBe(true);
      const entry = join(outDir, fileName);
      const code = await readFile(entry, 'utf8');
      expect(code.length).toBeLessThan(100_000);
      if (format === 'iife') expect(code).not.toContain('import.meta');

      // Execute the built upstream runtime with its browser environment and a
      // local fetch stand-in. This checks the rewrite against the real pinned
      // dependency, including the emitted URL and actual WASM initialization.
      vi.stubGlobal('window', {});
      vi.stubGlobal('self', { location: { href: WORKER_URL } });
      const fetchAsset = vi.fn(async (url: string) => {
        if (base !== './') {
          // An absolute base names the file outright, in every output format.
          expect(url).toBe(`${base}${wasmFile}`);
        } else if (format === 'iife') {
          expect(url).toBe(new URL(wasmFile!, WORKER_URL).href);
        } else {
          // Node and the module runner can spell the same tilde as %7E or ~.
          // Compare the resolved file, keeping absolute deployment URLs exact.
          expect(fileURLToPath(url)).toBe(join(outDir, wasmFile!));
        }
        return new Response(new Uint8Array(wasm), {
          headers: { 'Content-Type': 'application/wasm' },
        });
      });
      vi.stubGlobal('fetch', fetchAsset);
      let runtime: { Rnnoise: typeof Rnnoise };
      if (format === 'es') {
        runtime = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as typeof runtime;
      } else {
        // Wrapped so the IIFE's top-level `var` stays local instead of leaking a global.
        runtime = runInThisContext(`(function () {\n${code}\nreturn ${IIFE_NAME};\n})()`, {
          filename: entry,
        }) as typeof runtime;
      }
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
