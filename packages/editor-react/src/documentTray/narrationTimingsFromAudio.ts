/**
 * "Update timings from audio": time a document narration from what a speech
 * recognizer hears in its take.
 *
 * As with dictation, the editor owns everything up to the recognizer: it
 * decodes the take (an audio file or the audio track of a video), cuts it
 * into pieces of at most {@link MAX_PIECE_SEC} at the quietest moment near
 * each boundary, and sends each piece as a 16 kHz WAV to the host's
 * `SpeechInputProvider` with `timestamps: true`. The timed words are matched
 * to the document's narration script (`alignTranscript`) and saved as the
 * take's v3 sidecar at `<media>.timing.json` — the file `applyNarrationTiming`
 * reads — so slides, captions and the summarization designer follow the voice.
 *
 * Loaded on demand by `narrationTimingJobs`, and loads the speech audio
 * codec on demand in turn, like dictation's capture engine.
 */

import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  alignTranscript,
  buildNarrationScript,
  buildNarrationTimingJson,
  parseNarrationTimingJson,
  type TranscriptSegment,
} from '@bendyline/squisq/narration';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { encodeNarrationTimingJson, timingPathFor } from '../recorder/timingJson';
import {
  SPEECH_INPUT_SAMPLE_RATE,
  type SpeechInputProvider,
  type SpeechInputTranscript,
} from '../speech/types';

/** Whisper listens in 30-second windows; stay just inside one. */
const MAX_PIECE_SEC = 29;
/** How far back from a piece's limit to look for a quiet place to cut. */
const CUT_SEARCH_SEC = 6;
const CUT_FRAME_SEC = 0.05;
/** A trailing scrap shorter than this joins the piece before it. */
const MIN_PIECE_SEC = 1;
/** Below this share of matched words the take does not narrate this text. */
const MIN_MATCHED_SHARE = 0.2;
const PROMPT_TAIL_CHARS = 1_000;

export type NarrationTimingPhase = 'reading' | 'transcribing' | 'matching' | 'saving';

export interface NarrationTimingProgress {
  phase: NarrationTimingPhase;
  /** Overall completion, 0 to 1. */
  fraction: number;
}

export interface NarrationTimingResult {
  matchedWords: number;
  spokenWords: number;
  sidecarPath: string;
}

export interface NarrationTimingsFromAudioInput {
  /** The narration clip's `src`, exactly as the document spells it. */
  src: string;
  /** The document the timings must match. */
  markdownSource: string;
  provider: SpeechInputProvider;
  container: ContentContainer;
  mediaProvider: MediaProvider;
  signal: AbortSignal;
  onProgress?: (progress: NarrationTimingProgress) => void;
}

interface Piece {
  from: number;
  to: number;
}

/** Sample index of the quietest frame center in [lo, hi). */
function quietestSample(pcm: Float32Array, lo: number, hi: number, frame: number): number {
  let best = hi;
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let at = lo; at + frame <= hi; at += frame >> 1) {
    let energy = 0;
    for (let i = at; i < at + frame; i++) energy += pcm[i] * pcm[i];
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = at + (frame >> 1);
    }
  }
  return best;
}

/** Recognizer-sized pieces of [startSec, endSec), cut where the take is quietest. */
export function cutSpeechPieces(
  pcm: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number,
): Piece[] {
  const end = Math.min(pcm.length, Math.max(0, Math.round(endSec * sampleRate)));
  const max = Math.round(MAX_PIECE_SEC * sampleRate);
  const frame = Math.max(2, Math.round(CUT_FRAME_SEC * sampleRate));
  const pieces: Piece[] = [];
  let from = Math.min(end, Math.max(0, Math.round(startSec * sampleRate)));
  while (from < end) {
    if (end - from <= max) {
      pieces.push({ from, to: end });
      break;
    }
    const to = quietestSample(
      pcm,
      from + max - Math.round(CUT_SEARCH_SEC * sampleRate),
      from + max,
      frame,
    );
    pieces.push({ from, to });
    from = to;
  }
  const last = pieces[pieces.length - 1];
  if (pieces.length > 1 && last && last.to - last.from < MIN_PIECE_SEC * sampleRate) {
    pieces.pop();
    pieces[pieces.length - 1].to = last.to;
  }
  return pieces;
}

