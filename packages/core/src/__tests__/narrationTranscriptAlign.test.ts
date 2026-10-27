import { describe, it, expect } from 'vitest';
import {
  alignTranscript,
  transcriptWordKeys,
  type TranscriptSegment,
} from '../narration/transcriptAlign';
import type { NarrationScript } from '../narration/types';
import { scriptFromMarkdown } from './narrationTestSignals';

const MD = `# The River Walk

Every morning we follow the path along the river and count the boats heading out.
The bakery opens early and the smell of bread carries across the water to the far bank.

## The Market

Stalls line the square with fruit and flowers and a man who fixes watches while you wait.
We always stop for coffee before carrying everything home up the long hill past the church.

## Evening

The lamps come on one street at a time and the river turns the color of old coins.
`;

const script = scriptFromMarkdown(MD);

/** Each spoken token read at a steady pace, one segment per block, with word times. */
function verbatim(
  source: NarrationScript,
  startSec: number,
  stepSec: number,
): { segments: TranscriptSegment[]; times: number[] } {
  const times: number[] = new Array(source.tokens.length);
  let t = startSec;
  const segments = source.blocks.map((block) => {
    const words = [];
    for (let k = block.tokenStart; k < block.tokenEnd; k++) {
      const token = source.tokens[k];
      if (!token.spoken) continue;
      times[k] = t;
      words.push({ text: ` ${token.text}`, startSec: t, endSec: t + stepSec * 0.8 });
      t += stepSec;
    }
    t += 1;
    return {
      text: words.map((word) => word.text).join(''),
      startSec: words[0]?.startSec ?? t,
      endSec: words[words.length - 1]?.endSec ?? t,
      words,
    };
  });
  return { segments, times };
}

function heardWords(text: string, startSec: number, stepSec: number) {
  return text.split(' ').map((word, i) => ({
    text: ` ${word}`,
    startSec: startSec + i * stepSec,
    endSec: startSec + i * stepSec + stepSec * 0.8,
  }));
}

describe('transcriptWordKeys', () => {
  it('lowercases, joins contractions and splits on punctuation', () => {
    expect(transcriptWordKeys("You're")).toEqual(['youre']);
    expect(transcriptWordKeys('full-spectrum')).toEqual(['full', 'spectrum']);
    expect(transcriptWordKeys('Café,')).toEqual(['cafe']);
    expect(transcriptWordKeys('—')).toEqual([]);
  });
});

