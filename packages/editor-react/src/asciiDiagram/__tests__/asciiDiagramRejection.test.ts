/**
 * `onRejected` separates "no redraw keeps the whole diagram" from a plain
 * no-op, so the canvas can explain an edit that didn't stick. The renderer is
 * wrapped so a test can make it drop a box — once (the layout as placed; the
 * edit should land in another layout) or every time (nothing can be drawn).
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
  // Back to the real renderer (`vi.fn(impl)` resets to `impl`).
  vi.mocked(doc.renderAsciiDiagram).mockReset();
});

const LOSES_A_BOX = ['┌────────┐', '│ Alpha  │', '└────────┘'].join('\n');

describe('applyAsciiDiagramCommand onRejected', () => {
  it('fires when every redraw would lose a box, and leaves the fence alone', () => {
    const { editor, blockId } = makeEditor();
    const before = editor.getText();
    vi.mocked(doc.renderAsciiDiagram).mockImplementation(() => LOSES_A_BOX);
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

  it('keeps the edit when only the boxes as placed would lose a box', () => {
    const { editor, blockId } = makeEditor();
    vi.mocked(doc.renderAsciiDiagram).mockImplementationOnce(() => LOSES_A_BOX);
    const onRejected = vi.fn();
    const applied = applyAsciiDiagramCommand(
      editor,
      blockId,
      { kind: 'renameNode', nodeId: 'beta', newLabel: 'Gamma' },
      { onRejected },
    );
    expect(applied).toBe(true);
    expect(onRejected).not.toHaveBeenCalled();
    expect(editor.getText()).toContain('Gamma');
    expect(editor.getText()).toContain('Alpha');
  });

  it('fires when every redraw would lose a connection', () => {
    const { editor, blockId } = makeEditor();
    vi.mocked(doc.renderAsciiDiagram).mockImplementation(() =>
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
