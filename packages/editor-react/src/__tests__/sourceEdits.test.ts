/**
 * The pure helpers behind `applySourceEdits` and `insertBlockAfterCursor`.
 *
 * The placement rule matters most: a heading-based block must never capture
 * the paragraphs after it, and nothing may land among a drawing's or layout's
 * child headings, where it would silently become part of the canvas.
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  applySourceEditsToText,
  blockInsertionPoint,
  headingDepthForInsertion,
  joinBlockAt,
  minimalReplaceEdit,
  normalizeSourceEdits,
  resolveOutlineInsertion,
  type OutlineBlock,
} from '../sourceEdits';

const p: OutlineBlock = { headingDepth: null, container: false };
const h = (depth: number, container = false): OutlineBlock => ({ headingDepth: depth, container });

/** Insert `block` for a cursor at the first occurrence of `marker`. */
function insertAt(
  source: string,
  marker: string,
  block: string,
  placement: 'afterBlock' | 'sectionEnd',
) {
  const point = blockInsertionPoint(source, source.indexOf(marker), placement);
  return {
    point,
    output: applySourceEditsToText(source, [joinBlockAt(source, point.offset, block)]),
  };
}

describe('normalizeSourceEdits', () => {
  it('sorts edits by position and keeps same-offset inserts in order', () => {
    const edits = [
      { start: 5, end: 5, text: 'B' },
      { start: 0, end: 1, text: 'x' },
      { start: 5, end: 5, text: 'C' },
    ];
    expect(normalizeSourceEdits('abcdefg', edits)).toEqual([edits[1], edits[0], edits[2]]);
  });

  it('accepts touching edits but rejects overlapping or out-of-range ones', () => {
    expect(
      normalizeSourceEdits('abcdef', [
        { start: 0, end: 2, text: '' },
        { start: 2, end: 4, text: '' },
      ]),
    ).not.toBeNull();
    expect(
      normalizeSourceEdits('abcdef', [
        { start: 0, end: 3, text: '' },
        { start: 2, end: 4, text: '' },
      ]),
    ).toBeNull();
    expect(normalizeSourceEdits('abc', [{ start: 2, end: 9, text: '' }])).toBeNull();
    expect(normalizeSourceEdits('abc', [{ start: 2, end: 1, text: '' }])).toBeNull();
    expect(normalizeSourceEdits('abc', [{ start: 0.5, end: 1, text: '' }])).toBeNull();
  });
});

describe('applySourceEditsToText', () => {
  it('applies several edits against the original offsets', () => {
    expect(
      applySourceEditsToText('one two three', [
        { start: 8, end: 13, text: '3' },
        { start: 0, end: 3, text: '1' },
      ]),
    ).toBe('1 two 3');
  });

  it('throws on edits it cannot apply', () => {
    expect(() => applySourceEditsToText('abc', [{ start: 0, end: 9, text: '' }])).toThrow(
      RangeError,
    );
  });
});

describe('minimalReplaceEdit', () => {
  it('is null for identical sources', () => {
    expect(minimalReplaceEdit('same', 'same')).toBeNull();
  });

  it('covers only the changed middle', () => {
    const edit = minimalReplaceEdit('alpha beta gamma', 'alpha BETA gamma');
    expect(edit).toEqual({ start: 6, end: 10, text: 'BETA' });
  });

  it('never lets the common prefix and suffix overlap', () => {
    for (const [a, b] of [
      ['aaa', 'aaaa'],
      ['aaaa', 'aa'],
      ['', 'x'],
      ['x', ''],
    ] as const) {
      const edit = minimalReplaceEdit(a, b);
      expect(edit).not.toBeNull();
      expect(applySourceEditsToText(a, [edit!])).toBe(b);
    }
  });
});

describe('resolveOutlineInsertion', () => {
  // # Title / para / ## A / para / para / ## B / para
  const outline = [h(1), p, h(2), p, p, h(2), p];

  it('puts an afterBlock insert straight after the cursor block', () => {
    expect(resolveOutlineInsertion(outline, 3, 'afterBlock')).toEqual({
      index: 4,
      sectionDepth: 2,
      nextHeadingDepth: 2,
      maxHeadingDepth: 6,
    });
  });

  it('puts a sectionEnd insert just before the next heading', () => {
    expect(resolveOutlineInsertion(outline, 3, 'sectionEnd').index).toBe(5);
    // The last section ends at the document end.
    expect(resolveOutlineInsertion(outline, 6, 'sectionEnd')).toMatchObject({
      index: 7,
      nextHeadingDepth: null,
    });
  });

  it('handles a cursor before every block', () => {
    expect(resolveOutlineInsertion([p, h(2), p], -1, 'afterBlock')).toMatchObject({
      index: 0,
      sectionDepth: 0,
    });
    expect(resolveOutlineInsertion([p, h(2), p], -1, 'sectionEnd').index).toBe(1);
  });

  describe('inside a container template', () => {
    // ## Intro / para / ## Map {[drawing]} / ### a / ### b / para / ## Next
    const withDrawing = [h(2), p, h(2, true), h(3), h(3), p, h(2)];

    it('puts an afterBlock insert before the container, never among its children', () => {
      for (const cursor of [2, 3, 5]) {
        expect(resolveOutlineInsertion(withDrawing, cursor, 'afterBlock').index).toBe(2);
      }
    });

    it('puts a sectionEnd insert after the whole container', () => {
      const result = resolveOutlineInsertion(withDrawing, 4, 'sectionEnd');
      expect(result).toEqual({
        index: 6,
        sectionDepth: 1,
        nextHeadingDepth: 2,
        maxHeadingDepth: 2,
      });
      // The only heading depth that closes the drawing is its own.
      expect(headingDepthForInsertion(result)).toBe(2);
    });

    it('caps the depth straight after a container that runs to the document end', () => {
      const result = resolveOutlineInsertion([h(2), p, h(3, true), h(4)], 3, 'sectionEnd');
      expect(result).toMatchObject({ index: 4, nextHeadingDepth: null, maxHeadingDepth: 3 });
      expect(headingDepthForInsertion(result, { childLevels: 1 })).toBe(3);
    });
  });
});

