import { describe, expect, it } from 'vitest';
import { reanchorNarrationText } from '../narration/reanchor';

const TAKE = [
  'This is the first in a series of articles on testing local models.',
  'The tests compare complete configurations across five computers.',
  'They show useful differences in inference speed and memory capacity,',
  'but setup defects and inconsistent judging limit what the pass rates can tell us.',
  'Engine timings remain useful observations even so.',
  'Each section below explains one result in detail.',
].join('\n');

describe('reanchorNarrationText', () => {
  it('keeps offsets as they are when the text is unchanged', () => {
    const map = reanchorNarrationText(TAKE, TAKE)!;
    expect(map(0)).toBe(0);
    expect(map(TAKE.indexOf('five'))).toBe(TAKE.indexOf('five'));
  });

  it('moves every word past a title added above the take', () => {
    const current = `RTX Spark vs. the World\n${TAKE}`;
    const map = reanchorNarrationText(TAKE, current)!;
    for (const word of ['This', 'series', 'computers.'])
      expect(map(TAKE.indexOf(word))).toBe(current.indexOf(word));
  });

  it('drops only the words that were edited', () => {
    const current = TAKE.replace('local models', 'small local models').replace('five', '5');
    const map = reanchorNarrationText(TAKE, current)!;
    expect(map(TAKE.indexOf('five'))).toBeUndefined();
    expect(map(TAKE.indexOf('computers'))).toBe(current.indexOf('computers'));
    expect(map(TAKE.indexOf('local'))).toBe(current.indexOf('local'));
    expect(map(TAKE.indexOf('The tests'))).toBe(current.indexOf('The tests'));
  });

  it('places an offset between words on the next word, and inside a word within it', () => {
    const current = `Title\n${TAKE}`;
    const map = reanchorNarrationText(TAKE, current)!;
    expect(map(TAKE.indexOf(' series'))).toBe(current.indexOf('series'));
    expect(map(TAKE.indexOf('ries'))).toBe(current.indexOf('ries'));
    expect(map(TAKE.length)).toBeUndefined();
  });

  it('refuses a take that no longer narrates the text', () => {
    const shortened = `${TAKE.split('\n').slice(0, 3).join('\n')}\nNothing else.`;
    expect(reanchorNarrationText(TAKE, shortened)).toBeNull();
    expect(reanchorNarrationText(TAKE, 'Something else entirely.')).toBeNull();
    expect(reanchorNarrationText(TAKE, '')).toBeNull();
  });

  it('aligns long documents with scattered edits, within its edit budget', () => {
    const recorded = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ');
    const words = recorded.split(' ');
    const scattered = words.map((word, i) => (i % 100 === 50 ? `edited${i}` : word)).join(' ');
    const map = reanchorNarrationText(recorded, scattered)!;
    expect(map(recorded.indexOf('word2999'))).toBe(scattered.indexOf('word2999'));
    expect(map(recorded.indexOf('word150 '))).toBeUndefined();
    // More edits than the budget allows are refused rather than explored.
    const heavy = words.map((word, i) => (i % 10 === 5 ? `edited${i}` : word)).join(' ');
    expect(reanchorNarrationText(recorded, heavy)).toBeNull();
  });
});
