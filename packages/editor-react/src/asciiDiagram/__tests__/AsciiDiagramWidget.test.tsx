/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { markdownToTiptap } from '../../tiptapBridge';
import { AsciiDiagramExtension, ASCII_DIAGRAM_KEY } from '../AsciiDiagramExtension';
import { AsciiDiagramWidget } from '../AsciiDiagramWidget';
import { applyAsciiDiagramCommand } from '../asciiDiagramCommands';

/**
 * A refused edit leaves the canvas exactly as it was, so the widget has to
 * say so — otherwise the change just appears to snap back.
 */

vi.mock('../asciiDiagramCommands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../asciiDiagramCommands')>();
  return { ...actual, applyAsciiDiagramCommand: vi.fn() };
});

// The canvas measures its host; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

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

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
  vi.mocked(applyAsciiDiagramCommand).mockReset();
});

function renderWidget() {
  editor = new Editor({
    extensions: [StarterKit, AsciiDiagramExtension],
    content: markdownToTiptap('```\n' + ART + '\n```\n'),
  });
  const blockId = ASCII_DIAGRAM_KEY.getState(editor.state)?.entries[0]?.id as string;
  const { container } = render(
    <AsciiDiagramWidget editor={editor} blockId={blockId} fallbackPos={0} />,
  );
  const status = container.querySelector('.squisq-ascii-diagram-notice') as HTMLElement;
  expect(status.getAttribute('role')).toBe('status');
  expect(status.getAttribute('aria-live')).toBe('polite');
  return status;
}

const rejectNext = () =>
  vi.mocked(applyAsciiDiagramCommand).mockImplementationOnce((_e, _id, _cmd, options) => {
    options?.onRejected?.();
    return false;
  });

describe('AsciiDiagramWidget rejected-edit notice', () => {
  it('explains a refused edit in a live region, then clears it', () => {
    vi.useFakeTimers();
    const status = renderWidget();
    expect(status.textContent).toBe('');

    rejectNext();
    fireEvent.click(screen.getByTitle('Add node'));
    expect(status.textContent).toMatch(/wasn't applied/);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(status.textContent).toBe('');
  });

  it('drops the notice as soon as an edit goes through', () => {
    const status = renderWidget();
    rejectNext();
    fireEvent.click(screen.getByTitle('Add node'));
    expect(status.textContent).not.toBe('');

    vi.mocked(applyAsciiDiagramCommand).mockReturnValueOnce(true);
    fireEvent.click(screen.getByTitle('Add node'));
    expect(status.textContent).toBe('');
  });

  it('says nothing for an edit that was simply a no-op', () => {
    const status = renderWidget();
    vi.mocked(applyAsciiDiagramCommand).mockReturnValueOnce(false);
    fireEvent.click(screen.getByTitle('Add node'));
    expect(status.textContent).toBe('');
  });
});
