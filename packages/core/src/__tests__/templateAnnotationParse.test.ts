import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { stringifyMarkdown } from '../markdown/stringify.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';

function getHeading(md: string) {
  const doc = parseMarkdown(md);
  const heading = doc.children[0];
  if (heading.type !== 'heading') throw new Error('expected heading');
  return heading;
}

describe('Template annotation in Heading parse path', () => {
  it('extracts and round-trips an empty annotation without leaving literal heading text', () => {
    const source = '## Getting Started {[]}';
    const heading = getHeading(source);

    expect(heading.templateAnnotation).toEqual({});
    expect(heading.children).toHaveLength(1);
    expect(heading.children[0]).toMatchObject({ type: 'text', value: 'Getting Started' });
    expect(stringifyMarkdown(parseMarkdown(source)).trim()).toBe(source);
  });

  it('parseMarkdown extracts {[template]} from a heading', () => {
    const md = '## Getting Started {[comparisonBar]}';
    const doc = parseMarkdown(md);
    const heading = doc.children[0];
    expect(heading.type).toBe('heading');
    if (heading.type !== 'heading') return;
    expect(heading.templateAnnotation).toEqual({ template: 'comparisonBar' });
  });

  it('markdownToDoc preserves templateAnnotation on the resulting block', () => {
    const md = '# Title\n\n## Getting Started {[comparisonBar]}\n\nBody.';
    const parsed = parseMarkdown(md);
    const doc = markdownToDoc(parsed, { articleId: 'test' });
    // The h1 is the root; first child is the h2 with annotation
    const h1 = doc.blocks[0];
    expect(h1.sourceHeading?.depth).toBe(1);
    const h2 = h1.children?.[0];
    expect(h2?.sourceHeading?.depth).toBe(2);
    expect(h2?.sourceHeading?.templateAnnotation).toEqual({ template: 'comparisonBar' });
  });

  it('tolerates accidentally-doubled trailing `]}` (user typo)', () => {
    const md = '## Getting Started {[comparisonBar]}]}';
    const doc = parseMarkdown(md);
    const heading = doc.children[0];
    if (heading.type !== 'heading') throw new Error('expected heading');
    expect(heading.templateAnnotation).toEqual({ template: 'comparisonBar' });
  });

  it('still rejects non-trailing annotations (regex stays anchored)', () => {
    const md = '## The {[chart]} section'; // word continues after — not an annotation
    const doc = parseMarkdown(md);
    const heading = doc.children[0];
    if (heading.type !== 'heading') throw new Error('expected heading');
    expect(heading.templateAnnotation).toBeUndefined();
  });

  it('keeps annotation-shaped text inside a code fence as literal code', () => {
    const source = '```markdown\n## Example {[comparisonBar]}\n{[ ]}\n```';
    const parsed = parseMarkdown(source);

    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0]).toMatchObject({
      type: 'code',
      lang: 'markdown',
      value: '## Example {[comparisonBar]}\n{[ ]}',
    });
    expect(stringifyMarkdown(parsed).trim()).toBe(source);
  });
});

describe('Quoted values in {[…]} annotations', () => {
  it('parses double-quoted values with spaces (the documented syntax)', () => {
    const h = getHeading(
      '## Gallery {[imageWithCaption src="photo.jpg" caption="Beach at sunset"]}',
    );
    expect(h.templateAnnotation).toEqual({
      template: 'imageWithCaption',
      params: { src: 'photo.jpg', caption: 'Beach at sunset' },
    });
  });

  it('parses single-quoted values with spaces', () => {
    const h = getHeading("## X {[quote text='A long caption']}");
    expect(h.templateAnnotation?.params).toEqual({ text: 'A long caption' });
  });

  it('parses a quoted value containing ]', () => {
    const h = getHeading('## X {[quote text="a ] b"]}');
    expect(h.templateAnnotation?.params).toEqual({ text: 'a ] b' });
  });

  it('parses a quoted value containing commas without splitting', () => {
    const h = getHeading('## X {[quote text="hello, friend"]}');
    expect(h.templateAnnotation?.params).toEqual({ text: 'hello, friend' });
  });

  it('treats an apostrophe inside an unquoted value as literal', () => {
    const h = getHeading("## X {[quote attribution=O'Brien align=left]}");
    expect(h.templateAnnotation?.params).toEqual({ attribution: "O'Brien", align: 'left' });
  });

  it('parses a double quote inside a single-quoted value', () => {
    const h = getHeading('## X {[quote text=\'She said "hi"\']}');
    expect(h.templateAnnotation?.params).toEqual({ text: 'She said "hi"' });
  });

  it('parses backslash-escaped emphasis characters inside quoted values', () => {
    // Bare * would be parsed as markdown emphasis and fragment the heading
    // text run; the documented escape hatch is to backslash it. remark
    // resolves the escape before annotation extraction.
    const h = getHeading('## X {[quote text="a \\*b\\* c"]}');
    expect(h.templateAnnotation?.params).toEqual({ text: 'a *b* c' });
  });

  it('parses a template-less key=value annotation with a quoted value', () => {
    const h = getHeading('## X {[audio="intro track.mp3"]}');
    expect(h.templateAnnotation).toEqual({ params: { audio: 'intro track.mp3' } });
  });
});

describe('Round-trip of quoted template params', () => {
  function roundTrip(src: string): string {
    return stringifyMarkdown(parseMarkdown(src)).trim();
  }

  it('spacey double-quoted values round-trip verbatim', () => {
    const src = '## Gallery {[imageWithCaption src=photo.jpg caption="Beach at sunset"]}';
    expect(roundTrip(src)).toBe(src);
  });

  it('single quotes canonicalize to double quotes', () => {
    expect(roundTrip("## X {[quote text='A long caption']}")).toBe(
      '## X {[quote text="A long caption"]}',
    );
  });

  it('a value containing a double quote round-trips via single quotes', () => {
    const src = '## X {[quote text=\'She said "hi"\']}';
    expect(roundTrip(src)).toBe(src);
  });

  it('a quoted ] round-trips', () => {
    const src = '## X {[quote text="a ] b"]}';
    expect(roundTrip(src)).toBe(src);
  });

  it('emphasis characters survive a full stringify → parse cycle', () => {
    // The emitted source keeps \* escaped (so the heading text run stays
    // intact); reparsing resolves the escape back to the bare character.
    const src = '## X {[quote text="a \\*b\\* c"]}';
    const emitted = roundTrip(src);
    expect(emitted).toBe(src);
    const h = getHeading(emitted);
    expect(h.templateAnnotation?.params).toEqual({ text: 'a *b* c' });
  });

  it('stringify quotes spacey values produced programmatically', () => {
    const doc = parseMarkdown('## X {[quote]}');
    const heading = doc.children[0];
    if (heading.type !== 'heading') throw new Error('expected heading');
    heading.templateAnnotation = {
      template: 'quote',
      params: { text: 'Beach at sunset', attribution: 'someone' },
    };
    expect(stringifyMarkdown(doc).trim()).toBe(
      '## X {[quote text="Beach at sunset" attribution=someone]}',
    );
  });
});
