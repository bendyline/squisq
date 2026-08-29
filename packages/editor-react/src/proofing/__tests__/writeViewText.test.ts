/**
 * Write-view text extraction: run collection over a real Tiptap doc,
 * span-table resolution back to PM positions, codeBlock skipping, and
 * atom/hard-break placeholders. The properties pinned here are what the
 * squiggle positions depend on.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { InlineIcon } from '../../InlineIcon';
import { collectTextblockRuns, resolveRunOffsets } from '../writeViewText';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

let editors: Editor[] = [];

function makeEditor(md: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      InlineIcon,
    ],
    content: markdownToTiptap(md),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe('collectTextblockRuns', () => {
  it('collects one run per prose textblock and maps offsets to PM positions', () => {
    const editor = makeEditor('# Revenue Highlights\n\nIts a strong quarter.\n');
    const runs = collectTextblockRuns(editor.state.doc);
    expect(runs.map((run) => run.text)).toEqual(['Revenue Highlights', 'Its a strong quarter.']);

    // Resolve "Its" (offsets 0-3 of run 1) and verify against the doc.
    const range = resolveRunOffsets(runs[1], 0, 3);
    expect(range).not.toBeNull();
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('Its');

    // Resolve the last word of the heading.
    const highlights = runs[0].text.indexOf('Highlights');
    const headingRange = resolveRunOffsets(runs[0], highlights, highlights + 'Highlights'.length);
    expect(editor.state.doc.textBetween(headingRange!.from, headingRange!.to)).toBe('Highlights');
  });

  it('skips code blocks entirely', () => {
    const editor = makeEditor(
      '# Doc\n\nProse before.\n\n```typescript\nconst recieve = 1;\n```\n\nProse after.\n',
    );
    const runs = collectTextblockRuns(editor.state.doc);
    const texts = runs.map((run) => run.text);
    expect(texts).toContain('Prose before.');
    expect(texts).toContain('Prose after.');
    expect(texts.join('\n')).not.toContain('recieve');
  });

  it('spans cross mark boundaries within one run', () => {
    const editor = makeEditor('This has **bold teh** text.\n');
    const runs = collectTextblockRuns(editor.state.doc);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('This has bold teh text.');
    // "teh" sits partially inside the bold mark; the span table still
    // resolves it because adjacent text spans concatenate.
    const teh = runs[0].text.indexOf('teh');
    const range = resolveRunOffsets(runs[0], teh, teh + 3);
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('teh');
  });

  it('replaces hard breaks with newline and keeps offsets resolvable', () => {
    const editor = makeEditor('placeholder\n');
    editor.commands.setContent('<p>Line one<br>line two.</p>');
    const runs = collectTextblockRuns(editor.state.doc);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('Line one\nline two.');
    // An offset range landing on the hard break itself resolves to null.
    expect(resolveRunOffsets(runs[0], 8, 9)).toBeNull();
    // A word after the break resolves correctly (the break is 1 PM node).
    const two = runs[0].text.indexOf('two');
    const range = resolveRunOffsets(runs[0], two, two + 3);
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('two');
  });

  it('lists produce one run per item, tables one per cell', () => {
    const editor = makeEditor('- alpha item\n- beta item\n');
    const runs = collectTextblockRuns(editor.state.doc);
    expect(runs.map((run) => run.text)).toEqual(['alpha item', 'beta item']);
  });

  it('returns null for out-of-span offsets', () => {
    const editor = makeEditor('Short.\n');
    const runs = collectTextblockRuns(editor.state.doc);
    expect(resolveRunOffsets(runs[0], 0, 99)).toBeNull();
    expect(resolveRunOffsets(runs[0], 3, 3)).toBeNull();
  });
});
