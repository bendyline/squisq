import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TELEPROMPTER_FAKE_MIC_PATH = path.join(
  repoRoot,
  'test-results',
  'teleprompter-fake-mic.wav',
);

const SAMPLE_RATE = 48_000;
const DURATION_SEC = 4;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

/**
 * Generate the deterministic fake microphone used by the teleprompter E2E tests.
 *
 * Chromium's built-in fake microphone depends on the host audio service and can
 * occasionally produce silence in long headless runs. A repeating half-second
 * silence/tone pattern exercises both sides of voice activity detection while
 * remaining independent of the machine running the suite.
 */
export async function ensureTeleprompterFakeMic(): Promise<void> {
  const sampleCount = SAMPLE_RATE * DURATION_SEC;
  const dataBytes = sampleCount * BYTES_PER_SAMPLE;
  const wav = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  wav.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < sampleCount; i++) {
    const timeSec = i / SAMPLE_RATE;
    const cycleSec = timeSec % 1;
    const toneOn = cycleSec >= 0.5;
    const sample = toneOn
      ? Math.sin(2 * Math.PI * 440 * timeSec) * 0.42 + Math.sin(2 * Math.PI * 880 * timeSec) * 0.08
      : 0;
    wav.writeInt16LE(Math.round(sample * 32_767), WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE);
  }

  await mkdir(path.dirname(TELEPROMPTER_FAKE_MIC_PATH), { recursive: true });
  await writeFile(TELEPROMPTER_FAKE_MIC_PATH, wav);
}
