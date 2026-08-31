import { describe, expect, it } from 'vitest';
import { FRONTMATTER_RE, frontmatterEndOffset, stripFrontmatter } from '../frontmatter';
import { markdownToTiptap } from '../tiptapBridge';

// The shape every canonical markdown serializer emits: a blank line between
// the closing fence and the first body block.
const DOC = [
  '---',
  'title: About this library',
  'description: What the shared document library is.',
  '---',
  '',
  '# About this library',
  '',
  'This is the shared document library.',
  '',
].join('\n');

describe('stripFrontmatter', () => {
  it('leaves a document without frontmatter alone', () => {
    expect(stripFrontmatter('# Title\n\nBody\n')).toEqual({
      body: '# Title\n\nBody\n',
      frontmatter: '',
    });
    expect(frontmatterEndOffset('# Title\n')).toBe(0);
  });

  it('absorbs the blank line separating frontmatter from the body', () => {
    const { body, frontmatter } = stripFrontmatter(DOC);
    expect(frontmatter.endsWith('---\n\n')).toBe(true);
    expect(body.startsWith('# About this library')).toBe(true);
  });

  it('absorbs several blank separator lines', () => {
    const { body } = stripFrontmatter('---\na: 1\n---\n\n \n\n# Title\n');
    expect(body).toBe('# Title\n');
  });

  it('handles a body that starts immediately after the closing fence', () => {
    const { body, frontmatter } = stripFrontmatter('---\na: 1\n---\n# Title\n');
    expect(frontmatter).toBe('---\na: 1\n---\n');
    expect(body).toBe('# Title\n');
  });

  it('handles CRLF sources', () => {
    const { body, frontmatter } = stripFrontmatter('---\r\na: 1\r\n---\r\n\r\n# Title\r\n');
    expect(frontmatter).toBe('---\r\na: 1\r\n---\r\n\r\n');
    expect(body).toBe('# Title\r\n');
  });

  it('is lossless: frontmatter + body reconstructs the source', () => {
    for (const src of [
      DOC,
      '---\na: 1\n---\n# Title\n',
      '---\na: 1\n---\n\n\n# Title\n',
      '---\na: 1\n---\n',
      '# No frontmatter\n',
    ]) {
      const { body, frontmatter } = stripFrontmatter(src);
      expect(frontmatter + body).toBe(src);
      expect(frontmatterEndOffset(src)).toBe(frontmatter.length);
    }
  });

  it('does not claim a mid-document fence as frontmatter', () => {
    expect(FRONTMATTER_RE.test('# Title\n\n---\n\nafter\n')).toBe(false);
  });

  /**
   * The regression this boundary exists for: a body that began with the
   * separator blank line became a real empty paragraph at the top of the
   * WYSIWYG surface, and deleting it never stuck — the write dropped the
   * blank line and the next canonical serialization put it straight back.
   */
  it('yields a body whose editor content has no leading empty paragraph', () => {
    const html = markdownToTiptap(stripFrontmatter(DOC).body);
    expect(html.startsWith('<h1>')).toBe(true);
  });
});
