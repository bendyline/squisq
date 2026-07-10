import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { HeadingWithTemplate } from '../TemplateAnnotation';

/**
 * Code-fence round-trip through a REAL tiptap editor.
 *
 * The string-level bridge tests feed hand-written `<pre><code>` HTML, but
 * the production editor configures StarterKit's codeBlock with
 * `HTMLAttributes: { class: 'squisq-code-block' }`, which tiptap renders
 * onto the <pre>. The serializer regex used to require a bare `<pre><code`
 * and silently dropped every fence on save. These tests exercise the real
 * `getHTML()` output so that shape can never regress unnoticed.
 */

function roundTripThroughEditor(md: string): string {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    ],
    content: markdownToTiptap(md),
  });
  const html = editor.getHTML();
  editor.destroy();
  return tiptapToMarkdown(html);
}

describe('code fences through a real editor (getHTML → markdown)', () => {
  it('emits class="squisq-code-block" on <pre> (the shape the serializer must accept)', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
        }),
        HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      ],
      content: markdownToTiptap('```js\nconst x = 1;\n```\n'),
    });
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain('<pre class="squisq-code-block">');
  });

  it('round-trips a fence with a language byte-for-byte', () => {
    const md = '```js\nconst x = 1;\n```\n';
    expect(roundTripThroughEditor(md)).toBe(md);
  });

  it('round-trips a fence without a language byte-for-byte', () => {
    const md = '```\nplain text content\n```\n';
    expect(roundTripThroughEditor(md)).toBe(md);
  });

  it('round-trips a fence surrounded by prose', () => {
    const md = 'Before the code.\n\n```python\nprint("hi")\n```\n\nAfter the code.\n';
    expect(roundTripThroughEditor(md)).toBe(md);
  });

  it('round-trips HTML-significant characters inside a fence', () => {
    const md = '```\nif (a < b && c > d) { echo "&nbsp;"; }\n```\n';
    expect(roundTripThroughEditor(md)).toBe(md);
  });

  it('round-trips trailing spaces inside fence lines', () => {
    const md = '```\nline with trailing   \nspaces\n```\n';
    expect(roundTripThroughEditor(md)).toBe(md);
  });

  it('round-trips a blank last line inside a fence', () => {
    const md = '```\nfoo\n\n```\n';
    expect(roundTripThroughEditor(md)).toBe(md);
  });

  it('round-trips Unicode box-drawing art byte-for-byte', () => {
    const md = [
      '```',
      '┌────────┐    ┌────────┐',
      '│  CLI   │    │  MCP   │',
      '└───┬────┘    └───┬────┘',
      '    │             │',
      '    ▼             ▼',
      '┌──────────────────────┐',
      '│        kernel        │',
      '└──────────────────────┘',
      '```',
      '',
    ].join('\n');
    expect(roundTripThroughEditor(md)).toBe(md);
  });

  it('round-trips +--+ ASCII art byte-for-byte', () => {
    const md = [
      '```text',
      '+--------+     +--------+',
      '| Input  | --> | Output |',
      '+--------+     +--------+',
      '```',
      '',
    ].join('\n');
    expect(roundTripThroughEditor(md)).toBe(md);
  });
});
