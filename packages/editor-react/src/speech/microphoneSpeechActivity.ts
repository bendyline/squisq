/**
 * Adaptive loudness gate over a live microphone stream.
 *
 * Ported from Gezel's `packages/ui/src/components/microphone-speech-activity.ts`.
 *
 * The gate only SUGGESTS phrase boundaries to the progressive recorder; it
 * never decides that audio is disposable. Quiet speech can fall below a local
 * RMS threshold while the recognizer still understands it perfectly.
 */

export interface SpeechActivityMonitor {
  start(onActivity: (speaking: boolean, level: number) => void): void;
  stop(): void;
}

const SAMPLE_INTERVAL_MS = 50;

/**
 * Observe microphone energy locally through Web Audio. The stream is never
 * routed to speakers and no samples leave the page through this monitor.
 * Returns `null` where Web Audio is unavailable — the recorder then falls back
 * to fixed-length takes.
 */
export function createMicrophoneSpeechActivityMonitor(
  stream: MediaStream,
): SpeechActivityMonitor | null {
  if (typeof AudioContext === 'undefined') return null;
  return new WebAudioSpeechActivityMonitor(stream);
}

class WebAudioSpeechActivityMonitor implements SpeechActivityMonitor {
  private readonly stream: MediaStream;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private gate = createSpeechGate();

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  start(onActivity: (speaking: boolean, level: number) => void): void {
    if (this.timer !== null) return;
    const context = new AudioContext();
    this.context = context;
    try {
      const source = context.createMediaStreamSource(this.stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.15;
      source.connect(analyser);
      this.source = source;
      this.analyser = analyser;
      this.samples = new Float32Array(analyser.fftSize);
      void context.resume().catch(() => undefined);
    } catch (caught) {
      this.stop();
      throw caught;
    }

    this.timer = setInterval(() => {
      if (!this.analyser || !this.samples) return;
      this.analyser.getFloatTimeDomainData(this.samples);
      const level = rootMeanSquare(this.samples);
      onActivity(this.gate.step(level), level);
    }, SAMPLE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    this.samples = null;
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => undefined);
  }
}

/**
 * The hysteresis gate itself, separated from Web Audio so it is testable: a
 * slowly-adapting noise floor, an open threshold well above it, and a lower
 * close threshold so a syllable dip doesn't chop a phrase.
 */
export function createSpeechGate(): { step(level: number): boolean } {
  let noiseFloor = 0.004;
  let speaking = false;
  return {
    step(level: number): boolean {
      const openThreshold = Math.max(0.012, noiseFloor * 2.8);
      const closeThreshold = Math.max(0.008, noiseFloor * 1.8);
      speaking = level >= (speaking ? closeThreshold : openThreshold);
      if (!speaking) {
        // Follow slow changes in fan/room noise without teaching the gate that
        // a burst of speech is the new baseline.
        noiseFloor = Math.min(0.03, noiseFloor * 0.95 + level * 0.05);
      }
      return speaking;
    },
  };
}

export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
