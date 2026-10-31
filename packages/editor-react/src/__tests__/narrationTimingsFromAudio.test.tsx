/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { applyNarrationTiming, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { parseNarrationTimingJson } from '@bendyline/squisq/narration';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  compilePresentationPlan,
  createPresentationPlan,
  defaultPresentationHints,
} from '@bendyline/squisq/transform';
import { EditorProvider } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';
import {
  cutSpeechPieces,
  updateNarrationTimingsFromAudio,
} from '../documentTray/narrationTimingsFromAudio';
import type { SpeechInputProvider, SpeechInputTranscribeOptions } from '../speech/types';

const RATE = 16_000;
const TAKE_SEC = 70;
/** Silences the cutter should find: [25, 25.5) and [52, 52.5). */
const QUIET = [
  [25, 25.5],
  [52, 52.5],
];

function syntheticTake(): Float32Array {
  const pcm = new Float32Array(TAKE_SEC * RATE);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE;
    pcm[i] = QUIET.some(([from, to]) => t >= from && t < to) ? 0 : 0.3 * Math.sin(i / 7);
  }
  return pcm;
}

vi.mock('../tiptap/useResolvedMediaSrc', () => ({ useResolvedMediaSrc: (src: string) => src }));
vi.mock('../speech/speechAudioWav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../speech/speechAudioWav')>()),
  decodeSpeechPcm: vi.fn(async () => syntheticTake()),
}));

afterEach(cleanup);

const SRC = 'audio/take.webm';
const MARKDOWN = `{[audio src=${SRC} anchor=document]}

# The River Walk

Every morning we follow the path along the river and count the boats heading out.

## The Market

Stalls line the square with fruit and flowers and a man who fixes watches while you wait.

## Evening

The lamps come on one street at a time and the river turns the color of old coins.
`;

/** What the speaker said and when (take seconds). Headings are not read aloud. */
const SENTENCES: Array<[string, number]> = [
  ['Every morning we follow the path along the river and count the boats heading out.', 2],
  ['Stalls line the square with fruit and flowers and a man who fixes watches while you wait.', 30],
  ['The lamps come on one street at a time and the river turns the color of old coins.', 55],
];
const SPOKEN = SENTENCES.flatMap(([sentence, start]) =>
  sentence.split(' ').map((word, i): [string, number] => [word, start + i * 0.4]),
);

interface FakeCall {
  durationSec: number;
  options: SpeechInputTranscribeOptions;
}

/** A recognizer that hears {@link SPOKEN}, tracking where each WAV piece starts. */
function fakeRecognizer(words = SPOKEN): SpeechInputProvider & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let cursor = 0;
  return {
    id: 'fake-whisper',
    label: 'Fake recognizer',
    calls,
    status: async () => ({ state: 'ready' }),
    async transcribe(wav, options) {
      const durationSec = (wav.byteLength - 44) / 2 / RATE;
      calls.push({ durationSec, options });
      const from = cursor;
      cursor += durationSec;
      const heard = words.filter(([, t]) => t >= from && t < cursor);
      const timed = heard.map(([text, t]) => ({
        text: ` ${text}`,
        start: t - from,
        end: t - from + 0.3,
      }));
      return {
        text: heard.map(([text]) => text).join(' '),
        segments: timed.length
          ? [{ start: timed[0].start, end: timed[timed.length - 1].end, text: '', words: timed }]
          : [],
      };
    },
  };
}

const mediaProvider: MediaProvider = {
  resolveUrl: async (path) => path,
  listMedia: async () => [],
  addMedia: async (name) => name,
  removeMedia: async () => {},
  dispose: () => {},
};

async function containerWithTake(): Promise<MemoryContentContainer> {
  const container = new MemoryContentContainer();
  await container.writeFile(SRC, new Uint8Array([1, 2, 3]), 'audio/webm');
  return container;
}

describe('cutSpeechPieces', () => {
  it('cuts recognizer-sized pieces at the quietest moment near each limit', () => {
    const pieces = cutSpeechPieces(syntheticTake(), RATE, 0, TAKE_SEC);
    expect(pieces).toHaveLength(3);
    expect(pieces[0].from).toBe(0);
    expect(pieces[0].to / RATE).toBeGreaterThanOrEqual(25);
    expect(pieces[0].to / RATE).toBeLessThan(25.5);
    expect(pieces[1].to / RATE).toBeGreaterThanOrEqual(52);
    expect(pieces[1].to / RATE).toBeLessThan(52.5);
    expect(pieces[pieces.length - 1].to).toBe(TAKE_SEC * RATE);
    for (const piece of pieces) expect((piece.to - piece.from) / RATE).toBeLessThanOrEqual(29);
  });

  it('keeps to the trimmed window', () => {
    const pieces = cutSpeechPieces(syntheticTake(), RATE, 10, 39);
    expect(pieces).toEqual([{ from: 10 * RATE, to: 39 * RATE }]);
  });

  it('folds a trailing scrap into the piece before it', () => {
    // The only quiet spot sits 0.75 s before the window ends.
    const pcm = new Float32Array(30 * RATE).map((_, i) =>
      i >= 28.8 * RATE && i < 28.9 * RATE ? 0 : 0.3,
    );
    expect(cutSpeechPieces(pcm, RATE, 0, 29.6)).toEqual([{ from: 0, to: 29.6 * RATE }]);
  });
});

