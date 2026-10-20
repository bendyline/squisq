import type { Plugin } from 'vite';

/**
 * The pinned RNNoise package embeds its 3.6 MB WASM as base64 in JavaScript.
 * Extract it for the site's production builds (including workers), retaining
 * the upstream runtime and loading the binary only when Rnnoise.load() runs.
 * Published libraries and Vite dev keep the upstream self-contained module.
 */
export function rnnoiseWasmPlugin(): Plugin {
  return {
    name: 'rnnoise-wasm-asset',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@shiguredo/rnnoise-wasm/dist/rnnoise.js')) {
        return null;
      }

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
      const bytes = Buffer.from(base64!, 'base64');
      if (!bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
        this.error('RNNoise embedded payload is not a WebAssembly binary.');
      }
      const asset = this.emitFile({ type: 'asset', name: 'rnnoise.wasm', source: bytes });
      return {
        // Fetch before entering Emscripten: a failed request must not leave
        // its initialization promise or dependency-monitor timer running.
        code:
          `let squisqRnnoiseBytes;
            async function squisqFetchRnnoiseWasm() {
              const response = await fetch(import.meta.ROLLUP_FILE_URL_${asset});
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
  };
}
