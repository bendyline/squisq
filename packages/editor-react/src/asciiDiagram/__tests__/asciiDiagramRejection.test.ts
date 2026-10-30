/**
 * `onRejected` separates "the redraw would lose part of the diagram" from a
 * plain no-op, so the canvas can explain an edit that didn't stick. The
 * renderer is wrapped so one test can make it drop a box.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as doc from '@bendyline/squisq/doc';
import { markdownToTiptap } from '../../tiptapBridge';
import { AsciiDiagramExtension, ASCII_DIAGRAM_KEY } from '../AsciiDiagramExtension';
import { applyAsciiDiagramCommand } from '../asciiDiagramCommands';

vi.mock('@bendyline/squisq/doc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq/doc')>();
  return { ...actual, renderAsciiDiagram: vi.fn(actual.renderAsciiDiagram) };
});

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

function makeEditor(): { editor: Editor; blockId: string } {
  const editor = new Editor({
    extensions: [StarterKit, AsciiDiagramExtension],
    content: markdownToTiptap('```\n' + ART + '\n```\n'),
  });
  editors.push(editor);
  const blockId = ASCII_DIAGRAM_KEY.getState(editor.state)?.entries[0]?.id as string;
  return { editor, blockId };
}

afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
  vi.mocked(doc.renderAsciiDiagram).mockClear();
});

describe('applyAsciiDiagramCommand onRejected', () => {
  it('fires when the redrawn art would lose a box, and leaves the fence alone', () => {
    const { editor, blockId } = makeEditor();
    const before = editor.getText();
    vi.mocked(doc.renderAsciiDiagram).mockImplementationOnce(() =>
      ['┌────────┐', '│ Alpha  │', '└────────┘'].join('\n'),
    );
    const onRejected = vi.fn();
    const applied = applyAsciiDiagramCommand(
      editor,
      blockId,
      { kind: 'renameNode', nodeId: 'beta', newLabel: 'Gamma' },
      { onRejected },
    );
    expect(applied).toBe(false);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe(before);
  });

  it('fires when the redrawn art would lose a connection', () => {
    const { editor, blockId } = makeEditor();
    vi.mocked(doc.renderAsciiDiagram).mockImplementationOnce(() =>
      ['┌────────┐', '│ Alpha  │', '└────────┘', '', '┌────────┐', '│ Gamma  │', '└────────┘'].join(
        '\n',
      ),
    );
    const onRejected = vi.fn();
    applyAsciiDiagramCommand(
      editor,
      blockId,
      { kind: 'renameNode', nodeId: 'beta', newLabel: 'Gamma' },
      { onRejected },
    );
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for no-ops and successful edits', () => {
    const { editor, blockId } = makeEditor();
    const onRejected = vi.fn();
    // Same label: nothing to do.
    expect(
      applyAsciiDiagramCommand(
        editor,
        blockId,
        { kind: 'renameNode', nodeId: 'beta', newLabel: 'Beta' },
        { onRejected },
      ),
    ).toBe(false);
    expect(
      applyAsciiDiagramCommand(
        editor,
        blockId,
        { kind: 'renameNode', nodeId: 'beta', newLabel: 'Gamma' },
        { onRejected },
      ),
    ).toBe(true);
    expect(onRejected).not.toHaveBeenCalled();
  });
});
