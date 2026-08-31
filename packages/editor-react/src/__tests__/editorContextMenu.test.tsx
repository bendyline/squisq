import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useRef } from 'react';
import { EditorProvider } from '../EditorContext';
import {
  EditorContextMenuProvider,
  ownsContextMenuProps,
  useEditorContextMenuItems,
  type EditorContextMenuContext,
} from '../EditorContextMenu';

function HostActions({ onNarrate }: { onNarrate: (context: EditorContextMenuContext) => void }) {
  const items = useMemo(
    () => [
      {
        id: 'narrate-selection',
        label: 'Narrate selection',
        group: 'speech',
        when: 'selection' as const,
        onSelect: onNarrate,
      },
    ],
    [onNarrate],
  );
  useEditorContextMenuItems(items);
  return null;
}

function Harness({
  onNarrate = () => undefined,
  readOnly = false,
  onPanelContextMenu = () => undefined,
}: {
  onNarrate?: (context: EditorContextMenuContext) => void;
  readOnly?: boolean;
  onPanelContextMenu?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <EditorProvider initialMarkdown="hello workshop" initialView="raw">
      <EditorContextMenuProvider rootRef={rootRef} readOnly={readOnly}>
        <div ref={rootRef} className="squisq-editor-shell">
          <div className="squisq-editor-content">
            <textarea aria-label="Source" defaultValue="hello workshop" />
            <div {...ownsContextMenuProps}>
              <button type="button" onContextMenu={onPanelContextMenu}>
                pasted.png
              </button>
            </div>
          </div>
          <HostActions onNarrate={onNarrate} />
        </div>
      </EditorContextMenuProvider>
    </EditorProvider>
  );
}

describe('EditorContextMenu', () => {
  const writeText = vi.fn<(value: string) => Promise<void>>();
  const readText = vi.fn<() => Promise<string>>();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    readText.mockResolvedValue(' world');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows clipboard actions and registered selection actions', async () => {
    const onNarrate = vi.fn();
    render(<Harness onNarrate={onNarrate} />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(0, 5);

    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });

    expect(
      ((await screen.findByRole('menuitem', { name: 'Cut' })) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('menuitem', { name: 'Paste' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Narrate selection' }));

    await waitFor(() => expect(onNarrate).toHaveBeenCalledOnce());
    expect(onNarrate.mock.calls[0]?.[0]).toMatchObject({
      view: 'raw',
      selectedText: 'hello',
      hasSelection: true,
      editable: true,
    });
  });

  it('copies and cuts through the shared clipboard commands', async () => {
    render(<Harness />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(0, 5);
    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello'));

    source.setSelectionRange(0, 5);
    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cut' }));

    await waitFor(() => expect(source.value).toBe(' workshop'));
  });

  it('offers location paste while hiding selection-only host actions', async () => {
    render(<Harness />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(5, 5);

    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });

    expect(
      ((await screen.findByRole('menuitem', { name: 'Cut' })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole('menuitem', { name: 'Narrate selection' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    await waitFor(() => expect(source.value).toBe('hello world workshop'));
  });

  it('leaves right-clicks alone inside a panel that owns its context menu', async () => {
    const onPanelContextMenu = vi.fn();
    render(<Harness onPanelContextMenu={onPanelContextMenu} />);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'pasted.png' }), {
      clientX: 24,
      clientY: 32,
    });

    expect(onPanelContextMenu).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('disables destructive clipboard actions in a read-only editor', async () => {
    render(<Harness readOnly />);
    const source = screen.getByRole('textbox', { name: 'Source' }) as HTMLTextAreaElement;
    source.setSelectionRange(0, 5);

    fireEvent.contextMenu(source, { clientX: 40, clientY: 60 });

    expect(
      ((await screen.findByRole('menuitem', { name: 'Cut' })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('menuitem', { name: 'Paste' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
