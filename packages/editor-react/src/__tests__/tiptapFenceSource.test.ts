import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { HeadingWithTemplate } from '../TemplateAnnotation';
import { CodeFenceSource } from '../tiptap/codeFenceSource';

/**
 * Code fences and linked images whose source the Write view used to rewrite
 * on every save: `~~~` fences became escaped paragraphs, info strings were
 * cut to the language, a code line of ```` ``` ```` closed its own fence
 * early, and `[![badge](src)](url)` lost its link.
 */

const bridge = (md: string): string => tiptapToMarkdown(markdownToTiptap(md));

/** Through a real editor with the production code-block configuration. */
function throughEditor(md: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      CodeFenceSource,
    ],
    content: markdownToTiptap(md),
  });
  const html = editor.getHTML();
  editor.destroy();
  return tiptapToMarkdown(html);
}

const FENCES: Record<string, string> = {
  tilde: '~~~bash\nnpm install --save my-package\n~~~\n',
  longTilde: '~~~~\ncode\n~~~~\n',
  infoString: '```js title="x.js"\nconst a = 1;\n```\n',
  tildeInfoString: '~~~python {.numberLines startFrom="10"}\nprint("hi")\n~~~\n',
  // Markdown that shows a fence needs a longer outer fence.
  nested: '````markdown\n```js\nlet x;\n```\n````\n',
  // A tilde fence may contain backtick runs; its closer is still ~~~.
  backticksInTilde: '~~~\n```\nnot a closer\n~~~\n',
};

describe('code fences keep the opener their author wrote', () => {
  for (const [name, md] of Object.entries(FENCES)) {
    it(`round-trips the ${name} fence through the bridge`, () => {
      expect(bridge(md)).toBe(md);
    });
    it(`round-trips the ${name} fence through a real editor`, () => {
      expect(throughEditor(md)).toBe(md);
    });
    it(`agrees with core's parser about the ${name} fence's code`, () => {
      const core = parseMarkdown(md).children[0] as { type: string; value?: string };
      expect(core.type).toBe('code');
      const html = markdownToTiptap(md);
      expect(html.startsWith('<pre')).toBe(true);
      expect(throughEditor(md)).toContain(core.value!);
    });
  }

  it('reads an indented top-level fence and strips its indent from the code', () => {
    expect(bridge('  ```js\n  const a = 1;\n    nested\n  ```\n')).toBe(
      '```js\nconst a = 1;\n  nested\n```\n',
    );
  });

  it('does not close a backtick fence on a line with an info string', () => {
    expect(bridge('```\n```js\n```\n')).toBe('````\n```js\n````\n');
  });

  it('lengthens the fence when the code contains its marker', () => {
    // Older documents opened by the editor with a plain ``` fence.
    const html = '<pre><code>```\ninner\n```</code></pre>';
    expect(tiptapToMarkdown(html)).toBe('````\n```\ninner\n```\n````\n');
  });

  it('uses tildes when the info string contains a backtick', () => {
    const html = '<pre data-squisq-fence-meta="a`b"><code class="language-txt">x</code></pre>';
    expect(tiptapToMarkdown(html)).toBe('~~~txt a`b\nx\n~~~\n');
  });

  it('keeps code with blank lines and HTML-significant characters intact', () => {
    const md = '~~~html\n<div class="a">&amp;</div>\n\n<p>two</p>\n~~~\n';
    expect(throughEditor(md)).toBe(md);
  });
});

describe('linked images keep their link', () => {
  it('round-trips a standalone badge through the bridge', () => {
    const md =
      '[![Build](https://img.shields.io/badge/build-passing-green.svg)](https://example.com/ci)\n';
    expect(bridge(md)).toBe(md);
    expect(markdownToTiptap(md)).toContain('data-squisq-image-href="https://example.com/ci"');
  });

  it('writes a sized linked image as a link around the raw tag', () => {
    const html =
      '<img alt="Logo" src="logo.png" width="80" data-squisq-image-href="https://x.dev">';
    expect(tiptapToMarkdown(html)).toBe(
      '[<img alt="Logo" src="logo.png" width="80">](https://x.dev)\n',
    );
  });
});
