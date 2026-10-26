/**
 * Vite plugin that ships RNNoise's WASM as one file instead of twice in base64.
 *
 * The pinned `@shiguredo/rnnoise-wasm` embeds its 3.6 MB WASM as base64 in
 * JavaScript. A host bundling the media-edit engine gets that payload twice:
 * statically inside the worker, and again in the main-thread fallback's lazy
 * chunk. This plugin extracts it to an emitted `rnnoise.wasm` that both load
 * only when `Rnnoise.load()` runs, keeping the upstream runtime. Hosts add it
 * to `plugins` and to `worker.plugins`; dev servers keep the self-contained
 * module.
 *
 * The URL is written once the output format is known, by Vite's own rule: an
 * absolute `base` names the file outright, a relative one resolves it against
 * the running chunk. `import.meta.ROLLUP_FILE_URL` cannot be used: an IIFE
 * worker (Vite's default) has no `import.meta`, so Vite 8 writes `{}.url` and
 * the fetch throws.
 */

const MODULE_SUFFIX = '/@shiguredo/rnnoise-wasm/dist/rnnoise.js';
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const URL_PLACEHOLDER = '__SQUISQ_RNNOISE_WASM_URL__';
/** The running script's own URL, for output formats without `import.meta`. */
const SCRIPT_URL =
  "(typeof document === 'undefined' ? self.location.href : (document.currentScript && document.currentScript.src) || document.baseURI)";

/** The plugin-context methods this plugin calls (Rollup and Rolldown both provide them). */
interface RnnoisePluginContext {
  emitFile(file: { type: 'asset'; name: string; source: Uint8Array }): string;
  getFileName(referenceId: string): string;
  error(message: string): never;
}

/** A Vite plugin, declared structurally so this package needs no Vite dependency. */
export interface RnnoiseWasmPlugin {
  name: string;
  apply: 'build';
  enforce: 'pre';
  configResolved(config: { base: string }): void;
  transform(
    this: RnnoisePluginContext,
    code: string,
    id: string,
  ): { code: string; map: null } | null;
  renderChunk(
    this: RnnoisePluginContext,
    code: string,
    chunk: { fileName: string },
    options: { format: string },
  ): { code: string; map: null } | null;
}

export function rnnoiseWasmPlugin(): RnnoiseWasmPlugin {
  let base: string | undefined;
  let wasmReference: string | undefined;
  return {
    name: 'squisq-rnnoise-wasm-asset',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      base = config.base;
    },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith(MODULE_SUFFIX)) return null;

      // Match the embedded-byte factory, not upstream's minified identifiers.
      // Fail visibly on dependency changes rather than shipping a broken loader.
      const factory = /function (\w+)\(\) \{\s*return \w+\("([A-Za-z0-9+/=]{1000,})"\);\s*\}/.exec(
        code,
      );
      if (!factory) this.error('RNNoise embedded WASM factory changed; update the asset plugin.');
      const [, name, base64] = factory;
      const load = /static async load\(\) \{/g;
      if ([...code.matchAll(load)].length !== 1) {
        this.error('RNNoise load method changed; update the asset plugin.');
      }
      const bytes = Uint8Array.from(atob(base64!), (char) => char.charCodeAt(0));
      if (!WASM_MAGIC.every((byte, index) => bytes[index] === byte)) {
        this.error('RNNoise embedded payload is not a WebAssembly binary.');
      }
      wasmReference = this.emitFile({ type: 'asset', name: 'rnnoise.wasm', source: bytes });
      return {
        // Fetch before entering Emscripten: a failed request must not leave
        // its initialization promise or dependency-monitor timer running.
        code:
          `let squisqRnnoiseBytes;
            async function squisqFetchRnnoiseWasm() {
              const response = await fetch(${URL_PLACEHOLDER});
              if (!response.ok) throw new Error('RNNoise WASM load failed: ' + response.status);
              return new Uint8Array(await response.arrayBuffer());
            }\n` +
          code
            .replace(factory[0], `function ${name}() { return squisqRnnoiseBytes; }`)
            .replace(
              load,
              'static async load() { squisqRnnoiseBytes ??= await squisqFetchRnnoiseWasm();',
            ),
        map: null,
      };
    },
    renderChunk(code, chunk, options) {
      if (!wasmReference || !code.includes(URL_PLACEHOLDER)) return null;
      const file = this.getFileName(wasmReference);
      return {
        code: code.replaceAll(URL_PLACEHOLDER, wasmUrl(file, chunk.fileName, options.format, base)),
        map: null,
      };
    },
  };
}

/** The expression for the emitted file's URL, as Vite writes its own asset URLs. */
function wasmUrl(file: string, chunk: string, format: string, base: string | undefined): string {
  if (base && /^(?:[a-z][a-z\d+.-]*:)?\//i.test(base)) return JSON.stringify(base + file);
  const script = format === 'es' ? 'import.meta.url' : SCRIPT_URL;
  return `new URL(${JSON.stringify(relativePath(chunk, file))}, ${script}).href`;
}

/** `to` relative to the directory of `from`; both are output-relative POSIX paths. */
function relativePath(from: string, to: string): string {
  const fromDirs = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let shared = 0;
  while (shared < fromDirs.length && fromDirs[shared] === toParts[shared]) shared++;
  return [...fromDirs.slice(shared).map(() => '..'), ...toParts.slice(shared)].join('/');
}
