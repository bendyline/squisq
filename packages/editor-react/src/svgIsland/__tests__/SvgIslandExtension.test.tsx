/** @vitest-environment jsdom */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../../tiptapBridge';
import {
  SVG_ISLAND_KEY,
  SvgIslandExtension,
  findSvgIslandBlockPos,
  isSvgIslandSourceVisible,
  replaceSvgIslandText,
  toggleSvgIslandSource,
} from '../SvgIslandExtension';
import { CODE_SNIPPET_KEY, CodeSnippetExtension } from '../../codeSnippet/CodeSnippetExtension';
import { shouldPasteAsSvgFence } from '../svgPaste';
import { describeSvgIslandRemovals } from '../svgIslandRemovals';

vi.mock('../../codeSnippet/CodeSnippetWidget', () => ({ CodeSnippetWidget: () => null }));
// The side toolbar measures the editor gutter with ResizeObserver (not in jsdom).
vi.mock('../../scene/SceneSideToolbar', () => ({
  SceneSideToolbar: ({ children }: { children: unknown }) => children,
}));
vi.mock('../../codeSnippet/FenceMonacoEditor', () => ({
  FenceMonacoEditor: ({ source }: { source: string }) => <textarea readOnly value={source} />,
}));

const ICON = '<svg viewBox="0 0 24 12"><rect width="24" height="12" fill="currentColor"/></svg>';
const MARKDOWN = `# Logo\n\nIntro.\n\n\`\`\`svg\n${ICON}\n\`\`\`\n\n\`\`\`xml\n${ICON}\n\`\`\`\n`;

const editors: Editor[] = [];

