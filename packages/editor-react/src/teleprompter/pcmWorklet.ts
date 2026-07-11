/**
 * The PCM tap AudioWorklet, shipped as an inline source string.
 *
 * Why inline → Blob URL instead of a bundled asset: `audioWorklet
 * .addModule(url)` resolves relative to the host DOCUMENT, so a
 * dist-relative asset would need every consumer's bundler to rewrite
 * and serve it (editor-react ships zero runtime assets today). The
 * worklet is ~30 lines with no imports; inlining follows the
 * `PLAYER_BUNDLE` source-string precedent and needs zero bundler
 * config. The worklet does NO DSP — it batches 128-sample render
 * quanta into 1024-sample frames and posts them (transferably) to the
 * main thread, where the pure engine in `@bendyline/squisq/narration`
 * runs. The audio render thread never throttles, so pacing keeps
 * working while the browser window is fully occluded by recording
 * software — the whole point of the teleprompter's scenario 2.
 */

export const PCM_WORKLET_NAME = 'squisq-pcm-tap';

export const PCM_WORKLET_SOURCE = `
class SquisqPcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(1024);
    this._len = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      let i = 0;
      while (i < channel.length) {
        const n = Math.min(channel.length - i, this._buf.length - this._len);
        this._buf.set(channel.subarray(i, i + n), this._len);
        this._len += n;
        i += n;
        if (this._len === this._buf.length) {
          const out = this._buf;
          this._buf = new Float32Array(1024);
          this._len = 0;
          // Clone, don't transfer: Chrome recycles buffers transferred out
          // of the worklet scope once the receiving handler returns, so a
          // transferred hop reads as zeros if anything retains it. A 4 KB
          // structured clone at ~47 Hz is negligible.
          this.port.postMessage({ pcm: out, audioTime: currentTime });
        }
      }
    }
    return true;
  }
}
registerProcessor('${PCM_WORKLET_NAME}', SquisqPcmTap);
`;

/** Register the tap on an AudioContext via a same-origin Blob URL. */
export async function registerPcmWorklet(ctx: AudioContext): Promise<void> {
  const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
