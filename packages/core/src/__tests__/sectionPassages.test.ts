/**
 * Section passages: what a section says itself, keyed so side information
 * made from it can tell when it has changed.
 */
import { describe, expect, it } from 'vitest';
import { passageKey, sectionPassage, sectionPassages } from '../doc/sectionPassages';
import { presentationPassageKey, isPresentationPassageKey } from '../transform/presentationHints';
import { hashString } from '../random/SeededRandom';
import { convert } from './accessoryBlockFixtures';

const DOC = [
  '# Photosynthesis',
  '',
  'Plants turn light into sugar.',
  'They store it for later.',
  '',
  '## Light',
  '',
  'Leaves catch the light.',
].join('\n');
const keyOf = (md: string, id = 'photosynthesis') => sectionPassage(convert(md), id)?.key;

describe('section passages', () => {
  it('is a section’s own text, without its heading or sub-sections', () => {
    expect(sectionPassages(convert(DOC))).toEqual([
      {
        blockId: 'photosynthesis',
        heading: 'Photosynthesis',
        text: 'Plants turn light into sugar. They store it for later.',
        key: passageKey('Plants turn light into sugar. They store it for later.'),
      },
      {
        blockId: 'light',
        heading: 'Light',
        text: 'Leaves catch the light.',
        key: passageKey('Leaves catch the light.'),
      },
    ]);
  });

  it('keeps its key through a heading rename, re-wrapped lines and new sub-sections or side information', () => {
    const key = keyOf(DOC);
    expect(
      keyOf(DOC.replace('# Photosynthesis', '# Photosynthesis explained {#photosynthesis}')),
    ).toBe(key);
    expect(keyOf(DOC.replace('sugar.\nThey', 'sugar. They'))).toBe(key);
    expect(keyOf(DOC.replace('## Light', '## Water\n\nRoots drink.\n\n## Light'))).toBe(key);
    expect(keyOf(DOC.replace('## Light', '## A slide {[summary]}\n\n- A point\n\n## Light'))).toBe(
      key,
    );
  });

  it('changes its key when a word changes', () => {
    expect(keyOf(DOC.replace('sugar', 'starch'))).not.toBe(keyOf(DOC));
  });

  it('has no passage for a block not in the document, and an empty one for a heading alone', () => {
    expect(sectionPassage(convert(DOC), 'missing')).toBeUndefined();
    expect(sectionPassage(convert('# Alone\n\n## Next\n\nText.'), 'alone')?.text).toBe('');
    expect(sectionPassages(convert('# Alone\n\n## Next\n\nText.')).map((p) => p.blockId)).toEqual([
      'next',
    ]);
  });

  it('keys passages exactly as slide summaries always have', () => {
    expect(presentationPassageKey('Plants turn light into sugar.')).toBe(
      passageKey('Plants turn light into sugar.'),
    );
    expect(presentationPassageKey('abc')).toBe(`${hashString('abc').toString(36)}-3`);
    expect(isPresentationPassageKey(passageKey('anything'))).toBe(true);
    expect(isPresentationPassageKey('abc')).toBe(false);
  });
});
