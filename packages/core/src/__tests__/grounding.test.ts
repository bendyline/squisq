import { describe, expect, it } from 'vitest';
import {
  distinctiveStems,
  isGroundedParaphrase,
  isVerbatimQuote,
  numbersIn,
  rangeEndOnly,
  restatesHeadline,
  spelledNumbers,
  statedRanges,
  ungroundedNumber,
} from '../transform/grounding.js';

const source =
  'The lake is 3 to 7 miles deep in places. About 1,400 people live on its shores, and 40 percent of them fish. ' +
  'Between 10 and 12 boats leave each morning. The town was founded in 1875 by settlers from the coast.';

describe('grounding', () => {
  it('reads numbers as written, commas dropped', () => {
    expect(numbersIn('1,500 to 2,500 feet, 3.5% and 1990s')).toEqual([
      '1500',
      '2500',
      '3.5',
      '1990',
    ]);
    expect(numbersIn(36)).toEqual(['36']);
    expect(numbersIn(Number.NaN)).toEqual([]);
  });

  it('finds a number the source does not state', () => {
    expect(ungroundedNumber(['1400', '40%', 1875], source)).toBeUndefined();
    expect(ungroundedNumber('1,400 people', source)).toBeUndefined();
    expect(ungroundedNumber(['1875', '1880'], source)).toBe('1880');
    // A number is a whole token, not a substring: 14 is not in "1,400".
    expect(ungroundedNumber('14', source)).toBe('14');
    // Spelled out, a number is still stated.
    expect(ungroundedNumber('10 peaks', 'Ten peaks rise above the clouds.')).toBeUndefined();
  });

  it('reads numbers a source spells out', () => {
    expect(
      spelledNumbers(
        'Ten peaks, twenty-five huts, ninety nine steps and seventeen bridges for one guide.',
      ).map(({ value }) => value),
    ).toEqual(['10', '25', '99', '17']);
  });

  it('accepts the source’s words as a quote and rejects a paraphrase', () => {
    expect(isVerbatimQuote('“About 1,400 people live on its shores”', source)).toBe(true);
    expect(isVerbatimQuote('The town was founded in 1875 by settlers', source)).toBe(true);
    expect(isVerbatimQuote('Settlers from the coast built the town', source)).toBe(false);
    expect(isVerbatimQuote('', source)).toBe(false);
  });

  it('holds a paraphrase to the source’s numbers and most of its distinctive words', () => {
    expect(isGroundedParaphrase('Founded by coastal settlers', source)).toBe(true);
    expect(isGroundedParaphrase('Settlers: founded the town in 1875', source)).toBe(true);
    expect(isGroundedParaphrase('Founded by Spanish missionaries', source)).toBe(false);
    expect(isGroundedParaphrase('Founded in 1876', source)).toBe(false);
    expect(isGroundedParaphrase('Then', source)).toBe(true);
    expect(distinctiveStems('The writing of their stories')).toEqual(['writ', 'stor']);
    // An em dash separates words; a hyphen joins a compound.
    expect(distinctiveStems('they might be right—teams rocking')).toEqual([
      'migh',
      'righ',
      'team',
      'rock',
    ]);
    expect(distinctiveStems('a well-known coast')).toEqual(['well', 'coas']);
  });

  it('spots a point that only repeats its headline', () => {
    expect(restatesHeadline('Boats leave each morning', 'Boats leave each morning early')).toBe(
      true,
    );
    expect(restatesHeadline('Ten to twelve of them', 'Boats leave each morning')).toBe(false);
  });

  it('finds the ranges a source states', () => {
    expect(statedRanges(source).map(({ low, high }) => [low, high])).toEqual([
      ['3', '7'],
      ['10', '12'],
    ]);
    expect(statedRanges('1,500–2,500 feet').map(({ low, high }) => [low, high])).toEqual([
      ['1500', '2500'],
    ]);
  });

  it('flags a value the source gives only as one end of a range', () => {
    expect(rangeEndOnly('7', source)?.text).toBe('3 to 7');
    expect(rangeEndOnly('12 boats', source)?.text).toBe('Between 10 and 12');
    expect(rangeEndOnly('1,400', source)).toBeUndefined();
    // Stated on its own somewhere else, the number may be shown as one value.
    expect(rangeEndOnly('7', `${source} Its 7 islands are wooded.`)).toBeUndefined();
    expect(rangeEndOnly('9', source)).toBeUndefined();
    // "Ten peaks" states 10 on its own, whatever "5 to 10 meters" says.
    expect(rangeEndOnly('10', 'Trees of 5 to 10 meters grow below ten peaks.')).toBeUndefined();
  });
});