describe('headingDepthForInsertion', () => {
  it('nests one level under the section and never deeper than the next heading allows', () => {
    expect(
      headingDepthForInsertion({ sectionDepth: 2, nextHeadingDepth: 2, maxHeadingDepth: 6 }),
    ).toBe(3);
    // A deeper next heading pulls the block down to its depth so it closes it.
    expect(
      headingDepthForInsertion({ sectionDepth: 2, nextHeadingDepth: 4, maxHeadingDepth: 6 }),
    ).toBe(4);
    // Never a level-1 heading for an inserted block.
    expect(
      headingDepthForInsertion({ sectionDepth: 0, nextHeadingDepth: null, maxHeadingDepth: 6 }),
    ).toBe(2);
  });

  it('leaves room for child headings, or reports that nothing fits', () => {
    expect(
      headingDepthForInsertion(
        { sectionDepth: 5, nextHeadingDepth: null, maxHeadingDepth: 6 },
        { childLevels: 1 },
      ),
    ).toBe(5);
    expect(
      headingDepthForInsertion(
        { sectionDepth: 5, nextHeadingDepth: 6, maxHeadingDepth: 6 },
        { childLevels: 1 },
      ),
    ).toBeNull();
  });
});

describe('blockInsertionPoint and joinBlockAt', () => {
  const doc =
    '# Title\n\nIntro.\n\n## Steps\n\nFirst we plan.\n\nThen we build.\n\n## Next\n\nMore.\n';
  const fence = '```mermaid\nflowchart LR\n  a --> b\n```';

  it('inserts a fence after the paragraph holding the cursor, with blank lines around it', () => {
    const { output } = insertAt(doc, 'First we', fence, 'afterBlock');
    expect(output).toBe(
      '# Title\n\nIntro.\n\n## Steps\n\nFirst we plan.\n\n' +
        fence +
        '\n\nThen we build.\n\n## Next\n\nMore.\n',
    );
  });

  it('inserts at the section end without capturing the next section', () => {
    const block = '### Plan {[layout]}\n\n#### {#t1} {[text x=0 y=0 width=10 height=10]}\n\nHi';
    const { point, output } = insertAt(doc, 'First we', block, 'sectionEnd');
    expect(point).toMatchObject({ sectionDepth: 2, nextHeadingDepth: 2, maxHeadingDepth: 6 });
    expect(output).toContain('Then we build.\n\n### Plan {[layout]}');
    expect(output).toContain('Hi\n\n## Next\n\nMore.\n');
    // "## Next" is still a top-level section, not absorbed by the layout.
    const headings = parseMarkdown(output).children.filter((n) => n.type === 'heading');
    expect(headings.map((n) => (n.type === 'heading' ? n.depth : 0))).toEqual([1, 2, 3, 4, 2]);
  });

  it('appends at the document end with a single trailing newline', () => {
    const { output } = insertAt(doc, 'More.', fence, 'afterBlock');
    expect(output.endsWith('More.\n\n' + fence + '\n')).toBe(true);
  });

  it('keeps frontmatter intact when inserting before the first block', () => {
    const source = '---\ntitle: T\n---\n\nBody.\n';
    const point = blockInsertionPoint(source, 0, 'afterBlock');
    const output = applySourceEditsToText(source, [joinBlockAt(source, point.offset, 'Lead.')]);
    expect(output).toBe('---\ntitle: T\n---\n\nLead.\n\nBody.\n');
  });

  it('does not eat the indentation of an indented code block that follows', () => {
    const source = 'Para.\n\n    indented code\n';
    const output = applySourceEditsToText(source, [joinBlockAt(source, 5, 'New.')]);
    expect(output).toBe('Para.\n\nNew.\n\n    indented code\n');
  });

  it('steps outside a drawing the cursor sits in', () => {
    const source =
      '## Map {[drawing]}\n\n### A {#a} {[rectangle]}\n\n### B {#b} {[rectangle]}\n\n## After\n';
    const before = insertAt(source, '### B', fence, 'afterBlock').output;
    expect(before.startsWith(fence + '\n\n## Map {[drawing]}')).toBe(true);
    const after = insertAt(source, '### B', '## Notes {[layout]}', 'sectionEnd').output;
    expect(after).toContain('### B {#b} {[rectangle]}\n\n## Notes {[layout]}\n\n## After\n');
  });
});
