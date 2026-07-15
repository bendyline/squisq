import { describe, it, expect } from 'vitest';
import { resolveAudioMapping } from '../doc/audioMapping';
import { MemoryContentContainer } from '../storage/ContentContainer';
import type { Block, Doc } from '../schemas/Doc';

/** A leaf block wired to a narration file via an `{[audio=…]}` annotation. */
function blockWithAudio(id: string, title: string, audio: string): Block {
  return {
    id,
    title,
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [],
    templateOverrides: { audio },
  };
}

function docWith(blocks: Block[]): Doc {
  return {
    articleId: 'audio-mapping-test',
    duration: 0,
    blocks,
    audio: { segments: [] },
  };
}

/**
 * Container holding two recordings plus a consolidated (version 2)
 * `timing.json`. `intro` is inserted first, so an order-sensitive match
 * binds it to both files.
 */
async function containerWithConsolidatedTiming(): Promise<MemoryContentContainer> {
  const container = new MemoryContentContainer();
  const timing = {
    version: 2,
    sections: {
      intro: { sourceText: 'The opening section.', duration: 10, bookmarks: [] },
      're-intro': { sourceText: 'The re-recorded opening.', duration: 25, bookmarks: [] },
    },
  };
  await container.writeFile(
    'timing.json',
    new TextEncoder().encode(JSON.stringify(timing)),
    'application/json',
  );
  for (const name of ['take-intro.mp3', 'take-re-intro.mp3']) {
    await container.writeFile(`audio/${name}`, new Uint8Array([1, 2, 3]), 'audio/mpeg');
  }
  return container;
}

describe('resolveAudioMapping consolidated timing', () => {
  it('binds each recording to its own section when one name suffixes another', async () => {
    // `take-re-intro` ends with both `-intro` and `-re-intro`. Taking the
    // first suffix hit would hand it `intro`'s 10s timing and desync every
    // following segment start; the longest (most specific) match wins.
    const container = await containerWithConsolidatedTiming();
    const doc = docWith([
      blockWithAudio('b1', 'Opening', 'take-intro.mp3'),
      blockWithAudio('b2', 'Second Take', 'take-re-intro.mp3'),
    ]);

    const result = await resolveAudioMapping(doc, container);
    const segments = result.audio.segments;

    expect(segments).toHaveLength(2);
    expect(segments[0].src).toBe('audio/take-intro.mp3');
    expect(segments[0].duration).toBe(10);
    // The distinguishing assertion: 25 (re-intro), never 10 (intro).
    expect(segments[1].src).toBe('audio/take-re-intro.mp3');
    expect(segments[1].duration).toBe(25);
    // Segment starts and the doc duration follow from those durations.
    expect(segments[1].startTime).toBe(10);
    expect(result.duration).toBe(35);
  });

  it('is independent of the order sections appear in timing.json', async () => {
    // Same container with the section keys inserted the other way round —
    // the mapping must not change.
    const container = new MemoryContentContainer();
    const timing = {
      version: 2,
      sections: {
        're-intro': { sourceText: 'The re-recorded opening.', duration: 25, bookmarks: [] },
        intro: { sourceText: 'The opening section.', duration: 10, bookmarks: [] },
      },
    };
    await container.writeFile(
      'timing.json',
      new TextEncoder().encode(JSON.stringify(timing)),
      'application/json',
    );
    for (const name of ['take-intro.mp3', 'take-re-intro.mp3']) {
      await container.writeFile(`audio/${name}`, new Uint8Array([1, 2, 3]), 'audio/mpeg');
    }

    const doc = docWith([
      blockWithAudio('b1', 'Opening', 'take-intro.mp3'),
      blockWithAudio('b2', 'Second Take', 'take-re-intro.mp3'),
    ]);

    const result = await resolveAudioMapping(doc, container);
    expect(result.audio.segments[0].duration).toBe(10);
    expect(result.audio.segments[1].duration).toBe(25);
  });
});
