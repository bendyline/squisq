import { describe, expect, it } from 'vitest';
import { moveHeadingSectionInSource } from '../outlineSource';

function lineOf(source: string, heading: string): number {
  const index = source.indexOf(heading);
  if (index < 0) throw new Error(`Missing heading: ${heading}`);
  return source.slice(0, index).split(/\r\n|\r|\n/).length;
}

describe('moveHeadingSectionInSource', () => {
  it('moves a parent section with its body and nested subsections', () => {
    const source = [
      '# Document',
      '',
      'Intro.',
      '',
      '## First',
      '',
      'First body.',
      '',
      '### First child',
      '',
      'Child body.',
      '',
      '## Second',
      '',
      'Second body.',
      '',
      '### Second child',
      '',
      'Second child body.',
      '',
      '## Third',
      '',
      'Third body.',
      '',
    ].join('\n');

    const next = moveHeadingSectionInSource(
      source,
      lineOf(source, '## First'),
      lineOf(source, '## Second'),
      'after',
    );

    expect(next).toBe(
      [
        '# Document',
        '',
        'Intro.',
        '',
        '## Second',
        '',
        'Second body.',
        '',
        '### Second child',
        '',
        'Second child body.',
        '',
        '## First',
        '',
        'First body.',
        '',
        '### First child',
        '',
        'Child body.',
        '',
        '## Third',
        '',
        'Third body.',
        '',
      ].join('\n'),
    );
  });

  it('moves a later section before an earlier sibling', () => {
    const source = '# A\n\na\n\n# B\n\nb\n\n# C\n\nc\n';
    expect(
      moveHeadingSectionInSource(source, lineOf(source, '# C'), lineOf(source, '# A'), 'before'),
    ).toBe('# C\n\nc\n\n# A\n\na\n\n# B\n\nb\n');
  });

  it('preserves CRLF and the absence of a final newline', () => {
    const source = '# A\r\n\r\na\r\n\r\n# B\r\n\r\nb';
    expect(
      moveHeadingSectionInSource(source, lineOf(source, '# B'), lineOf(source, '# A'), 'before'),
    ).toBe('# B\r\n\r\nb\r\n\r\n# A\r\n\r\na');
  });

  it('leaves frontmatter and preamble bytes in place', () => {
    const source = [
      '---',
      'title: Example',
      '---',
      '',
      'Preamble stays here.',
      '',
      '# A {[sectionHeader]}',
      '',
      'a',
      '',
      '# B {#custom .wide}',
      '',
      'b',
      '',
    ].join('\n');
    const prefix = source.slice(0, source.indexOf('# A'));

    const next = moveHeadingSectionInSource(
      source,
      lineOf(source, '# B'),
      lineOf(source, '# A'),
      'before',
    );

    expect(next?.startsWith(prefix)).toBe(true);
    expect(next).toContain('# B {#custom .wide}\n\nb\n\n# A {[sectionHeader]}\n\na\n');
  });

  it('ignores heading lookalikes inside fenced code', () => {
    const source = ['# A', '', '```md', '# not an outline heading', '```', '', '# B', '', 'b'].join(
      '\n',
    );

    const next = moveHeadingSectionInSource(
      source,
      lineOf(source, '# A'),
      lineOf(source, '# B'),
      'after',
    );

    expect(next).toBe(
      ['# B', '', 'b', '', '# A', '', '```md', '# not an outline heading', '```'].join('\n'),
    );
    expect(
      moveHeadingSectionInSource(
        source,
        lineOf(source, '# not an outline heading'),
        lineOf(source, '# B'),
        'before',
      ),
    ).toBeNull();
  });

  it('supports duplicate heading text and Setext headings by source line', () => {
    const source = [
      'Document',
      '========',
      '',
      'First duplicate',
      '---------------',
      '',
      'one',
      '',
      'First duplicate',
      '---------------',
      '',
      'two',
    ].join('\n');
    const firstLine = lineOf(source, 'First duplicate');
    const secondLine = source
      .slice(0, source.lastIndexOf('First duplicate'))
      .split(/\r\n|\r|\n/).length;

    const next = moveHeadingSectionInSource(source, secondLine, firstLine, 'before');

    expect(next).toBe(
      [
        'Document',
        '========',
        '',
        'First duplicate',
        '---------------',
        '',
        'two',
        '',
        'First duplicate',
        '---------------',
        '',
        'one',
      ].join('\n'),
    );
  });

  it('rejects hierarchy changes, stale lines, self-drops, and adjacent no-ops', () => {
    const source = [
      '# Parent A',
      '',
      '## Child A',
      '',
      '### Detail',
      '',
      '# Parent B',
      '',
      '## Child B',
      '',
      '### Skipped sibling',
      '',
      '## Last child',
    ].join('\n');
    const parentA = lineOf(source, '# Parent A');
    const parentB = lineOf(source, '# Parent B');
    const childA = lineOf(source, '## Child A');
    const childB = lineOf(source, '## Child B');
    const detail = lineOf(source, '### Detail');
    const skipped = lineOf(source, '### Skipped sibling');
    const lastChild = lineOf(source, '## Last child');

    expect(moveHeadingSectionInSource(source, parentA, parentA, 'before')).toBeNull();
    expect(moveHeadingSectionInSource(source, childA, detail, 'before')).toBeNull();
    expect(moveHeadingSectionInSource(source, childA, childB, 'before')).toBeNull();
    expect(moveHeadingSectionInSource(source, skipped, lastChild, 'before')).toBeNull();
    expect(moveHeadingSectionInSource(source, parentA, parentB, 'before')).toBeNull();
    expect(moveHeadingSectionInSource(source, parentB, parentA, 'after')).toBeNull();
    expect(moveHeadingSectionInSource(source, 999, parentA, 'before')).toBeNull();
  });
});
