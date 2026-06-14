import { describe, expect, it } from 'vitest';
import {
  getBlockSlices,
  spliceBlock,
  lineToOffset,
  offsetToLine,
  sliceIndexAtOffset,
} from '../blockRange';

describe('getBlockSlices', () => {
  it('returns one slice per heading in document order', () => {
    const md = '# One\n\nalpha\n\n# Two\n\nbeta\n';
    const slices = getBlockSlices(md);
    expect(slices.map((s) => s.text)).toEqual(['# One\n\nalpha\n\n', '# Two\n\nbeta\n']);
  });

  it('starts a new slice at every heading depth (children are not folded in)', () => {
    const md = '# Parent\n\nintro\n\n## Child\n\nbody\n';
    const slices = getBlockSlices(md);
    expect(slices).toHaveLength(2);
    expect(slices[0].text).toBe('# Parent\n\nintro\n\n');
    expect(slices[1].text).toBe('## Child\n\nbody\n');
  });

  it('includes leading content before the first heading as a preamble slice', () => {
    const md = 'preamble text\n\n# First\n\nbody\n';
    const slices = getBlockSlices(md);
    expect(slices).toHaveLength(2);
    expect(slices[0].text).toBe('preamble text\n\n');
    expect(slices[1].text).toBe('# First\n\nbody\n');
  });

  it('skips a whitespace-only preamble', () => {
    const md = '\n\n# Only\n\nbody\n';
    const slices = getBlockSlices(md);
    expect(slices).toHaveLength(1);
    expect(slices[0].text).toBe('# Only\n\nbody\n');
  });

  it('treats a heading-less document as a single slice', () => {
    const md = 'just a paragraph\n\nand another\n';
    const slices = getBlockSlices(md);
    expect(slices).toHaveLength(1);
    expect(slices[0].text).toBe(md);
  });

  it('treats an empty document as a single (empty) slice', () => {
    const slices = getBlockSlices('');
    expect(slices).toHaveLength(1);
    expect(slices[0].text).toBe('');
  });

  it('never folds frontmatter into a slice', () => {
    const md = '---\ntitle: Hi\n---\n# Heading\n\nbody\n';
    const slices = getBlockSlices(md);
    expect(slices).toHaveLength(1);
    expect(slices[0].text).toBe('# Heading\n\nbody\n');
    // The frontmatter stays in the untouched prefix.
    expect(md.slice(0, slices[0].range.startOffset)).toBe('---\ntitle: Hi\n---\n');
  });
});

describe('spliceBlock round-trips', () => {
  const cases = [
    '# One\n\nalpha\n\n# Two\n\nbeta\n',
    '# Parent\n\nintro\n\n## Child\n\nbody\n',
    'preamble text\n\n# First\n\nbody\n',
    '---\ntitle: Hi\n---\n# Heading\n\nbody\n',
    'no headings at all\n',
  ];

  it('re-splicing a slice with its own text reproduces the source exactly', () => {
    for (const md of cases) {
      const slices = getBlockSlices(md);
      for (const slice of slices) {
        expect(spliceBlock(md, slice.range, slice.text)).toBe(md);
      }
    }
  });

  it('splices an edited block back into the full document', () => {
    const md = '# One\n\nalpha\n\n# Two\n\nbeta\n';
    const slices = getBlockSlices(md);
    const edited = spliceBlock(md, slices[0].range, '# One\n\nalpha edited\n\n');
    expect(edited).toBe('# One\n\nalpha edited\n\n# Two\n\nbeta\n');
  });
});

describe('line/offset helpers', () => {
  const md = '# One\n\nalpha\n\n# Two\n';

  it('maps lines to offsets and back', () => {
    // Line 5 is the "# Two" heading.
    const offset = lineToOffset(md, 5);
    expect(md.slice(offset, offset + 5)).toBe('# Two');
    expect(offsetToLine(md, offset)).toBe(5);
  });

  it('finds the slice index containing an offset', () => {
    const slices = getBlockSlices(md);
    const secondHeadingOffset = lineToOffset(md, 5);
    expect(sliceIndexAtOffset(slices, secondHeadingOffset)).toBe(1);
    expect(sliceIndexAtOffset(slices, 0)).toBe(0);
  });
});
