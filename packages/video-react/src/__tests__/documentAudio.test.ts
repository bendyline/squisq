/**
 * renderDocumentAudio — the host-facing doc → mixed AudioBuffer helper.
 *
 * jsdom has no Web Audio, so a recording OfflineAudioContext stands in: it
 * captures the context shape and every scheduled source node, which is what
 * the helper is responsible for (decoding/mixing itself is the browser's).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, resolveAudioMapping } from '@bendyline/squisq/doc';
import { buildNarrationScript, type NarrationTimingJsonV3 } from '@bendyline/squisq/narration';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { Doc } from '@bendyline/squisq/schemas';
import {
  audioTimelineEnd,
  documentAudioTimeline,
  loadAudioTimelineSources,
  renderDocumentAudio,
} from '../documentAudio.js';

interface ScheduledStart {
  src: string;
  args: number[];
}

interface ContextRecord {
  channels: number;
  length: number;
  sampleRate: number;
  starts: ScheduledStart[];
}

/** Install a recording OfflineAudioContext; decoded buffers carry their source path. */
function installRecordingContext(): ContextRecord[] {
  const contexts: ContextRecord[] = [];
  class RecordingOfflineAudioContext {
    destination = {};
    readonly record: ContextRecord;

    constructor(channels: number, length: number, sampleRate: number) {
      this.record = { channels, length, sampleRate, starts: [] };
      contexts.push(this.record);
    }

    async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
      return { src: new TextDecoder().decode(data) } as unknown as AudioBuffer;
    }

    createBufferSource(): AudioBufferSourceNode {
      const record = this.record;
      const node = {
        buffer: null as (AudioBuffer & { src?: string }) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: (...args: number[]) => record.starts.push({ src: node.buffer?.src ?? '?', args }),
      };
      return node as unknown as AudioBufferSourceNode;
    }

    createGain(): GainNode {
      return {
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      } as unknown as GainNode;
    }

    async startRendering(): Promise<AudioBuffer> {
      return {
        numberOfChannels: this.record.channels,
        length: this.record.length,
        sampleRate: this.record.sampleRate,
      } as unknown as AudioBuffer;
    }
  }
  vi.stubGlobal('OfflineAudioContext', RecordingOfflineAudioContext);
  return contexts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BODY = `# Intro

Alpha beta gamma delta epsilon words for the intro block.

# Ending

Lambda mu nu xi omicron words for the ending block.
`;

/** A doc with a document-anchored narration take + its v3 sidecar, resolved like export does. */
async function narratedDoc(annotation = '{[audio src=audio/take.webm anchor=document]}') {
  const raw = markdownToDoc(parseMarkdown(`${annotation}\n\n${BODY}`));
  const script = buildNarrationScript(raw);
  const sidecar: NarrationTimingJsonV3 = {
    version: 3,
    sourceText: script.sourceText,
    duration: 20,
    bookmarks: [],
    blocks: script.blocks.map((range, i) => ({
      blockId: range.blockId,
      blockIndex: i,
      charStart: range.charStart,
      charEnd: range.charEnd,
      startSec: i * 12,
      endSec: i === 0 ? 12 : 20,
    })),
    generator: { name: 'docblocks-kokoro', method: 'tts' },
  };
  const container = new MemoryContentContainer();
  await container.writeFile(
    'audio/take.webm',
    new TextEncoder().encode('audio/take.webm'),
    'audio/webm',
  );
  await container.writeFile(
    'audio/take.webm.timing.json',
    new TextEncoder().encode(JSON.stringify(sidecar)),
    'application/json',
  );
  const doc = await resolveAudioMapping(raw, container);
  const readMedia = vi.fn(
    async (src: string): Promise<ArrayBuffer | null> => container.readFile(src),
  );
  return { doc, readMedia };
}