function makeEditor(
  markdown: string,
  options: { hostSvg?: boolean; element?: HTMLElement } = {},
): Editor {
  const editor = new Editor({
    ...(options.element ? { element: options.element } : {}),
    extensions: [
      StarterKit,
      SvgIslandExtension.configure({
        renderers: () => (options.hostSvg ? { svg: () => null } : undefined),
      }),
      CodeSnippetExtension,
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function islandsOf(editor: Editor) {
  return SVG_ISLAND_KEY.getState(editor.state)?.entries ?? [];
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe('SvgIslandExtension', () => {
  it('claims svg fences and leaves xml fences to the code-snippet inset', () => {
    const editor = makeEditor(MARKDOWN);
    expect(islandsOf(editor)).toHaveLength(1);
    const snippets = CODE_SNIPPET_KEY.getState(editor.state)?.entries ?? [];
    expect(snippets).toHaveLength(1);
    const snippet = editor.state.doc.nodeAt(snippets[0]!.pos)!;
    expect(snippet.attrs.language).toBe('xml');
  });

  it('hides the fence and mounts the picture widget after it', () => {
    const editor = makeEditor(MARKDOWN);
    const { decorations } = SVG_ISLAND_KEY.getState(editor.state)!;
    const found = decorations.find();
    expect(
      found.some((deco) => (deco.spec as { key?: string }).key?.startsWith('squisq-svg-island-')),
    ).toBe(true);
  });

  it('yields to a host-registered svg fence renderer', () => {
    const editor = makeEditor(MARKDOWN, { hostSvg: true });
    expect(islandsOf(editor)).toHaveLength(0);
  });

  it('round-trips an untouched island byte-identically', () => {
    const editor = makeEditor(MARKDOWN);
    expect(tiptapToMarkdown(editor.getHTML())).toBe(MARKDOWN);
  });

  it('keeps a stable id as content moves, and edits the body in one step', () => {
    const editor = makeEditor(MARKDOWN);
    const [before] = islandsOf(editor);
    editor.commands.insertContentAt(0, '<p>Above</p>');
    const [after] = islandsOf(editor);
    expect(after!.id).toBe(before!.id);
    expect(findSvgIslandBlockPos(editor, before!.id)).toBe(after!.pos);

    const next = '<svg viewBox="0 0 2 1"><circle r="1"/></svg>';
    expect(replaceSvgIslandText(editor, before!.id, next)).toBe(true);
    expect(tiptapToMarkdown(editor.getHTML())).toContain(`\`\`\`svg\n${next}\n\`\`\``);
    // Clearing the body is allowed (no empty text node).
    expect(replaceSvgIslandText(editor, before!.id, '')).toBe(true);
    expect(tiptapToMarkdown(editor.getHTML())).toContain('```svg\n\n```');
  });

  it('keeps the Source toggle in plugin state, without touching the document', () => {
    const editor = makeEditor(MARKDOWN);
    const [island] = islandsOf(editor);
    const before = editor.getHTML();
    toggleSvgIslandSource(editor, island!.id);
    expect(isSvgIslandSourceVisible(editor, island!.id)).toBe(true);
    expect(editor.getHTML()).toBe(before);
    // Survives edits elsewhere; forgotten once the island is gone.
    editor.commands.insertContentAt(0, '<p>Above</p>');
    expect(isSvgIslandSourceVisible(editor, island!.id)).toBe(true);
    const pos = findSvgIslandBlockPos(editor, island!.id)!;
    const node = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
    expect(isSvgIslandSourceVisible(editor, island!.id)).toBe(false);
  });

  it('refuses edits while read-only', () => {
    const editor = makeEditor(MARKDOWN);
    editor.setEditable(false);
    const [island] = islandsOf(editor);
    expect(replaceSvgIslandText(editor, island!.id, '<svg/>')).toBe(false);
  });
});

describe('SvgIslandWidget in a live editor', () => {
  it('shows the island as a picture and opens its source on demand', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    try {
      makeEditor(MARKDOWN, { element });
      const img = await waitFor(() => {
        const found = element.querySelector<HTMLImageElement>('.squisq-svg-island-widget-host img');
        expect(found).not.toBeNull();
        return found!;
      });
      expect(img.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
      expect(element.querySelector('.squisq-svg-island-source')).toBeNull();
      const source = element.querySelector<HTMLButtonElement>('button[title="Edit SVG source"]')!;
      await act(async () => {
        fireEvent.click(source);
      });
      expect(element.querySelector('.squisq-svg-island-source textarea')?.textContent).toBe(ICON);
    } finally {
      element.remove();
    }
  });

  it('shows the source of a fence that is not an island', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    try {
      makeEditor('```svg\n<div>nope</div>\n```\n', { element });
      await waitFor(() => {
        expect(element.querySelector('.squisq-svg-island-source textarea')).not.toBeNull();
      });
      expect(element.querySelector('.squisq-md-svg-error-note')?.textContent).toContain(
        'Couldn’t render this SVG',
      );
    } finally {
      element.remove();
    }
  });
});

describe('shouldPasteAsSvgFence', () => {
  it.each([
    ICON,
    `\n  ${ICON}\n`,
    `<?xml version="1.0"?>\n<!-- made by hand -->\n${ICON}`,
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
  ])('accepts a lone SVG document: %j', (text) => {
    expect(shouldPasteAsSvgFence(text)).toBe(true);
  });

  it.each([
    'Some prose about <svg> elements.',
    `${ICON}\nand a sentence after it`,
    `<div>${ICON}</div>`,
    '<svg><p>breaks out</p></svg>',
    '```svg\n<svg/>\n```',
  ])('rejects anything else: %j', (text) => {
    expect(shouldPasteAsSvgFence(text)).toBe(false);
  });
});

describe('describeSvgIslandRemovals', () => {
  it('names what the sanitizer removed', () => {
    const { container } = render(
      <p>
        {describeSvgIslandRemovals([
          { kind: 'element', name: 'script', count: 1 },
          { kind: 'attribute', name: 'onload', count: 2 },
          { kind: 'style', name: 'style rule', count: 1 },
        ])}
      </p>,
    );
    expect(container.textContent).toBe('<script>, 2× onload attribute, style rule');
  });
});
