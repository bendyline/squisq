import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  keepBlockMetaParamString,
  readHeadingLineTemplate,
  setHeadingLineTemplate,
  setSourceHeadingTemplate,
} from '../headingTemplateLine';

describe('readHeadingLineTemplate', () => {
  it('reads the template a heading names, and none as an empty string', () => {
    expect(readHeadingLineTemplate('## Revenue {[statHighlight]}')).toBe('statHighlight');
    expect(readHeadingLineTemplate('## Revenue')).toBe('');
    expect(readHeadingLineTemplate('## Revenue {[transition=fade]}')).toBe('');
  });

  it('finds the annotation on either side of a Pandoc attribute block', () => {
    expect(readHeadingLineTemplate('## Revenue {#rev .wide} {[quote]}')).toBe('quote');
    expect(readHeadingLineTemplate('## Revenue {[quote]} {#rev .wide}')).toBe('quote');
  });

  it('returns null for a line that is not a heading', () => {
    expect(readHeadingLineTemplate('Revenue grew {[quote]}')).toBeNull();
    expect(readHeadingLineTemplate('#NoSpace')).toBeNull();
    expect(readHeadingLineTemplate('')).toBeNull();
  });
});

describe('setHeadingLineTemplate', () => {
  it('adds, replaces and removes the block type', () => {
    expect(setHeadingLineTemplate('## Revenue', 'statHighlight')).toBe(
      '## Revenue {[statHighlight]}',
    );
    expect(setHeadingLineTemplate('## Revenue {[statHighlight]}', 'quote')).toBe(
      '## Revenue {[quote]}',
    );
    expect(setHeadingLineTemplate('## Revenue {[statHighlight]}', '')).toBe('## Revenue');
  });

  it('keeps block-level params and drops the previous template’s own', () => {
    expect(
      setHeadingLineTemplate(
        '## Revenue {[statHighlight colorScheme=blue transition=fade duration=4]}',
        'quote',
      ),
    ).toBe('## Revenue {[quote transition=fade duration=4]}');
    // Removing the type leaves the block-level params as a name-less annotation.
    expect(setHeadingLineTemplate('## Revenue {[statHighlight transition=fade]}', '')).toBe(
      '## Revenue {[transition=fade]}',
    );
  });

  it('keeps the Pandoc block, and writes one annotation whichever came first', () => {
    expect(setHeadingLineTemplate('## Revenue {#rev .wide} {[list]}', 'quote')).toBe(
      '## Revenue {#rev .wide} {[quote]}',
    );
    // The annotation ahead of the Pandoc block is not trailing text: replacing
    // the type must not leave the old one behind as a second annotation.
    expect(setHeadingLineTemplate('## Revenue {[list]} {#rev .wide}', 'quote')).toBe(
      '## Revenue {#rev .wide} {[quote]}',
    );
    expect(setHeadingLineTemplate('## Revenue {#rev}', 'quote')).toBe(
      '## Revenue {#rev} {[quote]}',
    );
  });

  it('keeps the heading prefix and leaves other lines alone', () => {
    expect(setHeadingLineTemplate('  ###   Deep dive', 'list')).toBe('  ###   Deep dive {[list]}');
    expect(setHeadingLineTemplate('Just a paragraph', 'list')).toBe('Just a paragraph');
  });

  it('writes a line the parser reads back as that template', () => {
    for (const line of [
      '## Revenue',
      '## Revenue {[statHighlight colorScheme=blue]}',
      '## Revenue {[list]} {#rev .wide}',
    ]) {
      const next = setHeadingLineTemplate(line, 'quote');
      const doc = markdownToDoc(parseMarkdown(`${next}\n\nBody.\n`));
      expect(doc.blocks[0].template).toBe('quote');
      expect(doc.blocks[0].title).toBe('Revenue');
    }
  });
});

describe('setSourceHeadingTemplate', () => {
  const source = ['---', 'title: Deck', '---', '', '# Intro', '', 'Hello.', '', '## Numbers'].join(
    '\n',
  );

  it('rewrites only the heading on the given line', () => {
    expect(setSourceHeadingTemplate(source, 9, 'statHighlight')).toBe(
      `${source} {[statHighlight]}`,
    );
    expect(setSourceHeadingTemplate(source, 5, 'title')).toBe(
      source.replace('# Intro', '# Intro {[title]}'),
    );
  });

  it('preserves the document’s line endings', () => {
    const crlf = source.replace(/\n/g, '\r\n');
    const next = setSourceHeadingTemplate(crlf, 5, 'title');
    expect(next).toBe(crlf.replace('# Intro', '# Intro {[title]}'));
    expect(next).not.toMatch(/[^\r]\n/);
  });

  it('refuses a line that is not a heading it can write to', () => {
    expect(setSourceHeadingTemplate(source, 7, 'quote')).toBeNull(); // prose
    expect(setSourceHeadingTemplate(source, 2, 'quote')).toBeNull(); // frontmatter
    expect(setSourceHeadingTemplate(source, 40, 'quote')).toBeNull(); // past the end
    expect(setSourceHeadingTemplate(source, 0, 'quote')).toBeNull();
    const fenced = ['```md', '# Not a heading', '```'].join('\n');
    expect(setSourceHeadingTemplate(fenced, 2, 'quote')).toBeNull();
  });
});

describe('keepBlockMetaParamString', () => {
  it('keeps only the params that configure the block', () => {
    expect(keepBlockMetaParamString('colorScheme=blue transition=fade')).toBe('transition=fade');
    expect(keepBlockMetaParamString('colorScheme=blue')).toBeNull();
    expect(keepBlockMetaParamString(null)).toBeNull();
  });
});