describe('updateNarrationTimingsFromAudio', () => {
  it('writes a sidecar the narration and presentation pipelines accept', async () => {
    const container = await containerWithTake();
    // A camera skew and the slides shown during the original take must survive
    // the update: only the recording knew them.
    const slides = [
      { charOffset: 0, time: 0 },
      { charOffset: 2, time: 12 },
    ];
    await container.writeFile(
      `${SRC}.timing.json`,
      new TextEncoder().encode(
        JSON.stringify({ sourceText: 'old', duration: 70, cameraOffsetSec: -0.25, slides }),
      ),
    );
    const provider = fakeRecognizer();
    const progress: string[] = [];
    const result = await updateNarrationTimingsFromAudio({
      src: SRC,
      markdownSource: MARKDOWN,
      provider,
      container,
      mediaProvider,
      signal: new AbortController().signal,
      onProgress: ({ phase }) => progress.push(phase),
    });

    expect(provider.calls).toHaveLength(3);
    expect(provider.calls.every((call) => call.options.timestamps)).toBe(true);
    expect(provider.calls[0].options.prompt).toBeUndefined();
    expect(provider.calls[2].options.prompt).toContain('watches');
    expect(progress[0]).toBe('reading');
    expect(progress[progress.length - 1]).toBe('saving');
    // Every spoken word is found; only the unread headings are interpolated.
    expect(result.matchedWords).toBe(SPOKEN.length);
    expect(result.sidecarPath).toBe(`${SRC}.timing.json`);

    const sidecar = parseNarrationTimingJson((await container.readFile(result.sidecarPath))!)!;
    expect(sidecar.generator).toEqual({ name: 'fake-whisper', method: 'transcript-align' });
    expect(sidecar.cameraOffsetSec).toBe(-0.25);
    expect(sidecar.slides).toEqual(slides);
    expect(sidecar.duration).toBe(TAKE_SEC);
    expect(sidecar.blocks.map((block) => Math.round(block.startSec))).toEqual([0, 30, 55]);

    const doc = markdownToDoc(parseMarkdown(MARKDOWN));
    const resolved = await applyNarrationTiming(doc, container);
    expect(resolved.applied).toBe(true);
    expect(resolved.doc.presentationNarration?.sourceText).toBe(sidecar.sourceText);
    const plan = createPresentationPlan(resolved.doc, defaultPresentationHints());
    expect(() => compilePresentationPlan(resolved.doc, plan)).not.toThrow();
  });

  it('leaves existing timings alone when the recording does not narrate the document', async () => {
    const container = await containerWithTake();
    const unrelated = fakeRecognizer(
      'completely different words about other things entirely'
        .split(' ')
        .map((word, i): [string, number] => [word, 3 + i * 0.5]),
    );
    await expect(
      updateNarrationTimingsFromAudio({
        src: SRC,
        markdownSource: MARKDOWN,
        provider: unrelated,
        container,
        mediaProvider,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/words in the document were heard/);
    expect(await container.readFile(`${SRC}.timing.json`)).toBeNull();
  });

  it('refuses media that is not the document narration', async () => {
    await expect(
      updateNarrationTimingsFromAudio({
        src: 'audio/other.webm',
        markdownSource: MARKDOWN,
        provider: fakeRecognizer(),
        container: await containerWithTake(),
        mediaProvider,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not the document narration/);
  });
});

describe('document tray timing action', () => {
  async function renderTray(speechInput: SpeechInputProvider | null) {
    const container = await containerWithTake();
    render(
      <EditorProvider
        initialMarkdown={MARKDOWN}
        initialView="wysiwyg"
        workspaceContainer={container}
        mediaProvider={mediaProvider}
        speechInput={speechInput}
      >
        <WysiwygEditor />
      </EditorProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Audio: take.webm' }));
    return container;
  }

  it('updates the narration timings from its audio and reports the match', async () => {
    const container = await renderTray(fakeRecognizer());
    fireEvent.click(await screen.findByRole('button', { name: 'Update timings from audio' }));
    expect(
      await screen.findByText(/Timings updated · \d+ of \d+ words matched/, undefined, {
        timeout: 5000,
      }),
    ).toBeTruthy();
    expect(await container.readFile(`${SRC}.timing.json`)).not.toBeNull();
  });

  it('offers nothing when the host has no speech recognizer', async () => {
    await renderTray(null);
    expect(screen.queryByRole('button', { name: 'Update timings from audio' })).toBeNull();
  });
});
