import { describe, it, expect } from 'vitest';
import { resolveFfmpegWasmLoad, FFMPEG_WASM_SETUP_HINT } from '../ffmpegCore.js';

/**
 * Regression: @ffmpeg/ffmpeg's `load()` silently falls back to
 * `https://unpkg.com/@ffmpeg/core@…` when `coreURL` is omitted. Published
 * library code must never trigger that — it is a remote-code fetch that breaks
 * offline/CSP hosts and puts an unpinned CDN in the supply chain.
 */
describe('resolveFfmpegWasmLoad', () => {
  it('throws instead of letting @ffmpeg/ffmpeg default to the unpkg CDN', () => {
    expect(() => resolveFfmpegWasmLoad(undefined, 'Test export')).toThrow(
      /needs an ffmpeg\.wasm core URL/,
    );
  });

  it('names the operation and explains the required host wiring', () => {
    let message = '';
    try {
      resolveFfmpegWasmLoad(undefined, 'Animated GIF export');
    } catch (err: unknown) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('Animated GIF export');
    expect(message).toContain('ffmpegWasm: { coreURL, wasmURL }');
    expect(message).toContain('@ffmpeg/core');
  });

  it('never suggests a CDN URL as the resolved default', () => {
    expect(FFMPEG_WASM_SETUP_HINT).not.toContain('unpkg.com');
    expect(FFMPEG_WASM_SETUP_HINT).not.toMatch(/https?:\/\//);
  });

  it('rejects a blank or whitespace-only coreURL', () => {
    expect(() => resolveFfmpegWasmLoad({ coreURL: '' }, 'Test')).toThrow(/core URL/);
    expect(() => resolveFfmpegWasmLoad({ coreURL: '   ' }, 'Test')).toThrow(/core URL/);
  });

  it('passes a configured coreURL through untouched, trimmed', () => {
    expect(
      resolveFfmpegWasmLoad({ coreURL: ' /vendor/core.js ', wasmURL: '/vendor/core.wasm' }, 'Test'),
    ).toEqual({ coreURL: '/vendor/core.js', wasmURL: '/vendor/core.wasm' });
  });

  it('lets a host opt in to a remote core by naming it explicitly', () => {
    const remote = 'https://cdn.example.com/ffmpeg-core.js';
    expect(resolveFfmpegWasmLoad({ coreURL: remote }, 'Test').coreURL).toBe(remote);
  });

  it('supplies a default classWorkerURL but never overrides the caller', () => {
    expect(
      resolveFfmpegWasmLoad({ coreURL: '/core.js' }, 'Test', { classWorkerURL: '/pkg/cw.js' })
        .classWorkerURL,
    ).toBe('/pkg/cw.js');
    expect(
      resolveFfmpegWasmLoad({ coreURL: '/core.js', classWorkerURL: '/host/cw.js' }, 'Test', {
        classWorkerURL: '/pkg/cw.js',
      }).classWorkerURL,
    ).toBe('/host/cw.js');
  });
});
