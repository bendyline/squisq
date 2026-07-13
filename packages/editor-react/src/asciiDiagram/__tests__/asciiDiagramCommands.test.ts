/**
 * Command pipeline through a REAL tiptap editor: fence text in →
 * `applyAsciiDiagramCommand` → fence text out, verified by re-parsing.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ASCII_CHAR_H, ASCII_CHAR_W, parseAsciiDiagram } from '@bendyline/squisq/doc';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { AsciiDiagramExtension, ASCII_DIAGRAM_KEY } from '../AsciiDiagramExtension';
import { applyAsciiDiagramCommand, replaceAsciiFenceText } from '../asciiDiagramCommands';

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

const ART = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    │',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

let editors: Editor[] = [];

function makeEditor(md: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      AsciiDiagramExtension,
    ],
    content: markdownToTiptap(md),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
});

function firstBlockId(editor: Editor): string {
  const state = ASCII_DIAGRAM_KEY.getState(editor.state);
  expect(state?.entries.length).toBeGreaterThan(0);
  return state?.entries[0].id as string;
}

function fenceOf(editor: Editor): { text: string; language: string | null } {
  let text = '';
  let language: string | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock' && text === '') {
      text = node.textContent;
      language = (node.attrs as { language?: string | null }).language ?? null;
      return false;
    }
    return true;
  });
  return { text, language };
}

describe('applyAsciiDiagramCommand', () => {
  it('moveNode rewrites the fence with the node at the new cell', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    const ok = applyAsciiDiagramCommand(editor, id, {
      kind: 'moveNode',
      nodeId: 'beta',
      x: 20 * ASCII_CHAR_W,
      y: 10 * ASCII_CHAR_H,
    });
    expect(ok).toBe(true);
    const reparsed = parseAsciiDiagram(fenceOf(editor).text);
    expect(reparsed.nodes.map((n) => n.id).sort()).toEqual(['alpha', 'beta']);
    expect(reparsed.edges).toEqual([{ source: 'alpha', target: 'beta', directed: true }]);
    expect(reparsed.nodes.find((n) => n.id === 'beta')?.col).toBe(20);
  });

  it('commits a north/west resize position and size in one fence rewrite', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    const onTransaction = vi.fn();
    editor.on('transaction', onTransaction);

    const ok = applyAsciiDiagramCommand(editor, id, {
      kind: 'resizeNode',
      nodeId: 'beta',
      x: 18 * ASCII_CHAR_W,
      y: 10 * ASCII_CHAR_H,
      width: 14 * ASCII_CHAR_W,
      height: 5 * ASCII_CHAR_H,
    });

    expect(ok).toBe(true);
    expect(onTransaction).toHaveBeenCalledTimes(1);
    const beta = parseAsciiDiagram(fenceOf(editor).text).nodes.find((n) => n.id === 'beta');
    expect(beta).toMatchObject({ col: 18, row: 10, wCols: 14, hRows: 5 });

    editor.commands.undo();
    const restored = parseAsciiDiagram(fenceOf(editor).text).nodes.find((n) => n.id === 'beta');
    expect(restored).toMatchObject({ col: 0, row: 5, wCols: 10, hRows: 3 });
  });

  it('persists a virtual gutter with the first edit of legacy origin-hugging art', () => {
    const editor = makeEditor('```diagram\n' + ART + '\n```\n');
    const id = firstBlockId(editor);

    expect(
      applyAsciiDiagramCommand(
        editor,
        id,
        {
          kind: 'resizeNode',
          nodeId: 'alpha',
          x: 6 * ASCII_CHAR_W,
          y: 1 * ASCII_CHAR_H,
          width: 12 * ASCII_CHAR_W,
          height: 4 * ASCII_CHAR_H,
        },
        { diagramOffset: { col: 8, row: 2 } },
      ),
    ).toBe(true);

    const nodes = parseAsciiDiagram(fenceOf(editor).text).nodes;
    expect(nodes.find((node) => node.id === 'alpha')).toMatchObject({
      col: 6,
      row: 1,
      wCols: 12,
      hRows: 4,
    });
    // The untouched peer receives the persisted origin shift, preserving the
    // same coordinates that were already projected on the canvas.
    expect(nodes.find((node) => node.id === 'beta')).toMatchObject({ col: 8, row: 7 });
  });

  it('addConnection adds a reciprocal edge (renders as a double arrow)', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    expect(
      applyAsciiDiagramCommand(editor, id, {
        kind: 'addConnection',
        source: 'beta',
        target: 'alpha',
      }),
    ).toBe(true);
    const reparsed = parseAsciiDiagram(fenceOf(editor).text);
    expect(reparsed.edges).toHaveLength(2);
  });

  it('renameNode rewrites labels (and therefore ids)', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    expect(
      applyAsciiDiagramCommand(editor, id, {
        kind: 'renameNode',
        nodeId: 'alpha',
        newLabel: 'Gateway',
      }),
    ).toBe(true);
    const reparsed = parseAsciiDiagram(fenceOf(editor).text);
    expect(reparsed.nodes.map((n) => n.id).sort()).toEqual(['beta', 'gateway']);
    expect(reparsed.edges).toEqual([{ source: 'gateway', target: 'beta', directed: true }]);
  });

  it('addNode / removeNode change the box count', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    expect(
      applyAsciiDiagramCommand(editor, id, { kind: 'addNode', x: 40 * ASCII_CHAR_W, y: 0 }),
    ).toBe(true);
    expect(parseAsciiDiagram(fenceOf(editor).text).nodes).toHaveLength(3);
    expect(applyAsciiDiagramCommand(editor, id, { kind: 'removeNode', nodeId: 'node-1' })).toBe(
      true,
    );
    expect(parseAsciiDiagram(fenceOf(editor).text).nodes).toHaveLength(2);
  });

  it('promotes the fence language to the explicit `diagram` tag on edit', () => {
    // A once-edited diagram should carry `language: 'diagram'` so its identity
    // survives a later flatten → markdown → re-import round-trip (the language
    // class round-trips; fence meta does not).
    const editor = makeEditor('```text\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    expect(fenceOf(editor).language).toBe('text');
    applyAsciiDiagramCommand(editor, id, {
      kind: 'moveNode',
      nodeId: 'beta',
      x: 15 * ASCII_CHAR_W,
      y: 9 * ASCII_CHAR_H,
    });
    expect(fenceOf(editor).language).toBe('diagram');
  });

  it('keeps the block id stable across the language-promotion rewrite', () => {
    // The promotion is a `setNodeMarkup` boundary rewrite; the position
    // registry must still recognize the same block so a follow-up command
    // resolves it (and the widget's React root survives).
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    applyAsciiDiagramCommand(editor, id, {
      kind: 'moveNode',
      nodeId: 'beta',
      x: 15 * ASCII_CHAR_W,
      y: 9 * ASCII_CHAR_H,
    });
    expect(firstBlockId(editor)).toBe(id);
    expect(fenceOf(editor).language).toBe('diagram');
  });

  it('one undo restores the original fence bytes', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    const before = fenceOf(editor).text;
    applyAsciiDiagramCommand(editor, id, {
      kind: 'moveNode',
      nodeId: 'beta',
      x: 22 * ASCII_CHAR_W,
      y: 12 * ASCII_CHAR_H,
    });
    expect(fenceOf(editor).text).not.toBe(before);
    editor.commands.undo();
    expect(fenceOf(editor).text).toBe(before);
  });

  it('no-op commands leave the document untouched', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstBlockId(editor);
    const beta = parseAsciiDiagram(fenceOf(editor).text).nodes.find((n) => n.id === 'beta');
    const json = JSON.stringify(editor.state.doc.toJSON());
    const ok = applyAsciiDiagramCommand(editor, id, {
      kind: 'moveNode',
      nodeId: 'beta',
      x: (beta?.col ?? 0) * ASCII_CHAR_W,
      y: (beta?.row ?? 0) * ASCII_CHAR_H,
    });
    expect(ok).toBe(false);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(json);
  });

  it('returns false for an unknown block id', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    expect(
      applyAsciiDiagramCommand(editor, 'ascii-999', {
        kind: 'removeNode',
        nodeId: 'alpha',
      }),
    ).toBe(false);
  });
});

describe('replaceAsciiFenceText', () => {
  it('replaces only the text content, not attributes', () => {
    const editor = makeEditor('```text\n' + ART + '\n```\n');
    const state = ASCII_DIAGRAM_KEY.getState(editor.state);
    const pos = state?.entries[0].pos as number;
    expect(replaceAsciiFenceText(editor, pos, 'replacement')).toBe(true);
    expect(fenceOf(editor)).toEqual({ text: 'replacement', language: 'text' });
  });

  it('no-ops on identical text', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const state = ASCII_DIAGRAM_KEY.getState(editor.state);
    const pos = state?.entries[0].pos as number;
    expect(replaceAsciiFenceText(editor, pos, ART)).toBe(false);
  });
});
