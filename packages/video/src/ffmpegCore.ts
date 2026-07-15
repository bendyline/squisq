/**
 * ffmpeg.wasm core asset resolution.
 *
 * `@ffmpeg/ffmpeg`'s `load()` falls back to a hard-coded `CORE_URL` pointing at
 * `https://unpkg.com/@ffmpeg/core@<version>/dist/umd/ffmpeg-core.js` whenever the
 * caller omits `coreURL`. For a published library that default is unacceptable:
 * it fetches and executes unpinned third-party code at runtime, breaks offline
 * and CSP-restricted deployments with an opaque load failure, and makes the CDN
 * a supply-chain surface for every consumer.
 *
 * Squisq therefore never lets that fallback trigger. Hosts must point the
 * runtime at core assets they control; {@link resolveFfmpegWasmLoad} turns an
 * absent `coreURL` into an actionable error before any encoder work starts.
 *
 * Browser-pure: no Node builtins, no filesystem access, no bundler assumptions.
 */

import type { FfmpegWasmLoadConfig } from './types.js';

/**
 * How a host wires up self-hosted core assets. Referenced by the error thrown
 * from {@link resolveFfmpegWasmLoad} and by the package README.
 */
export const FFMPEG_WASM_SETUP_HINT =
  'Copy @ffmpeg/core (node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js and ffmpeg-core.wasm) ' +
  'into a same-origin static path and pass ffmpegWasm: { coreURL, wasmURL } pointing at it. ' +
  'See packages/site/vite.config.ts + packages/site/src/ffmpegWasmConfig.ts for a worked example. ' +
  'To deliberately accept a remote core, pass that URL as coreURL explicitly.';

/**
 * Validate and normalize an {@link FfmpegWasmLoadConfig} for `FFmpeg.load()`.
 *
 * @param config - Host-supplied runtime asset URLs. Must carry a `coreURL`.
 * @param context - Human-readable name of the operation, used in the error.
 * @param defaults - Fallbacks for URLs the package can resolve itself (the
 *   bundled class worker ships beside the importing module).
 * @throws Error when no `coreURL` is configured, rather than silently
 *   inheriting @ffmpeg/ffmpeg's unpkg CDN default.
 */
export function resolveFfmpegWasmLoad(
  config: FfmpegWasmLoadConfig | undefined,
  context: string,
  defaults?: { classWorkerURL?: string },
): FfmpegWasmLoadConfig {
  const coreURL = config?.coreURL?.trim();
  if (!coreURL) {
    throw new Error(
      `${context} needs an ffmpeg.wasm core URL, but none was configured. ` +
        `${FFMPEG_WASM_SETUP_HINT}`,
    );
  }

  const classWorkerURL = config?.classWorkerURL ?? defaults?.classWorkerURL;
  return {
    ...config,
    coreURL,
    ...(classWorkerURL ? { classWorkerURL } : {}),
  };
}