/** A piece's transcript on the take's timeline. */
function timedSegments(
  transcript: SpeechInputTranscript,
  offsetSec: number,
  endSec: number,
): TranscriptSegment[] {
  if (transcript.segments?.length) {
    return transcript.segments.map((segment) => ({
      text: segment.text,
      startSec: offsetSec + segment.start,
      endSec: offsetSec + segment.end,
      ...(segment.words?.length
        ? {
            words: segment.words.map((word) => ({
              text: word.text,
              startSec: offsetSec + word.start,
              endSec: offsetSec + word.end,
            })),
          }
        : {}),
    }));
  }
  // A recognizer without timestamps still places its words within the piece.
  const text = transcript.text.trim();
  return text ? [{ text, startSec: offsetSec, endSec }] : [];
}

async function readTake(
  mediaProvider: MediaProvider,
  container: ContentContainer,
  src: string,
): Promise<Blob> {
  const url = await mediaProvider.resolveUrl(src);
  if (url && url !== src) {
    const response = await fetch(url);
    if (response.ok) return response.blob();
  }
  const bytes = await container.readFile(src);
  if (!bytes) throw new Error('The recording could not be read.');
  return new Blob([bytes]);
}

export async function updateNarrationTimingsFromAudio(
  input: NarrationTimingsFromAudioInput,
): Promise<NarrationTimingResult> {
  const { src, provider, container, signal } = input;
  const report = (phase: NarrationTimingPhase, fraction: number) =>
    input.onProgress?.({ phase, fraction });

  const doc = markdownToDoc(parseMarkdown(input.markdownSource));
  const clip = (doc.documentMedia ?? []).find(
    (entry) => entry.anchor === 'document' && entry.src === src,
  );
  if (!clip) throw new Error('This recording is not the document narration.');
  const script = buildNarrationScript(doc);
  if (!script.tokens.some((token) => token.spoken)) {
    throw new Error('The document has no text to match the recording against.');
  }

  report('reading', 0);
  await provider.prepare?.(signal);
  const { decodeSpeechPcm, encodeMonoPcm16Wav } = await import('../speech/speechAudioWav');
  const pcm = await decodeSpeechPcm(await readTake(input.mediaProvider, container, src));
  signal.throwIfAborted();
  const rate = SPEECH_INPUT_SAMPLE_RATE;
  const durationSec = pcm.length / rate;
  // Only what plays is narrated; times stay on the take's own timeline.
  const pieces = cutSpeechPieces(pcm, rate, clip.clipStart ?? 0, clip.clipEnd ?? durationSec);
  if (!pieces.length) throw new Error('The recording has no audio to transcribe.');

  const segments: TranscriptSegment[] = [];
  let tail = '';
  for (const [index, piece] of pieces.entries()) {
    report('transcribing', 0.05 + (0.9 * index) / pieces.length);
    const wav = encodeMonoPcm16Wav([pcm.subarray(piece.from, piece.to)], rate).buffer;
    const transcript = await provider.transcribe(wav, {
      signal,
      timestamps: true,
      ...(tail ? { prompt: tail } : {}),
    });
    signal.throwIfAborted();
    segments.push(...timedSegments(transcript, piece.from / rate, piece.to / rate));
    const text = transcript.text.trim();
    if (text) tail = `${tail} ${text}`.slice(-PROMPT_TAIL_CHARS).replace(/^\S*\s/u, '');
  }

  report('matching', 0.95);
  const alignment = alignTranscript({ script, segments, durationSec });
  if (alignment.matchedWords < Math.max(3, alignment.spokenWords * MIN_MATCHED_SHARE)) {
    throw new Error(
      `Only ${alignment.matchedWords} of ${alignment.spokenWords} words in the document were ` +
        'heard in the recording, so its timings were left unchanged.',
    );
  }

  report('saving', 0.98);
  const sidecarPath = timingPathFor(src);
  // Keep what only the original recording knew: camera skew and build steps.
  const existing = await container.readFile(sidecarPath);
  const previous = existing ? parseNarrationTimingJson(existing) : null;
  const payload = buildNarrationTimingJson(script, alignment, durationSec, {
    generator: { name: provider.id, method: 'transcript-align' },
    ...(previous?.cameraOffsetSec !== undefined
      ? { cameraOffsetSec: previous.cameraOffsetSec }
      : {}),
  });
  signal.throwIfAborted();
  await container.writeFile(
    sidecarPath,
    encodeNarrationTimingJson(previous?.builds ? { ...payload, builds: previous.builds } : payload),
    'application/json',
  );
  return {
    matchedWords: alignment.matchedWords,
    spokenWords: alignment.spokenWords,
    sidecarPath,
  };
}
