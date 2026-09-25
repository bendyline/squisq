import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { afterEach, describe, expect, it } from 'vitest';
import { isAllowedLinkHref } from '../tiptap/linkHrefPolicy';
import { LinkWithTitle } from '../WysiwygEditor';

/**
 * Tiptap's own link check refuses relative hrefs such as `media/brief.pdf`
 * (a character-class range bug), dropping the link when a document loads.
 * The Write view accepts what Tiptap accepts plus what squisq's `sanitizeUrl`
 * accepts — and still refuses anything executable.
 */

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const tiptapDefault = (url: string) => /^https?:/i.test(url);

describe('isAllowedLinkHref', () => {
  it('accepts relative paths and ordinary web links', () => {
    for (const href of ['media/brief.pdf', 'attachments/a.zip', 'a.zip', '#intro', '../up.md']) {
      expect(
        isAllowedLinkHref(href, () => false),
        href,
      ).toBe(true);
    }
    expect(isAllowedLinkHref('https://example.com', tiptapDefault)).toBe(true);
    expect(isAllowedLinkHref('mailto:someone@example.com', () => false)).toBe(true);
  });

  it('refuses executable schemes, even when a host lists them', () => {
    for (const href of ['javascript:alert(1)', 'vbscript:x', 'data:text/html,<b>x</b>']) {
      expect(
        isAllowedLinkHref(href, () => false, ['javascript', 'vbscript', 'data']),
        href,
      ).toBe(false);
    }
  });

  it("accepts a host's own link scheme only when the host lists it", () => {
    expect(isAllowedLinkHref('workspace-nav:doc/1', () => false)).toBe(false);
    expect(isAllowedLinkHref('workspace-nav:doc/1', () => false, ['workspace-nav'])).toBe(true);
  });
});

describe('LinkWithTitle', () => {
  const content =
    '<p><a href="media/brief.pdf">brief</a> and <a href="javascript:alert(1)">bad</a></p>';

  it('keeps a relative link that the stock Link extension drops', () => {
    const stock = new Editor({ extensions: [StarterKit, Link], content });
    editors.push(stock);
    // The upstream behavior this works around — if Tiptap fixes its check,
    // this assertion fails and the override in LinkWithTitle can go.
    expect(stock.getHTML()).not.toContain('media/brief.pdf');

    const ours = new Editor({ extensions: [StarterKit, LinkWithTitle], content });
    editors.push(ours);
    expect(ours.getHTML()).toContain('href="media/brief.pdf"');
    expect(ours.getHTML()).not.toContain('javascript:');
  });

  it("keeps a host scheme's link when configured with it", () => {
    const html = '<p><a href="workspace-nav:doc/1">doc</a></p>';
    const editor = new Editor({
      extensions: [
        StarterKit,
        LinkWithTitle.configure({
          isAllowedUri: (url, ctx) =>
            isAllowedLinkHref(url, ctx.defaultValidate, ['workspace-nav']),
        }),
      ],
      content: html,
    });
    editors.push(editor);
    expect(editor.getHTML()).toContain('href="workspace-nav:doc/1"');
  });
});