describe('renderDocumentAudio', () => {
  it('mixes a document-anchored narration over the voice-timed doc timeline', async () => {
    const contexts = installRecordingContext();
    const { doc, readMedia } = await narratedDoc();
    expect(doc.duration).toBe(20);

    const buffer = await renderDocumentAudio(doc, { readMedia });

    expect(buffer).not.toBeNull();
    expect(readMedia).toHaveBeenCalledTimes(1);
    expect(readMedia).toHaveBeenCalledWith('audio/take.webm');
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ channels: 2, sampleRate: 48_000, length: 20 * 48_000 });
    expect(contexts[0].starts).toEqual([{ src: 'audio/take.webm', args: [0, 0, 20] }]);
  });

  it('honors a custom sample rate and the clip trim window', async () => {
    const contexts = installRecordingContext();
    const { doc, readMedia } = await narratedDoc(
      '{[audio src=audio/take.webm anchor=document clipStart=4 clipEnd=18]}',
    );
    await renderDocumentAudio(doc, { readMedia, sampleRate: 24_000 });
    expect(contexts[0].sampleRate).toBe(24_000);
    expect(contexts[0].length).toBe(14 * 24_000);
    expect(contexts[0].starts).toEqual([{ src: 'audio/take.webm', args: [0, 4, 14] }]);
  });

  it('mixes a media-edit render instead of the source, as video export does', async () => {
    const contexts = installRecordingContext();
    const { doc, readMedia } = await narratedDoc(
      '{[audio src=audio/take.webm anchor=document fx="loudness:-16"]}',
    );
    readMedia.mockImplementation(async (src: string) => new TextEncoder().encode(src).buffer);
    await renderDocumentAudio(doc, {
      readMedia,
      processedAudio: (clip) =>
        clip.src === 'audio/take.webm' ? '.mediaEdits/take.webm' : undefined,
    });
    expect(readMedia).toHaveBeenCalledWith('.mediaEdits/take.webm');
    expect(readMedia).not.toHaveBeenCalledWith('audio/take.webm');
    expect(contexts[0].starts[0].src).toBe('.mediaEdits/take.webm');
  });

  it('returns null for a doc with no audio, without touching media or Web Audio', async () => {
    const contexts = installRecordingContext();
    const readMedia = vi.fn(async () => null);
    const doc = markdownToDoc(parseMarkdown(BODY));
    await expect(renderDocumentAudio(doc, { readMedia })).resolves.toBeNull();
    expect(readMedia).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it('rejects when a scheduled file is missing, unless asked to skip it', async () => {
    installRecordingContext();
    const { doc } = await narratedDoc();
    const readMedia = vi.fn(async () => null);
    await expect(renderDocumentAudio(doc, { readMedia })).rejects.toThrow(
      'Audio files could not be loaded: audio/take.webm',
    );
    await expect(renderDocumentAudio(doc, { readMedia, missingMedia: 'skip' })).resolves.toBeNull();
  });

  it('stops at the abort signal', async () => {
    installRecordingContext();
    const { doc, readMedia } = await narratedDoc();
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderDocumentAudio(doc, { readMedia, signal: controller.signal }),
    ).rejects.toThrow();
    expect(readMedia).not.toHaveBeenCalled();
  });
});

describe('document audio building blocks', () => {
  const doc: Doc = {
    articleId: 'blocks',
    duration: 6,
    blocks: [{ id: 'b1', startTime: 0, duration: 6, audioSegment: 0 }],
    audio: {
      segments: [
        { name: 'a', src: 'a.mp3', startTime: 0, duration: 2 },
        { name: 'b', src: 'b.mp3', startTime: 2, duration: 3 },
      ],
    },
  };

  it('offsets the whole timeline for a cover pre-roll', () => {
    expect(documentAudioTimeline(doc, { offsetSec: 1.5 }).map((c) => c.startSec)).toEqual([
      1.5, 3.5,
    ]);
  });

  it('spans the later of the last clip and the requested floor', () => {
    const timeline = documentAudioTimeline(doc);
    expect(audioTimelineEnd(timeline)).toBe(5);
    expect(audioTimelineEnd(timeline, 6)).toBe(6);
    expect(audioTimelineEnd(timeline, Number.NaN)).toBe(5);
  });

  it('reads each unique source once and reports the missing ones in order', async () => {
    const timeline = [
      ...documentAudioTimeline(doc),
      { src: 'a.mp3', startSec: 5, sourceInSec: 0, durationSec: 1 },
    ];
    const reads: string[] = [];
    const { buffers, missing } = await loadAudioTimelineSources(timeline, async (src) => {
      reads.push(src);
      return src === 'a.mp3' ? new ArrayBuffer(1) : null;
    });
    expect(reads).toEqual(['a.mp3', 'b.mp3']);
    expect([...buffers.keys()]).toEqual(['a.mp3']);
    expect(missing).toEqual(['b.mp3']);
  });
});