describe('alignTranscript', () => {
  it('times every word of a verbatim reading from the recognized words', () => {
    const { segments, times } = verbatim(script, 2, 0.4);
    const result = alignTranscript({ script, segments, durationSec: 80 });
    expect(result.matchedWords).toBe(result.spokenWords);
    for (const word of result.words) {
      if (script.tokens[word.tokenIndex].spoken) {
        expect(word.tSec).toBeCloseTo(times[word.tokenIndex], 6);
        expect(word.interpolated).toBe(false);
      }
    }
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0].startSec).toBe(0);
    expect(result.blocks[1].startSec).toBeCloseTo(times[script.blocks[1].tokenStart], 1);
    expect(result.blocks[2].startSec).toBeCloseTo(times[script.blocks[2].tokenStart], 1);
    for (let b = 0; b < result.blocks.length - 1; b++) {
      expect(result.blocks[b].endSec).toBe(result.blocks[b + 1].startSec);
    }
  });

  it('follows a paraphrased take that skips a section and mishears names', () => {
    const segments: TranscriptSegment[] = [
      {
        text: 'Hi everyone, before we start, a quick word about the walk.',
        startSec: 0,
        endSec: 4,
        words: heardWords('Hi everyone, before we start, a quick word about the walk.', 0, 0.4),
      },
      {
        text: 'The river walk. Every morning we follow the path along the river and we count boats heading out.',
        startSec: 5,
        endSec: 12,
        words: heardWords(
          'The river walk. Every morning we follow the path along the river and we count boats heading out.',
          5,
          0.35,
        ),
      },
      {
        text: 'The bakery opens really early and the smell of bread carries across the water to the far bank.',
        startSec: 12.5,
        endSec: 19,
        words: heardWords(
          'The bakery opens really early and the smell of bread carries across the water to the far bank.',
          12.5,
          0.35,
        ),
      },
      // The Market is skipped entirely; two minutes of demo follow.
      {
        text: 'Evening. The lamps come on one street at a time and the river turns the colour of old coins.',
        startSec: 140,
        endSec: 147,
        words: heardWords(
          'Evening. The lamps come on one street at a time and the river turns the colour of old coins.',
          140,
          0.35,
        ),
      },
    ];
    const result = alignTranscript({ script, segments, durationSec: 150 });
    const market = script.blocks[1];
    const skipped = script.tokens
      .slice(market.tokenStart, market.tokenEnd)
      .filter((token) => token.spoken).length;
    // Every word that was actually read is found, despite the paraphrase; the
    // only other miss is the "the" dropped from "count the boats".
    expect(result.matchedWords).toBe(result.spokenWords - skipped - 1);
    const [walk, marketRange, evening] = result.blocks;
    expect(walk.startSec).toBe(0);
    // The skipped section collapses where the speaker skipped it.
    expect(marketRange.endSec - marketRange.startSec).toBeLessThan(2);
    expect(marketRange.startSec).toBeGreaterThanOrEqual(18);
    // "Evening" is heard at 140 s.
    expect(evening.startSec).toBeGreaterThanOrEqual(139);
    expect(evening.startSec).toBeLessThanOrEqual(140.5);
    // A near-miss spelling still matches ("colour" for "color").
    const color = script.tokens.findIndex((token) => token.text === 'color');
    expect(result.words[color].interpolated).toBe(false);
  });

  it('keeps an off-script aside with the section it was said over', () => {
    const read = (sentence: string, start: number) => heardWords(sentence, start, 0.4);
    const aside = Array.from(
      { length: 12 },
      () => 'so here the demo shows how all of this looks in practice',
    ).join(' ');
    const words = [
      ...read('The river walk.', 1),
      ...read(
        'Every morning we follow the path along the river and count the boats heading out. The bakery opens early and the smell of bread carries across the water to the far bank.',
        3,
      ),
      // A minute of demo talk, then the Market section without its heading.
      ...read(aside, 20),
      ...read(
        'Stalls line the square with fruit and flowers and a man who fixes watches while you wait. We always stop for coffee before carrying everything home up the long hill past the church.',
        90,
      ),
      ...read('Evening. The lamps come on one street at a time.', 110),
    ];
    const result = alignTranscript({
      script,
      segments: [{ text: '', startSec: 1, endSec: 120, words }],
      durationSec: 120,
    });
    const [walk, market] = result.blocks;
    // The heading's unmatched words sit right before "Stalls", not at the
    // start of the aside, and no stray "the" in the aside pins them early.
    expect(market.startSec).toBeGreaterThan(88);
    expect(market.startSec).toBeLessThanOrEqual(90);
    expect(walk.endSec).toBe(market.startSec);
  });

  it('shares segment time by syllables when the recognizer gives no word times', () => {
    const { segments, times } = verbatim(script, 1, 0.4);
    const bare = segments.map(({ text, startSec, endSec }) => ({ text, startSec, endSec }));
    const result = alignTranscript({ script, segments: bare, durationSec: 80 });
    expect(result.matchedWords).toBe(result.spokenWords);
    expect(result.blocks[1].startSec).toBeCloseTo(times[script.blocks[1].tokenStart], 0);
    expect(result.blocks[2].startSec).toBeCloseTo(times[script.blocks[2].tokenStart], 0);
  });

  it('ignores recognizer annotations and sorts out-of-order segments', () => {
    const { segments } = verbatim(script, 1, 0.4);
    const noisy: TranscriptSegment[] = [
      ...segments.slice().reverse(),
      { text: '[BLANK_AUDIO]', startSec: 70, endSec: 75 },
      { text: '(music)', startSec: 75, endSec: 78, words: heardWords('(music)', 75, 1) },
    ];
    const result = alignTranscript({ script, segments: noisy, durationSec: 80 });
    expect(result.matchedWords).toBe(result.spokenWords);
    expect(result.detectedSyllables).toBe(result.spokenWords);
  });

  it('interpolates the whole script across the take when nothing was heard', () => {
    const result = alignTranscript({ script, segments: [], durationSec: 30 });
    expect(result.matchedWords).toBe(0);
    expect(result.words.every((word) => word.interpolated)).toBe(true);
    expect(result.blocks[result.blocks.length - 1].endSec).toBe(30);
    for (let i = 1; i < result.words.length; i++) {
      expect(result.words[i].tSec).toBeGreaterThanOrEqual(result.words[i - 1].tSec);
    }
  });
});
