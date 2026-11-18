import { describe, expect, it } from 'vitest';
import { Editor, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { MarkdownEscape } from '../MarkdownEscape';
import { LinkWithTitle } from '../WysiwygEditor';
import { buildSceneTextExtensions } from '../scene/text/sceneTiptap';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

const WRITE_VIEW: Extensions = [StarterKit, MarkdownEscape, LinkWithTitle];

function throughEditor(md: string, extensions: Extensions = WRITE_VIEW): string {
  const editor = new Editor({ extensions, content: markdownToTiptap(md) });
  const out = tiptapToMarkdown(editor.getHTML());
  editor.destroy();
  return out;
}

function linksIn(md: string): Array<{ href: string | null; text: string }> {
  const editor = new Editor({ extensions: WRITE_VIEW, content: markdownToTiptap(md) });
  const links = [...editor.view.dom.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href'),
    text: a.textContent ?? '',
  }));
  editor.destroy();
  return links;
}

describe('autolinks in the Write view', () => {
  it('shows angle-bracket and bare addresses as links', () => {
    expect(
      linksIn('Check <https://x.test/a?b=1&c=@d>, mail <me@x.test>, see https://y.test/p.'),
    ).toEqual([
      { href: 'https://x.test/a?b=1&c=@d', text: 'https://x.test/a?b=1&c=@d' },
      { href: 'mailto:me@x.test', text: 'me@x.test' },
      { href: 'https://y.test/p', text: 'https://y.test/p' },
    ]);
    expect(linksIn('Visit www.x.test today')).toEqual([
      { href: 'http://www.x.test', text: 'www.x.test' },
    ]);
  });

  it.each([
    'Check activity <https://accounts.google.com/AccountChooser?Email=a@b.test&continue=https://x.test/a?b%3D1>',
    'Mail <me@x.test> or [t](https://x.test "T")',
    'See https://x.test/a_b_c/ and www.x.test ok.',
    '(https://x.test/a_(b)) and https://x.test/c), x=https://no.test, *https://em.test*',
    '\\<https://not.test> and `https://code.test` and [label https://in.test](https://out.test)',
    'path https://x.test/\\_next/ end',
    '[https://x.test](https://x.test)',
  ])('writes %j back exactly as it was', (md) => {
    expect(throughEditor(md)).toBe(`${md}\n`);
  });

  it('keeps the form in the canvas text editor too', () => {
    const md = 'Label <https://x.test/a> and https://y.test';
    expect(throughEditor(md, buildSceneTextExtensions('inline'))).toBe(`${md}\n`);
  });

  it('does not link other schemes, or a label inside a link', () => {
    expect(linksIn('<ftp://x.test/a> <javascript:alert(1)>')).toEqual([]);
    expect(linksIn('[see https://in.test](https://out.test)')).toEqual([
      { href: 'https://out.test', text: 'see https://in.test' },
    ]);
  });

  it('becomes an ordinary link once its text no longer matches the address', () => {
    const editor = new Editor({
      extensions: WRITE_VIEW,
      content: markdownToTiptap('<https://x.test/a>'),
    });
    editor.commands.selectAll();
    editor.commands.insertContent({
      type: 'text',
      text: 'Docs',
      marks: [{ type: 'link', attrs: { href: 'https://x.test/a', autolink: 'angle' } }],
    });
    expect(tiptapToMarkdown(editor.getHTML())).toBe('[Docs](https://x.test/a)\n');
    editor.destroy();
  });
});
