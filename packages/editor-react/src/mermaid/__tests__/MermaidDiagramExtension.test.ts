import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../../tiptapBridge';
import { replaceAsciiFenceText } from '../../asciiDiagram/asciiDiagramCommands';
import {
  MERMAID_DIAGRAM_KEY,
  MermaidDiagramExtension,
  findMermaidDiagramBlockPos,
  isMermaidSourceVisible,
  toggleMermaidSource,
} from '../MermaidDiagramExtension';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 100 100"></svg>`,
      diagramType: 'flowchart-v2',
    })),
  },
}));

const SAMPLE = [
  'flowchart LR',
  '  client["MCP client"] <--> transport["Local stdio transport"]',
  '  transport <--> sdk["MCP SDK server"]',
  '',
  '  subgraph docblocks["DocBlocks MCP process"]',
  '    sdk --> tools["19 strict tools"]',
  '    tools --> guard["Guarded expensive operations"]',
  '  end',
].join('\n');

const editors: Editor[] = [];

beforeAll(() => {
  if (typeof globalThis.ResizeObserver !== 'undefined') return;
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

function makeEditor(markdown: string, enabled = true): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      MermaidDiagramExtension.configure({ enabled }),
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function entriesOf(editor: Editor) {
  return MERMAID_DIAGRAM_KEY.getState(editor.state)?.entries ?? [];
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe('MermaidDiagramExtension', () => {
  it('claims explicit Mermaid fences regardless of diagram type or validity', () => {
    const editor = makeEditor(
      `\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n\n\`\`\`mermaid\nnot finished yet\n\`\`\`\n`,
    );
    expect(entriesOf(editor)).toHaveLength(2);
  });

  it('does not steal ordinary code or ASCII diagram fences', () => {
    const editor = makeEditor(
      '```js\nflowchart LR\n  a --> b\n```\n\n```diagram\n+---+  +---+\n| A |->| B |\n+---+  +---+\n```\n',
    );
    expect(entriesOf(editor)).toHaveLength(0);
  });

  it('keeps one block id across edits above and inside the source fence', () => {
    const editor = makeEditor(`\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`);
    const [before] = entriesOf(editor);
    editor.commands.insertContentAt(0, '<p>Before</p>');
    const [shifted] = entriesOf(editor);
    expect(shifted.id).toBe(before.id);
    expect(shifted.pos).toBeGreaterThan(before.pos);

    expect(replaceAsciiFenceText(editor, shifted.pos, `${SAMPLE}\n  guard --> documents`)).toBe(
      true,
    );
    const [rewritten] = entriesOf(editor);
    expect(rewritten.id).toBe(before.id);
    expect(findMermaidDiagramBlockPos(editor, before.id)).toBe(rewritten.pos);
  });

  it('source visibility is session-only and does not mutate Mermaid text', () => {
    const editor = makeEditor(`\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`);
    const [entry] = entriesOf(editor);
    const before = tiptapToMarkdown(editor.getHTML());
    expect(isMermaidSourceVisible(editor, entry.id)).toBe(false);
    toggleMermaidSource(editor, entry.id);
    expect(isMermaidSourceVisible(editor, entry.id)).toBe(true);
    expect(tiptapToMarkdown(editor.getHTML())).toBe(before);
  });

  it('round-trips the complex graph as a Mermaid code block byte-for-byte', () => {
    const markdown = `\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`;
    const editor = makeEditor(markdown);
    expect(tiptapToMarkdown(editor.getHTML())).toBe(markdown);
  });

  it('can be disabled without registering a plugin state', () => {
    const editor = makeEditor(`\`\`\`mermaid\n${SAMPLE}\n\`\`\`\n`, false);
    expect(MERMAID_DIAGRAM_KEY.getState(editor.state)).toBeUndefined();
  });
});
