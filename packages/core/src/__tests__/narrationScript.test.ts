import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse';
import { markdownToDoc } from '../doc/markdownToDoc';
import {
  buildNarrationScript,
  expectedSyllablesAt,
  wordPosAtExpectedSyllables,
  wordIndexAtChar,
  wordIndexAtTime,
} from '../narration/script';
import type { WordTiming } from '../narration/types';

const MD = `# Morning Routine

Every day starts the same way. Coffee first, then a walk.

The second paragraph has more words in it, honestly.

## The Walk

We head down to the river and watch the boats go by.
`;

function build() {
  return buildNarrationScript(markdownToDoc(parseMarkdown(MD)));
}

describe('buildNarrationScript', () => {
  it('charOffsets index sourceText exactly', () => {
    const script = build();
    expect(script.tokens.length).toBeGreaterThan(10);
    for (const token of script.tokens) {
      expect(script.sourceText.slice(token.charOffset, token.charEnd)).toBe(token.text);
    }
  });

  it('block ranges cover all tokens contiguously', () => {
    const script = build();
    expect(script.blocks.length).toBeGreaterThanOrEqual(2);
    let cursor = 0;
    for (let b = 0; b < script.blocks.length; b++) {
      const range = script.blocks[b];
      expect(range.tokenStart).toBe(cursor);
      expect(range.tokenEnd).toBeGreaterThan(range.tokenStart);
      for (let i = range.tokenStart; i < range.tokenEnd; i++) {
        expect(script.tokens[i].blockIndex).toBe(b);
        expect(script.tokens[i].blockId).toBe(range.blockId);
      }
      cursor = range.tokenEnd;
    }
    expect(cursor).toBe(script.tokens.length);
  });

  it('assigns pause classes: sentence, paragraph, block boundary', () => {
    const script = build();
    const tokenByText = (text: string) => script.tokens.find((t) => t.text === text)!;

    // "way." ends a sentence mid-paragraph → 1
    expect(tokenByText('way.').pauseAfter).toBe(1);
    // "walk." ends the paragraph (blank line follows within the block) → 2
    expect(tokenByText('walk.').pauseAfter).toBe(2);
    // Last token of each block → 3
    for (const range of script.blocks) {
      expect(script.tokens[range.tokenEnd - 1].pauseAfter).toBe(3);
    }
    // Plain word mid-sentence → 0
    expect(tokenByText('starts').pauseAfter).toBe(0);
  });

  it('includes headings as spoken text and honors includeTitles=false', () => {
    const doc = markdownToDoc(parseMarkdown(MD));
    const withTitles = buildNarrationScript(doc);
    const withoutTitles = buildNarrationScript(doc, { includeTitles: false });
    expect(withTitles.sourceText).toContain('Morning Routine');
    expect(withoutTitles.sourceText).not.toContain('Morning Routine');
    expect(withoutTitles.tokens.length).toBeLessThan(withTitles.tokens.length);
  });

  it('is deterministic', () => {
    const a = build();
    const b = build();
    expect(a).toEqual(b);
  });

  it('marks standalone punctuation as non-spoken with zero syllables', () => {
    const script = buildNarrationScript(
      markdownToDoc(parseMarkdown('# Intro\n\nSquisq — short — turns plain Markdown into slides.')),
    );
    const dashes = script.tokens.filter((t) => t.text === '—');
    expect(dashes.length).toBe(2);
    for (const dash of dashes) {
      expect(dash.spoken).toBe(false);
      expect(dash.syllables).toBe(0);
      expect(dash.spokenWordEquiv).toBe(0);
    }
    // Real words stay spoken; the em-dashes add nothing to the syllable total.
    for (const word of script.tokens.filter((t) => /[a-z]/i.test(t.text))) {
      expect(word.spoken).toBe(true);
      expect(word.syllables).toBeGreaterThanOrEqual(1);
    }
    const spokenSyllables = script.tokens
      .filter((t) => t.spoken)
      .reduce((sum, t) => sum + t.syllables, 0);
    expect(script.totalSyllables).toBe(spokenSyllables);
  });

  it('cumulative syllables are consistent prefix sums', () => {
    const script = build();
    expect(script.cumulativeSyllables.length).toBe(script.tokens.length + 1);
    expect(script.cumulativeSyllables[0]).toBe(0);
    for (let i = 0; i < script.tokens.length; i++) {
      expect(script.cumulativeSyllables[i + 1] - script.cumulativeSyllables[i]).toBe(
        script.tokens[i].syllables,
      );
    }
    expect(script.totalSyllables).toBe(script.cumulativeSyllables[script.tokens.length]);
  });
});

describe('script query helpers', () => {
  it('expectedSyllablesAt interpolates and inverts', () => {
    const script = build();
    expect(expectedSyllablesAt(script, 0)).toBe(0);
    expect(expectedSyllablesAt(script, script.tokens.length)).toBe(script.totalSyllables);
    const mid = script.tokens.length / 2;
    const syl = expectedSyllablesAt(script, mid);
    expect(wordPosAtExpectedSyllables(script, syl)).toBeCloseTo(mid, 5);
  });

  it('wordIndexAtChar finds the containing token', () => {
    const script = build();
    for (const i of [0, 3, script.tokens.length - 1]) {
      const token = script.tokens[i];
      expect(wordIndexAtChar(script, token.charOffset)).toBe(i);
      expect(wordIndexAtChar(script, token.charEnd - 1)).toBe(i);
    }
  });

  it('wordIndexAtTime picks the last started word', () => {
    const words: WordTiming[] = [
      { tokenIndex: 0, tSec: 0.5, interpolated: false },
      { tokenIndex: 1, tSec: 1.0, interpolated: false },
      { tokenIndex: 2, tSec: 2.0, interpolated: false },
    ];
    expect(wordIndexAtTime(words, 0)).toBe(0);
    expect(wordIndexAtTime(words, 1.2)).toBe(1);
    expect(wordIndexAtTime(words, 5)).toBe(2);
  });
});
