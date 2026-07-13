import { describe, it, expect } from 'vitest';
import { createNarrationSession, narrationSessionStep } from '../narration/session';
import { createFeatureState, featureStep } from '../narration/features';
import { scriptFromMarkdown } from './narrationTestSignals';

/**
 * Repro of the browser flow: 1024-sample worklet hops (exactly one
 * frameSize) fed one at a time into a live session. Guards the carry /
 * aliasing path that only this hop pattern exercises.
 */
describe('narration session with worklet-sized hops', () => {
  it('featureStep reports real RMS for steady 1024-sample hops', () => {
    let state = createFeatureState(48000);
    let lastRms = -1;
    for (let k = 0; k < 30; k++) {
      const hop = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        hop[i] = 0.6 * Math.sin(((k * 1024 + i) * 2 * Math.PI * 700) / 48000);
      }
      const step = featureStep(state, hop);
      state = step.state;
      for (const frame of step.frames) lastRms = frame.rms;
    }
    expect(lastRms).toBeGreaterThan(0.3);
  });

  it('survives callers that recycle hop buffers after each step', () => {
    // Chrome invalidates buffers transferred out of an AudioWorklet once
    // the message handler returns. The carry must OWN its memory (slice,
    // not subarray) or later frames silently read zeros.
    let state = createFeatureState(48000);
    let lastRms = -1;
    for (let k = 0; k < 30; k++) {
      const hop = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        hop[i] = 0.6 * Math.sin(((k * 1024 + i) * 2 * Math.PI * 700) / 48000);
      }
      const step = featureStep(state, hop);
      state = step.state;
      hop.fill(0); // simulate the buffer being recycled
      for (const frame of step.frames) lastRms = frame.rms;
    }
    expect(lastRms).toBeGreaterThan(0.3);
  });

  it('narrationSessionStep exposes real lastFrame rms for the same hops', () => {
    const script = scriptFromMarkdown('# One\n\nalpha beta gamma delta epsilon zeta eta theta.');
    let session = createNarrationSession(48000, script, {
      vad: { enterRatio: 3, exitRatio: 2.5 },
      pacing: { baseWpm: 150 },
    });
    for (let k = 0; k < 30; k++) {
      const hop = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        hop[i] = 0.6 * Math.sin(((k * 1024 + i) * 2 * Math.PI * 700) / 48000);
      }
      session = narrationSessionStep(session, hop);
    }
    expect(session.lastFrame).not.toBeNull();
    expect(session.lastFrame!.rms).toBeGreaterThan(0.3);
  });
});
